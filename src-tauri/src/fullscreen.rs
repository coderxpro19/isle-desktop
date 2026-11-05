//! Hide islands while a full-screen app, game, video or presentation is in front.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::settings::SettingsStore;

/// Set once the UI has painted its first frame (see `island_ready`).
pub static ISLAND_READY: AtomicBool = AtomicBool::new(false);

#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

/// A window "covers" a monitor if it spans the whole monitor rect.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn covers(window: Rect, monitor: Rect) -> bool {
    window.left <= monitor.left
        && window.top <= monitor.top
        && window.right >= monitor.right
        && window.bottom >= monitor.bottom
}

pub fn spawn(app: AppHandle) {
    std::thread::Builder::new()
        .name("isle-fullscreen".into())
        .spawn(move || {
            let mut hidden = false;
            // Only re-show what we hid (a disabled dock must stay hidden).
            let mut hid: Vec<String> = Vec::new();
            loop {
                std::thread::sleep(Duration::from_millis(800));
                if !ISLAND_READY.load(Ordering::Relaxed) {
                    continue;
                }
                let enabled = app.state::<SettingsStore>().get().island.hide_in_fullscreen;
                let full = enabled && platform::fullscreen_app_in_front();
                if full == hidden {
                    continue;
                }
                hidden = full;
                if full {
                    for (label, win) in app.webview_windows() {
                        if (label.starts_with("island-") || label.starts_with("dock-"))
                            && win.is_visible().unwrap_or(false)
                        {
                            let _ = win.hide();
                            hid.push(label);
                        }
                    }
                } else {
                    for label in hid.drain(..) {
                        if let Some(win) = app.get_webview_window(&label) {
                            let _ = win.show();
                        }
                    }
                }
            }
        })
        .expect("spawn fullscreen thread");
}

#[cfg(windows)]
mod platform {
    use super::{covers, Rect};
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::UI::Shell::{
        SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE,
        QUNS_RUNNING_D3D_FULL_SCREEN,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId,
    };

    pub fn fullscreen_app_in_front() -> bool {
        if let Ok(state) = unsafe { SHQueryUserNotificationState() } {
            if state == QUNS_RUNNING_D3D_FULL_SCREEN || state == QUNS_PRESENTATION_MODE {
                return true;
            }
            if state == QUNS_BUSY {
                // "Busy" is set for full-screen apps but also some edge cases;
                // confirm with the window geometry below.
                return foreground_covers_monitor();
            }
        }
        foreground_covers_monitor()
    }

    fn foreground_covers_monitor() -> bool {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_invalid() || is_shell_or_self(hwnd) {
                return false;
            }
            let mut wr = RECT::default();
            if GetWindowRect(hwnd, &mut wr).is_err() {
                return false;
            }
            let mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            let mut mi = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if !GetMonitorInfoW(mon, &mut mi).as_bool() {
                return false;
            }
            let r = |r: RECT| Rect {
                left: r.left,
                top: r.top,
                right: r.right,
                bottom: r.bottom,
            };
            covers(r(wr), r(mi.rcMonitor))
        }
    }

    fn is_shell_or_self(hwnd: HWND) -> bool {
        unsafe {
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == std::process::id() {
                return true;
            }
            let mut buf = [0u16; 64];
            let n = GetClassNameW(hwnd, &mut buf) as usize;
            let class = String::from_utf16_lossy(&buf[..n]);
            matches!(
                class.as_str(),
                "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
            )
        }
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn fullscreen_app_in_front() -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MON: Rect = Rect {
        left: 0,
        top: 0,
        right: 1920,
        bottom: 1080,
    };

    #[test]
    fn exact_and_oversized_windows_cover() {
        assert!(covers(MON, MON));
        // Maximised-borderless windows often overhang by a few px.
        assert!(covers(
            Rect {
                left: -8,
                top: -8,
                right: 1928,
                bottom: 1088
            },
            MON
        ));
    }

    #[test]
    fn maximised_window_with_taskbar_does_not_cover() {
        assert!(!covers(
            Rect {
                left: 0,
                top: 0,
                right: 1920,
                bottom: 1040
            },
            MON
        ));
    }

    #[test]
    fn window_on_other_monitor_does_not_cover() {
        let second = Rect {
            left: 1920,
            top: 0,
            right: 3840,
            bottom: 1080,
        };
        assert!(!covers(second, MON));
    }
}
