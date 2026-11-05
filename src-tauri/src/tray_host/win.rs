//! Windows side of the tray host: the `Shell_TrayWnd` window and click delivery.

use parking_lot::Mutex;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::DataExchange::COPYDATASTRUCT;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    AllowSetForegroundWindow, CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW,
    FindWindowExW, GetMessageW, GetWindowThreadProcessId, PostMessageW, PostQuitMessage,
    RegisterClassExW, RegisterWindowMessageW, SendMessageTimeoutW, SetTimer, SetWindowPos,
    TranslateMessage, HWND_BROADCAST, HWND_TOPMOST, MSG, SMTO_ABORTIFHUNG, SWP_NOACTIVATE,
    SWP_NOMOVE, SWP_NOSIZE, WINDOW_EX_STYLE, WM_CLOSE, WM_COMMAND, WM_CONTEXTMENU, WM_COPYDATA,
    WM_DESTROY, WM_LBUTTONDBLCLK, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_RBUTTONDOWN, WM_RBUTTONUP,
    WM_TIMER, WM_USER, WNDCLASSEXW, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
};

use super::{apply, emit, parse, TrayButton, TrayHost, TrayIcon};

/// Our `Shell_TrayWnd`, 0 when not hosting.
static OUR_HWND: AtomicIsize = AtomicIsize::new(0);
static APP: OnceLock<AppHandle> = OnceLock::new();
static SEQ: Mutex<u64> = Mutex::new(0);
/// Screen point of the last tray click, for Shell_NotifyIconGetRect queries.
static LAST_CLICK: Mutex<(i32, i32)> = Mutex::new((0, 0));

const NIN_SELECT: u32 = WM_USER;
const TIMER_TOPMOST: usize = 1;

fn taskbar_created() -> u32 {
    unsafe { RegisterWindowMessageW(w!("TaskbarCreated")) }
}

pub fn broadcast_taskbar_created() {
    unsafe {
        let _ = PostMessageW(
            Some(HWND_BROADCAST),
            taskbar_created(),
            WPARAM(0),
            LPARAM(0),
        );
    }
}

/// Explorer's own tray window (not ours).
fn explorer_tray() -> Option<HWND> {
    let ours = OUR_HWND.load(Ordering::SeqCst);
    let mut after: Option<HWND> = None;
    unsafe {
        while let Ok(h) = FindWindowExW(None, after, w!("Shell_TrayWnd"), PCWSTR::null()) {
            if h.is_invalid() {
                return None;
            }
            if h.0 as isize != ours {
                return Some(h);
            }
            after = Some(h);
        }
    }
    None
}

