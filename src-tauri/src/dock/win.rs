//! Windows implementation of the dock.

use base64::Engine as _;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::mpsc::{self, Sender};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use windows::core::{Interface, HSTRING, PCWSTR, PWSTR};
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT, SIZE, WPARAM};
use windows::Win32::Graphics::Dwm::{
    DwmGetWindowAttribute, DwmQueryThumbnailSourceSize, DwmRegisterThumbnail,
    DwmUnregisterThumbnail, DwmUpdateThumbnailProperties, DWMWA_CLOAKED, DWM_THUMBNAIL_PROPERTIES,
    DWM_TNP_OPACITY, DWM_TNP_RECTDESTINATION, DWM_TNP_SOURCECLIENTAREAONLY, DWM_TNP_VISIBLE,
};
use windows::Win32::Graphics::Gdi::{
    DeleteObject, GetDC, GetDIBits, GetMonitorInfoW, GetObjectW, MonitorFromWindow, ReleaseDC,
    BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HGDIOBJ, MONITORINFO,
    MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
use windows::Win32::System::Power::SetSuspendState;
use windows::Win32::System::Shutdown::{
    ExitWindowsEx, LockWorkStation, EWX_LOGOFF, SHUTDOWN_REASON,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_MENU,
};
use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow};
use windows::Win32::UI::Shell::{
    BHID_EnumItems, IEnumShellItems, IShellItem, IShellItem2, IShellItemImageFactory,
    SHCreateItemFromParsingName, SHDefExtractIconW, SHEmptyRecycleBinW, SHQueryRecycleBinW,
    ShellExecuteW, SHQUERYRBINFO, SIGDN_NORMALDISPLAY, SIGDN_PARENTRELATIVEPARSING, SIIGBF,
    SIIGBF_BIGGERSIZEOK, SIIGBF_ICONONLY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    DestroyIcon, DispatchMessageW, EnumWindows, GetAncestor, GetForegroundWindow, GetIconInfo,
    GetMessageW, GetWindow, GetWindowLongW, GetWindowRect, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible, PostMessageW, SetForegroundWindow,
    ShowWindow, TranslateMessage, EVENT_OBJECT_CLOAKED, EVENT_OBJECT_DESTROY, EVENT_OBJECT_HIDE,
    EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_SHOW, EVENT_OBJECT_UNCLOAKED, EVENT_SYSTEM_FOREGROUND,
    EVENT_SYSTEM_MINIMIZEEND, EVENT_SYSTEM_MINIMIZESTART, GA_ROOT, GWL_EXSTYLE, GW_OWNER, HICON,
    ICONINFO, MSG, OBJID_WINDOW, SW_MINIMIZE, SW_RESTORE, SW_SHOWNORMAL, WINEVENT_OUTOFCONTEXT,
    WINEVENT_SKIPOWNPROCESS, WM_CLOSE, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
};

use super::{
    bar_height, refresh, LauncherApp, Power, PreviewSlot, RawWindow, WindowAction, DOCK_LABEL,
};
use crate::settings::SettingsStore;

const PKEY_APPUSERMODEL_ID: PROPERTYKEY = PROPERTYKEY {
    fmtid: windows::core::GUID::from_u128(0x9f4c2855_9f79_4b39_a8d0_e1d42de1d5f3),
    pid: 5,
};
const PKEY_FILE_DESCRIPTION: PROPERTYKEY = PROPERTYKEY {
    fmtid: windows::core::GUID::from_u128(0x0cef7d53_fa64_11d1_a203_0000f81fedee),
    pid: 3,
};

static POKE: OnceLock<Sender<()>> = OnceLock::new();

/// Ask the watcher to recompute now (e.g. after pinning).
pub fn poke() {
    if let Some(tx) = POKE.get() {
        let _ = tx.send(());
    }
}

unsafe extern "system" fn on_win_event(
    _hook: HWINEVENTHOOK,
    _event: u32,
    hwnd: HWND,
    id_object: i32,
    id_child: i32,
    _thread: u32,
    _time: u32,
) {
    if id_object == OBJID_WINDOW.0 && id_child == 0 && !hwnd.is_invalid() {
        poke();
    }
}

