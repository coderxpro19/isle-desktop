use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use windows::core::{w, PCWSTR, PWSTR};
use windows::Win32::Foundation::{
    CloseHandle, HANDLE, HGLOBAL, HWND, LPARAM, LRESULT, POINT, WPARAM,
};
use windows::Win32::System::DataExchange::{
    AddClipboardFormatListener, CloseClipboard, EmptyClipboard, GetClipboardData,
    GetClipboardOwner, IsClipboardFormatAvailable, OpenClipboard, RegisterClipboardFormatW,
    SetClipboardData,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Memory::{
    GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE,
};
use windows::Win32::System::Ole::{CF_DIB, CF_HDROP, CF_UNICODETEXT};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    RegisterHotKey, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
    KEYEVENTF_KEYUP, MOD_ALT, MOD_NOREPEAT, MOD_SHIFT, VIRTUAL_KEY, VK_CONTROL, VK_V,
};
use windows::Win32::UI::Shell::{DragQueryFileW, DROPFILES, HDROP};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetForegroundWindow, GetMessageW,
    GetWindowThreadProcessId, IsWindow, RegisterClassExW, SetForegroundWindow, TranslateMessage,
    HWND_MESSAGE, MSG, WINDOW_EX_STYLE, WINDOW_STYLE, WM_CLIPBOARDUPDATE, WM_HOTKEY, WNDCLASSEXW,
};

use super::{record, Captured, Clip, ClipKind, History, ENABLED};
use crate::events;

const HOTKEY_ID: i32 = 0x1515;

struct Ctx {
    app: AppHandle,
    hist: Arc<Mutex<History>>,
    dir: Option<PathBuf>,
}
static CTX: OnceLock<Ctx> = OnceLock::new();
/// Window that was in front when the history was opened with the hotkey.
static PREV_FG: AtomicIsize = AtomicIsize::new(0);