fn forward(msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    let Some(target) = explorer_tray() else {
        return LRESULT(0);
    };
    let mut result = 0usize;
    unsafe {
        SendMessageTimeoutW(
            target,
            msg,
            wparam,
            lparam,
            SMTO_ABORTIFHUNG,
            500,
            Some(&mut result),
        );
    }
    LRESULT(result as isize)
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_COPYDATA => {
            let Some(cds) = (lparam.0 as *const COPYDATASTRUCT).as_ref() else {
                return LRESULT(0);
            };
            match cds.dwData {
                // Shell_NotifyIcon
                1 => {
                    if !cds.lpData.is_null() {
                        let bytes = std::slice::from_raw_parts(
                            cds.lpData as *const u8,
                            cds.cbData as usize,
                        );
                        if let (Some(d), Some(app)) = (parse(bytes), APP.get()) {
                            let changed = {
                                let host = app.state::<TrayHost>();
                                let mut icons = host.icons.lock();
                                apply(&mut icons, &d, &mut SEQ.lock(), |h| {
                                    crate::dock::hicon_png(h as isize)
                                })
                            };
                            if changed {
                                emit(app);
                            }
                        }
                    }
                    // Keep Explorer in sync so nothing is lost when we stop.
                    let _ = forward(msg, wparam, lparam);
                    LRESULT(1)
                }
                // Shell_NotifyIconGetRect: answer with a small box at the last click.
                3 if cds.cbData >= 8 => {
                    let query = *(cds.lpData as *const u32).add(1);
                    let (x, y) = *LAST_CLICK.lock();
                    let pack =
                        |a: i32, b: i32| ((a as u16 as u32) | ((b as u16 as u32) << 16)) as isize;
                    match query {
                        1 => LRESULT(pack(x - 12, y - 12)),
                        2 => LRESULT(pack(x + 12, y + 12)),
                        _ => LRESULT(0),
                    }
                }
                // AppBar messages and anything else: Explorer handles them.
                _ => forward(msg, wparam, lparam),
            }
        }
        WM_TIMER if wparam.0 == TIMER_TOPMOST => {
            // Stay first in z-order so FindWindow("Shell_TrayWnd") finds us.
            let _ = SetWindowPos(
                hwnd,
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
            LRESULT(0)
        }
        WM_COMMAND => {
            // e.g. "minimise all" style commands sent to the taskbar.
            if let Some(t) = explorer_tray() {
                let _ = PostMessageW(Some(t), msg, wparam, lparam);
            }
            LRESULT(0)
        }
        WM_CLOSE => {
            let _ = DestroyWindow(hwnd);
            LRESULT(0)
        }
        WM_DESTROY => {
            OUR_HWND.store(0, Ordering::SeqCst);
            PostQuitMessage(0);
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

pub fn set_enabled(app: &AppHandle, on: bool) {
    let _ = APP.set(app.clone());
    let running = OUR_HWND.load(Ordering::SeqCst) != 0;
    if on && !running {
        start();
    } else if !on && running {
        shutdown();
    }
}

fn start() {
    std::thread::Builder::new()
        .name("isle-tray".into())
        .spawn(|| unsafe {
            let Ok(module) = GetModuleHandleW(PCWSTR::null()) else {
                return;
            };
            let class = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                lpfnWndProc: Some(wndproc),
                hInstance: module.into(),
                lpszClassName: w!("Shell_TrayWnd"),
                ..Default::default()
            };
            // Fails harmlessly if already registered by an earlier start.
            RegisterClassExW(&class);
            let hwnd = match CreateWindowExW(
                WINDOW_EX_STYLE(WS_EX_TOPMOST.0 | WS_EX_TOOLWINDOW.0),
                w!("Shell_TrayWnd"),
                w!(""),
                WS_POPUP,
                0,
                0,
                0,
                0,
                None,
                None,
                Some(module.into()),
                None,
            ) {
                Ok(h) => h,
                Err(e) => {
                    log::warn!("tray host unavailable: {e}");
                    return;
                }
            };
            OUR_HWND.store(hwnd.0 as isize, Ordering::SeqCst);
            let _ = SetWindowPos(
                hwnd,
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
            SetTimer(Some(hwnd), TIMER_TOPMOST, 500, None);
            log::info!("tray host started");
            // Ask every app to (re)send its icons — now to us.
            broadcast_taskbar_created();

            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            log::info!("tray host stopped");
            if let Some(app) = APP.get() {
                app.state::<TrayHost>().icons.lock().clear();
                emit(app);
            }
            // Hand the icons back to Explorer.
            broadcast_taskbar_created();
        })
        .expect("spawn tray thread");
}

pub fn shutdown() {
    let h = OUR_HWND.swap(0, Ordering::SeqCst);
    if h != 0 {
        unsafe {
            let _ = PostMessageW(Some(HWND(h as *mut _)), WM_CLOSE, WPARAM(0), LPARAM(0));
        }
    }
}

/// Deliver a click the way Explorer does, for both callback conventions.
pub fn click(icon: &TrayIcon, button: TrayButton, x: i32, y: i32) {
    *LAST_CLICK.lock() = (x, y);
    let target = HWND(icon.hwnd as usize as *mut _);
    unsafe {
        let mut pid = 0u32;
        GetWindowThreadProcessId(target, Some(&mut pid));
        // Let the app bring its menu/window to the front.
        let _ = AllowSetForegroundWindow(pid);
        let v4 = icon.version >= 4;
        let send = |m: u32| {
            let (wp, lp) = if v4 {
                let pos = ((x as u16 as u32) | ((y as u16 as u32) << 16)) as usize;
                (
                    WPARAM(pos),
                    LPARAM(((m & 0xffff) | ((icon.uid & 0xffff) << 16)) as isize),
                )
            } else {
                (WPARAM(icon.uid as usize), LPARAM(m as isize))
            };
            let _ = PostMessageW(Some(target), icon.callback, wp, lp);
        };
        match button {
            TrayButton::Left => {
                send(WM_LBUTTONDOWN);
                send(WM_LBUTTONUP);
                if v4 {
                    send(NIN_SELECT);
                }
            }
            TrayButton::Double => send(WM_LBUTTONDBLCLK),
            TrayButton::Right => {
                send(WM_RBUTTONDOWN);
                send(WM_RBUTTONUP);
                if v4 {
                    send(WM_CONTEXTMENU);
                }
            }
        }
    }
}