pub fn spawn_watcher(app: AppHandle) {
    let (tx, rx) = mpsc::channel::<()>();
    let _ = POKE.set(tx);

    // Hook thread: WinEvent callbacks need a message loop on the hooking thread.
    std::thread::Builder::new()
        .name("isle-dock-hooks".into())
        .spawn(|| unsafe {
            let ranges = [
                (EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND),
                (EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND),
                (EVENT_OBJECT_DESTROY, EVENT_OBJECT_HIDE),
                (EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_NAMECHANGE),
                (EVENT_OBJECT_CLOAKED, EVENT_OBJECT_UNCLOAKED),
                (EVENT_OBJECT_SHOW, EVENT_OBJECT_SHOW),
            ];
            for (min, max) in ranges {
                SetWinEventHook(
                    min,
                    max,
                    None,
                    Some(on_win_event),
                    0,
                    0,
                    WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
                );
            }
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        })
        .expect("spawn dock hook thread");

    // Worker: debounce bursts of events, then enumerate windows.
    std::thread::Builder::new()
        .name("isle-dock".into())
        .spawn(move || {
            unsafe {
                let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            }
            let mut names: HashMap<String, String> = HashMap::new();
            loop {
                // Fallback refresh every 3 s in case an event was missed.
                let _ = rx.recv_timeout(Duration::from_secs(3));
                std::thread::sleep(Duration::from_millis(120));
                while rx.try_recv().is_ok() {}
                let windows = enumerate(&mut names);
                let fg = unsafe { GetForegroundWindow() };
                let overlap = overlaps_dock(&app, fg);
                refresh(&app, windows, fg.0 as i64, overlap);
            }
        })
        .expect("spawn dock worker");
}

/* ───────────────────────── window enumeration ───────────────────────── */

fn hwnd(h: i64) -> HWND {
    HWND(h as isize as *mut _)
}

fn is_cloaked(h: HWND) -> bool {
    let mut cloaked = 0u32;
    unsafe {
        DwmGetWindowAttribute(
            h,
            DWMWA_CLOAKED,
            &mut cloaked as *mut u32 as *mut _,
            std::mem::size_of::<u32>() as u32,
        )
        .is_ok()
            && cloaked != 0
    }
}

/// Alt-tab–style filter for "real" app windows.
fn is_app_window(h: HWND) -> bool {
    unsafe {
        if !IsWindowVisible(h).as_bool() || is_cloaked(h) {
            return false;
        }
        let ex = GetWindowLongW(h, GWL_EXSTYLE) as u32;
        let owner = GetWindow(h, GW_OWNER).unwrap_or_default();
        if ex & WS_EX_APPWINDOW.0 == 0 && (ex & WS_EX_TOOLWINDOW.0 != 0 || !owner.is_invalid()) {
            return false;
        }
        GetWindowTextLengthW(h) > 0
    }
}

fn window_text(h: HWND) -> String {
    unsafe {
        let len = GetWindowTextLengthW(h);
        let mut buf = vec![0u16; len as usize + 1];
        let n = GetWindowTextW(h, &mut buf);
        String::from_utf16_lossy(&buf[..n as usize])
    }
}

fn exe_path(pid: u32) -> Option<String> {
    unsafe {
        let p = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok =
            QueryFullProcessImageNameW(p, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len)
                .is_ok();
        let _ = CloseHandle(p);
        ok.then(|| String::from_utf16_lossy(&buf[..len as usize]))
    }
}

fn window_aumid(h: HWND) -> Option<String> {
    unsafe {
        let store: IPropertyStore = SHGetPropertyStoreForWindow(h).ok()?;
        let v = store.GetValue(&PKEY_APPUSERMODEL_ID).ok()?;
        let s = v.to_string();
        (!s.is_empty()).then_some(s)
    }
}

fn shell_item(parsing: &str) -> Option<IShellItem> {
    unsafe { SHCreateItemFromParsingName(&HSTRING::from(parsing), None).ok() }
}