pub fn run(app: AppHandle, hist: Arc<Mutex<History>>, dir: Option<PathBuf>) {
    let _ = CTX.set(Ctx { app, hist, dir });
    unsafe {
        let Ok(module) = GetModuleHandleW(PCWSTR::null()) else {
            return;
        };
        let class = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            lpfnWndProc: Some(wndproc),
            hInstance: module.into(),
            lpszClassName: w!("IsleClipboard"),
            ..Default::default()
        };
        RegisterClassExW(&class);
        let hwnd = match CreateWindowExW(
            WINDOW_EX_STYLE(0),
            w!("IsleClipboard"),
            w!(""),
            WINDOW_STYLE(0),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            Some(module.into()),
            None,
        ) {
            Ok(h) => h,
            Err(e) => {
                log::warn!("clipboard: no window: {e}");
                return;
            }
        };
        if let Err(e) = AddClipboardFormatListener(hwnd) {
            log::warn!("clipboard: listener failed: {e}");
        }
        if let Err(e) = RegisterHotKey(
            Some(hwnd),
            HOTKEY_ID,
            MOD_ALT | MOD_SHIFT | MOD_NOREPEAT,
            VK_V.0 as u32,
        ) {
            log::warn!("clipboard: Alt+Shift+V is taken by another app: {e}");
        }
        log::info!("setup: clipboard history ready");
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_CLIPBOARDUPDATE => {
            if ENABLED.load(Ordering::Relaxed) {
                if let Some(ctx) = CTX.get() {
                    let src = owner_app();
                    if let Some(cap) = read(hwnd) {
                        record(&ctx.app, &ctx.hist, &ctx.dir, cap, src);
                    }
                }
            }
            LRESULT(0)
        }
        WM_HOTKEY if wparam.0 as i32 == HOTKEY_ID => {
            if let Some(ctx) = CTX.get() {
                let fg = GetForegroundWindow();
                if !is_own(&ctx.app, fg) {
                    PREV_FG.store(fg.0 as isize, Ordering::SeqCst);
                }
                let _ = ctx.app.emit(events::CLIP_OPEN, ());
                if let Some(w) = ctx.app.get_webview_window("island-0") {
                    let _ = w.set_focus();
                }
            }
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

#[cfg(target_os = "windows")]
fn is_own(app: &AppHandle, fg: HWND) -> bool {
    app.webview_windows()
        .values()
        .any(|w| w.hwnd().map(|h| h.0 == fg.0).unwrap_or(false))
}
#[cfg(not(target_os = "windows"))]
fn is_own(_app: &AppHandle, _fg: HWND) -> bool {
    false
}

fn has(format: u32) -> bool {
    unsafe { IsClipboardFormatAvailable(format).is_ok() }
}

/// Clipboard content apps flag as private (passwords etc.).
fn is_private() -> bool {
    unsafe {
        let exclude = RegisterClipboardFormatW(w!("ExcludeClipboardContentFromMonitorProcessing"));
        let viewer_ignore = RegisterClipboardFormatW(w!("Clipboard Viewer Ignore"));
        if has(exclude) || has(viewer_ignore) {
            return true;
        }
        let history = RegisterClipboardFormatW(w!("CanIncludeInClipboardHistory"));
        if has(history) {
            if let Some(v) = global_bytes(history) {
                return v.len() >= 4 && u32::from_le_bytes([v[0], v[1], v[2], v[3]]) == 0;
            }
        }
        false
    }
}

unsafe fn global_bytes(format: u32) -> Option<Vec<u8>> {
    let h = GetClipboardData(format).ok()?;
    let g = HGLOBAL(h.0);
    let p = GlobalLock(g) as *const u8;
    if p.is_null() {
        return None;
    }
    let v = std::slice::from_raw_parts(p, GlobalSize(g)).to_vec();
    let _ = GlobalUnlock(g);
    Some(v)
}

fn read(hwnd: HWND) -> Option<Captured> {
    unsafe {
        // Another app may hold the clipboard for a moment.
        let mut opened = false;
        for _ in 0..5 {
            if OpenClipboard(Some(hwnd)).is_ok() {
                opened = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(30));
        }
        if !opened {
            return None;
        }
        let out = (|| {
            if is_private() {
                return None;
            }
            if has(CF_HDROP.0 as u32) {
                let h = GetClipboardData(CF_HDROP.0 as u32).ok()?;
                let drop = HDROP(h.0);
                let n = DragQueryFileW(drop, u32::MAX, None);
                let files: Vec<String> = (0..n)
                    .filter_map(|i| {
                        let len = DragQueryFileW(drop, i, None) as usize;
                        let mut buf = vec![0u16; len + 1];
                        let got = DragQueryFileW(drop, i, Some(&mut buf)) as usize;
                        (got > 0).then(|| String::from_utf16_lossy(&buf[..got]))
                    })
                    .collect();
                return (!files.is_empty()).then_some(Captured::Files(files));
            }
            if has(CF_UNICODETEXT.0 as u32) {
                let b = global_bytes(CF_UNICODETEXT.0 as u32)?;
                let units: Vec<u16> = b
                    .chunks_exact(2)
                    .map(|c| u16::from_le_bytes([c[0], c[1]]))
                    .take_while(|&u| u != 0)
                    .collect();
                return Some(Captured::Text(String::from_utf16_lossy(&units)));
            }
            if has(CF_DIB.0 as u32) {
                let b = global_bytes(CF_DIB.0 as u32)?;
                let img = super::dib::dib_to_rgba(&b)?;
                let png = super::dib::encode_png(&img)?;
                return Some(Captured::Image {
                    png,
                    w: img.w,
                    h: img.h,
                });
            }
            None
        })();
        let _ = CloseClipboard();
        out
    }
}

/// Exe name of the app that owns the clipboard ("chrome", "Code"…).
fn owner_app() -> Option<String> {
    unsafe {
        let owner = GetClipboardOwner().ok()?;
        let mut pid = 0u32;
        GetWindowThreadProcessId(owner, Some(&mut pid));
        if pid == 0 || pid == std::process::id() {
            return None;
        }
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = vec![0u16; 1024];
        let mut len = buf.len() as u32;
        let ok =
            QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len)
                .is_ok();
        let _ = CloseHandle(h);
        if !ok {
            return None;
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        std::path::Path::new(&path)
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
    }
}

unsafe fn put(format: u32, bytes: &[u8]) -> Result<(), String> {
    let g = GlobalAlloc(GMEM_MOVEABLE, bytes.len()).map_err(|e| e.to_string())?;
    let p = GlobalLock(g) as *mut u8;
    if p.is_null() {
        return Err("out of memory".into());
    }
    std::ptr::copy_nonoverlapping(bytes.as_ptr(), p, bytes.len());
    let _ = GlobalUnlock(g);
    SetClipboardData(format, Some(HANDLE(g.0)))
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Put a clip on the clipboard. `dib` is the packed bitmap for image clips.
pub fn write(clip: &Clip, dib: Option<&[u8]>) -> Result<(), String> {
    unsafe {
        OpenClipboard(None).map_err(|e| format!("clipboard busy: {e}"))?;
        let r = (|| {
            EmptyClipboard().map_err(|e| e.to_string())?;
            match clip.kind {
                ClipKind::Text => {
                    let mut wide: Vec<u16> = clip
                        .text
                        .as_deref()
                        .unwrap_or_default()
                        .encode_utf16()
                        .collect();
                    wide.push(0);
                    let bytes: Vec<u8> = wide.iter().flat_map(|u| u.to_le_bytes()).collect();
                    put(CF_UNICODETEXT.0 as u32, &bytes)
                }
                ClipKind::Image => put(CF_DIB.0 as u32, dib.ok_or("missing image")?),
                ClipKind::Files => {
                    let header = DROPFILES {
                        pFiles: std::mem::size_of::<DROPFILES>() as u32,
                        pt: POINT::default(),
                        fNC: false.into(),
                        fWide: true.into(),
                    };
                    let mut bytes = std::slice::from_raw_parts(
                        &header as *const DROPFILES as *const u8,
                        std::mem::size_of::<DROPFILES>(),
                    )
                    .to_vec();
                    for f in &clip.files {
                        bytes.extend(f.encode_utf16().chain([0]).flat_map(|u| u.to_le_bytes()));
                    }
                    bytes.extend_from_slice(&[0, 0]);
                    put(CF_HDROP.0 as u32, &bytes)
                }
            }
        })();
        let _ = CloseClipboard();
        r
    }
}

fn key(vk: VIRTUAL_KEY, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                dwFlags: if up {
                    KEYEVENTF_KEYUP
                } else {
                    KEYBD_EVENT_FLAGS(0)
                },
                ..Default::default()
            },
        },
    }
}

/// Bring back the app that was in front and press Ctrl+V in it.
pub fn paste_into_previous() {
    let prev = PREV_FG.swap(0, Ordering::SeqCst);
    std::thread::spawn(move || unsafe {
        let hwnd = HWND(prev as *mut _);
        if prev == 0 || !IsWindow(Some(hwnd)).as_bool() {
            return;
        }
        let _ = SetForegroundWindow(hwnd);
        std::thread::sleep(Duration::from_millis(90));
        let keys = [
            key(VK_CONTROL, false),
            key(VK_V, false),
            key(VK_V, true),
            key(VK_CONTROL, true),
        ];
        SendInput(&keys, std::mem::size_of::<INPUT>() as i32);
    });
}