/// Friendly app name: AppsFolder name for AUMIDs, FileDescription for exes.
fn app_name(exe: &str, aumid: Option<&str>) -> String {
    let from_item = |item: IShellItem, desc: bool| -> Option<String> {
        unsafe {
            if desc {
                if let Ok(i2) = item.cast::<IShellItem2>() {
                    if let Ok(p) = i2.GetString(&PKEY_FILE_DESCRIPTION) {
                        let s = p.to_string().unwrap_or_default();
                        windows::Win32::System::Com::CoTaskMemFree(Some(p.0 as *const _));
                        if !s.trim().is_empty() {
                            return Some(s);
                        }
                    }
                }
            }
            let p = item.GetDisplayName(SIGDN_NORMALDISPLAY).ok()?;
            let s = p.to_string().unwrap_or_default();
            windows::Win32::System::Com::CoTaskMemFree(Some(p.0 as *const _));
            Some(s)
        }
    };
    if let Some(a) = aumid {
        if let Some(n) =
            shell_item(&format!("shell:AppsFolder\\{a}")).and_then(|i| from_item(i, false))
        {
            return n;
        }
    }
    shell_item(exe)
        .and_then(|i| from_item(i, true))
        .unwrap_or_else(|| {
            exe.rsplit('\\')
                .next()
                .unwrap_or(exe)
                .trim_end_matches(".exe")
                .to_string()
        })
}

fn enumerate(names: &mut HashMap<String, String>) -> Vec<RawWindow> {
    let mut hwnds: Vec<HWND> = Vec::new();
    unsafe extern "system" fn collect(h: HWND, l: LPARAM) -> windows::core::BOOL {
        let v = &mut *(l.0 as *mut Vec<HWND>);
        v.push(h);
        true.into()
    }
    unsafe {
        let _ = EnumWindows(Some(collect), LPARAM(&mut hwnds as *mut _ as isize));
    }
    let me = std::process::id();
    let mut out = Vec::new();
    for h in hwnds {
        if !is_app_window(h) {
            continue;
        }
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(h, Some(&mut pid)) };
        if pid == me {
            continue;
        }
        let Some(exe) = exe_path(pid).map(|p| p.to_lowercase()) else {
            continue;
        };
        let aumid = window_aumid(h);
        // UWP host windows without an app identity aren't useful.
        if exe.ends_with("applicationframehost.exe") && aumid.is_none() {
            continue;
        }
        let name_key = aumid.clone().unwrap_or_else(|| exe.clone());
        let app_name = names
            .entry(name_key)
            .or_insert_with(|| app_name(&exe, aumid.as_deref()))
            .clone();
        out.push(RawWindow {
            hwnd: h.0 as i64,
            title: window_text(h),
            minimized: unsafe { IsIconic(h).as_bool() },
            exe,
            aumid,
            app_name,
        });
    }
    out
}

/// For smart mode: does the foreground window reach into the dock's area?
fn overlaps_dock(app: &AppHandle, fg: HWND) -> bool {
    if fg.is_invalid() || !is_app_window(fg) {
        return false;
    }
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(fg, Some(&mut pid)) };
    if pid == std::process::id() {
        return false;
    }
    let Some(dock) = app.get_webview_window(DOCK_LABEL) else {
        return false;
    };
    let scale = dock.scale_factor().unwrap_or(1.0);
    let bar = (bar_height(app.state::<SettingsStore>().get().dock.icon_size) * scale) as i32;
    unsafe {
        let mut r = RECT::default();
        if GetWindowRect(fg, &mut r).is_err() || IsIconic(fg).as_bool() {
            return false;
        }
        let mon = MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST);
        let mut mi = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(mon, &mut mi).as_bool() {
            return false;
        }
        r.bottom > mi.rcMonitor.bottom - bar
    }
}

/* ───────────────────────────── actions ───────────────────────────── */

pub fn shell_open(file: &str, params: Option<&str>) -> Result<(), String> {
    let params = params.map(HSTRING::from);
    let h = unsafe {
        ShellExecuteW(
            None,
            &HSTRING::from("open"),
            &HSTRING::from(file),
            params
                .as_ref()
                .map(|p| PCWSTR(p.as_ptr()))
                .unwrap_or(PCWSTR::null()),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    if h.0 as usize > 32 {
        Ok(())
    } else {
        Err(format!("couldn't open {file}"))
    }
}

pub fn launch(key: &str) -> Result<(), String> {
    if key.contains(":\\") || key.starts_with("\\\\") {
        shell_open(key, None)
    } else {
        shell_open("explorer.exe", Some(&format!("shell:AppsFolder\\{key}")))
    }
}

/// Bring a window to the front. Windows only lets the foreground process do
/// that; a synthetic Alt tap satisfies the rule after a dock click.
fn focus(h: HWND) {
    unsafe {
        if IsIconic(h).as_bool() {
            let _ = ShowWindow(h, SW_RESTORE);
        }
        if !SetForegroundWindow(h).as_bool() {
            let key = |flags| INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VK_MENU,
                        dwFlags: flags,
                        ..Default::default()
                    },
                },
            };
            SendInput(
                &[key(Default::default()), key(KEYEVENTF_KEYUP)],
                std::mem::size_of::<INPUT>() as i32,
            );
            let _ = SetForegroundWindow(h);
        }
    }
}

pub fn window_action(h: i64, action: WindowAction) {
    let h = hwnd(h);
    unsafe {
        match action {
            WindowAction::Activate => focus(GetAncestor(h, GA_ROOT)),
            WindowAction::Minimize => {
                let _ = ShowWindow(h, SW_MINIMIZE);
            }
            WindowAction::Close => {
                let _ = PostMessageW(Some(h), WM_CLOSE, WPARAM(0), LPARAM(0));
            }
        }
    }
    poke();
}

/* ───────────────────────────── icons ───────────────────────────── */

/// App icon as a PNG data URL. Tries, in order: the exe's own icon (plain
/// Win32, works for every classic app), the shell's image for the item
/// (packaged apps / AppsFolder entries), then `fallback_exe`.
pub fn icon(key: &str, fallback_exe: Option<&str>) -> Option<String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    }
    let is_path = |k: &str| k.contains(":\\") || k.starts_with("\\\\");
    let png = if let Some(id) = key.strip_prefix("app:") {
        pin_key_for(id)
            .filter(|k| is_path(k))
            .and_then(|p| exe_icon(&p))
            .or_else(|| shell_image(&format!("shell:AppsFolder\\{id}")))
    } else if is_path(key) {
        exe_icon(key).or_else(|| shell_image(key))
    } else {
        shell_image(&format!("shell:AppsFolder\\{key}"))
    };
    png.or_else(|| fallback_exe.filter(|p| is_path(p)).and_then(exe_icon))
        .map(|bytes| {
            format!(
                "data:image/png;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            )
        })
}

/// Another app's icon handle (e.g. a tray icon) → PNG data URL.
pub fn hicon_png(h: isize) -> Option<String> {
    unsafe {
        let icon = HICON(h as *mut _);
        let mut info = ICONINFO::default();
        GetIconInfo(icon, &mut info).ok()?;
        let png = bitmap_to_png(info.hbmColor, false);
        let _ = DeleteObject(HGDIOBJ(info.hbmColor.0));
        let _ = DeleteObject(HGDIOBJ(info.hbmMask.0));
        png.map(|bytes| {
            format!(
                "data:image/png;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            )
        })
    }
}

fn shell_image(parsing: &str) -> Option<Vec<u8>> {
    shell_image_flags(parsing, SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK)
}

/// A file's thumbnail (photos, videos, PDFs…) or its icon, as a PNG data URL.
pub fn thumbnail(path: &str) -> Option<String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    }
    shell_image_flags(path, SIIGBF_BIGGERSIZEOK).map(|bytes| {
        format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )
    })
}

fn shell_image_flags(parsing: &str, flags: SIIGBF) -> Option<Vec<u8>> {
    let item = shell_item(parsing)?;
    unsafe {
        let factory: IShellItemImageFactory = item.cast().ok()?;
        let bmp = factory.GetImage(SIZE { cx: 96, cy: 96 }, flags).ok()?;
        let png = bitmap_to_png(bmp, true);
        let _ = DeleteObject(HGDIOBJ(bmp.0));
        png
    }
}

/// The large icon embedded in an exe, via SHDefExtractIcon (no COM).
fn exe_icon(path: &str) -> Option<Vec<u8>> {
    unsafe {
        let mut large = HICON::default();
        let size = 96u32;
        SHDefExtractIconW(&HSTRING::from(path), 0, 0, Some(&mut large), None, size)
            .ok()
            .ok()?;
        if large.is_invalid() {
            return None;
        }
        let mut info = ICONINFO::default();
        let png = if GetIconInfo(large, &mut info).is_ok() {
            let png = bitmap_to_png(info.hbmColor, false);
            let _ = DeleteObject(HGDIOBJ(info.hbmColor.0));
            let _ = DeleteObject(HGDIOBJ(info.hbmMask.0));
            png
        } else {
            None
        };
        let _ = DestroyIcon(large);
        png
    }
}

/// `premultiplied`: shell images are; icon bitmaps aren't.
unsafe fn bitmap_to_png(bmp: HBITMAP, premultiplied: bool) -> Option<Vec<u8>> {
    let mut info = BITMAP::default();
    if GetObjectW(
        HGDIOBJ(bmp.0),
        std::mem::size_of::<BITMAP>() as i32,
        Some(&mut info as *mut _ as *mut _),
    ) == 0
    {
        return None;
    }
    let (w, h) = (info.bmWidth, info.bmHeight.abs());
    let mut bi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w,
            biHeight: -h, // top-down
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut px = vec![0u8; (w * h * 4) as usize];
    let dc = GetDC(None);
    let lines = GetDIBits(
        dc,
        bmp,
        0,
        h as u32,
        Some(px.as_mut_ptr() as *mut _),
        &mut bi,
        DIB_RGB_COLORS,
    );
    ReleaseDC(None, dc);
    if lines == 0 {
        return None;
    }
    // Legacy icons carry no alpha at all: treat them as opaque.
    let no_alpha = px.chunks_exact(4).all(|p| p[3] == 0);
    // BGRA → RGBA (straight alpha).
    for p in px.chunks_exact_mut(4) {
        if no_alpha {
            p.swap(0, 2);
            p[3] = 255;
            continue;
        }
        if !premultiplied {
            p.swap(0, 2);
            continue;
        }
        let a = p[3] as u32;
        let (b, g, r) = (p[0] as u32, p[1] as u32, p[2] as u32);
        let un = |c: u32| {
            (c * 255 + a / 2)
                .checked_div(a)
                .map_or(0, |v| v.min(255) as u8)
        };
        p[0] = un(r);
        p[1] = un(g);
        p[2] = un(b);
    }
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w as u32, h as u32);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().ok()?;
        writer.write_image_data(&px).ok()?;
    }
    Some(out)
}

/* ───────────────────────────── previews ───────────────────────────── */

pub fn set_previews(
    map: &Mutex<HashMap<i64, isize>>,
    dest: isize,
    scale: f64,
    slots: &[PreviewSlot],
) {
    let mut thumbs = map.lock();
    let wanted: Vec<i64> = slots.iter().map(|s| s.hwnd).collect();
    thumbs.retain(|h, t| {
        let keep = wanted.contains(h);
        if !keep {
            unsafe {
                let _ = DwmUnregisterThumbnail(*t);
            }
        }
        keep
    });
    for s in slots {
        let thumb = match thumbs.get(&s.hwnd) {
            Some(t) => *t,
            None => match unsafe { DwmRegisterThumbnail(HWND(dest as *mut _), hwnd(s.hwnd)) } {
                Ok(t) => {
                    thumbs.insert(s.hwnd, t);
                    t
                }
                Err(_) => continue,
            },
        };
        // Fit the source inside the slot, keeping its aspect ratio.
        let (x, y, w, h) = (s.x * scale, s.y * scale, s.w * scale, s.h * scale);
        let src = unsafe { DwmQueryThumbnailSourceSize(thumb) }.unwrap_or(SIZE {
            cx: w as i32,
            cy: h as i32,
        });
        let k = (w / src.cx.max(1) as f64).min(h / src.cy.max(1) as f64);
        let (tw, th) = (src.cx as f64 * k, src.cy as f64 * k);
        let left = x + (w - tw) / 2.0;
        let top = y + (h - th) / 2.0;
        let props = DWM_THUMBNAIL_PROPERTIES {
            dwFlags: DWM_TNP_RECTDESTINATION
                | DWM_TNP_VISIBLE
                | DWM_TNP_OPACITY
                | DWM_TNP_SOURCECLIENTAREAONLY,
            rcDestination: RECT {
                left: left.round() as i32,
                top: top.round() as i32,
                right: (left + tw).round() as i32,
                bottom: (top + th).round() as i32,
            },
            opacity: 255,
            fVisible: true.into(),
            fSourceClientAreaOnly: false.into(),
            ..Default::default()
        };
        unsafe {
            let _ = DwmUpdateThumbnailProperties(thumb, &props);
        }
    }
}

/* ───────────────────────── places, apps, power ───────────────────────── */

pub fn recycle_bin_items() -> i64 {
    let mut info = SHQUERYRBINFO {
        cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32,
        ..Default::default()
    };
    unsafe {
        if SHQueryRecycleBinW(PCWSTR::null(), &mut info).is_ok() {
            info.i64NumItems
        } else {
            0
        }
    }
}

pub fn empty_recycle_bin() {
    // Flags 0: Windows asks the user to confirm and shows progress.
    unsafe {
        let _ = SHEmptyRecycleBinW(None, PCWSTR::null(), 0);
    }
}

pub fn apps_folder() -> Vec<LauncherApp> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    }
    let mut out = Vec::new();
    let Some(folder) = shell_item("shell:AppsFolder") else {
        return out;
    };
    unsafe {
        let Ok(items) = folder.BindToHandler::<_, IEnumShellItems>(None, &BHID_EnumItems) else {
            return out;
        };
        loop {
            let mut buf = [None];
            let mut n = 0u32;
            if items.Next(&mut buf, Some(&mut n)).is_err() || n == 0 {
                break;
            }
            let Some(item) = buf[0].take() else { break };
            let get = |sigdn| -> Option<String> {
                let p = item.GetDisplayName(sigdn).ok()?;
                let s = p.to_string().ok();
                windows::Win32::System::Com::CoTaskMemFree(Some(p.0 as *const _));
                s
            };
            let (Some(name), Some(id)) =
                (get(SIGDN_NORMALDISPLAY), get(SIGDN_PARENTRELATIVEPARSING))
            else {
                continue;
            };
            if name.trim().is_empty() || id.starts_with("http") {
                continue;
            }
            out.push(LauncherApp {
                pin_key: pin_key_for(&id),
                id,
                name,
            });
        }
    }
    out.sort_by_key(|a| a.name.to_lowercase());
    out.dedup_by(|a, b| a.id == b.id);
    out
}

/// AppsFolder ids are AUMIDs, or `{KNOWNFOLDERID}\relative\path.exe` for classic apps.
fn pin_key_for(id: &str) -> Option<String> {
    if !id.to_lowercase().ends_with(".exe") {
        return Some(id.to_string());
    }
    let (guid, rest) = id.strip_prefix('{')?.split_once("}\\")?;
    let guid = windows::core::GUID::try_from(guid).ok()?;
    unsafe {
        let p = windows::Win32::UI::Shell::SHGetKnownFolderPath(&guid, Default::default(), None)
            .ok()?;
        let base = p.to_string().ok();
        windows::Win32::System::Com::CoTaskMemFree(Some(p.0 as *const _));
        Some(format!("{}\\{}", base?, rest).to_lowercase())
    }
}

pub fn power(action: Power) -> Result<(), String> {
    let run = |args: &[&str]| {
        crate::util::no_console(std::process::Command::new("shutdown.exe").args(args))
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    };
    unsafe {
        match action {
            Power::Lock => LockWorkStation().map_err(|e| e.to_string()),
            Power::Sleep => {
                let _ = SetSuspendState(false, false, false);
                Ok(())
            }
            Power::SignOut => {
                ExitWindowsEx(EWX_LOGOFF, SHUTDOWN_REASON(0)).map_err(|e| e.to_string())
            }
            Power::Restart => run(&["/r", "/t", "0"]),
            Power::Shutdown => run(&["/s", "/t", "0"]),
        }
    }
}
