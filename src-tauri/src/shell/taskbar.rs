//! Hide / restore the Windows taskbar.
//!
//! Hiding = taskbar set to auto-hide (so it stops reserving screen space) and its
//! window hidden. The user's original auto-hide setting is saved in a marker file
//! so every restore path can put it back exactly.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

const WATCHDOG_ARG: &str = "--taskbar-watchdog";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    /// Was the taskbar already set to auto-hide before Isle touched it?
    pub autohide_was_on: bool,
}

/// True while Isle wants the taskbar hidden (re-applied if Explorer restarts).
static WANT_HIDDEN: AtomicBool = AtomicBool::new(false);

/// `%APPDATA%\app.isle.desktop\taskbar-hidden.json` — stable without a Tauri handle,
/// because the watchdog process and early startup have none.
pub fn marker_path() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|d| {
        PathBuf::from(d)
            .join("app.isle.desktop")
            .join("taskbar-hidden.json")
    })
}

fn read_marker() -> Option<Marker> {
    let s = std::fs::read_to_string(marker_path()?).ok()?;
    serde_json::from_str(&s).ok()
}

fn write_marker(m: Marker) {
    if let Some(p) = marker_path() {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(p, serde_json::to_string(&m).unwrap_or_default());
    }
}

fn clear_marker() {
    if let Some(p) = marker_path() {
        let _ = std::fs::remove_file(p);
    }
}

/// Call first thing in `main`. If launched as the watchdog, this never returns.
pub fn run_watchdog_if_requested() {
    let args: Vec<String> = std::env::args().collect();
    let Some(i) = args.iter().position(|a| a == WATCHDOG_ARG) else {
        return;
    };
    if let Some(pid) = args.get(i + 1).and_then(|p| p.parse::<u32>().ok()) {
        platform::wait_for_exit(pid);
        // Isle is gone. If it left the taskbar hidden, bring it back.
        restore_taskbar_if_needed();
    }
    std::process::exit(0);
}

/// Restore the taskbar if a previous run left it hidden (crash recovery).
pub fn restore_taskbar_if_needed() {
    if let Some(m) = read_marker() {
        log::info!("restoring taskbar left hidden by a previous run");
        platform::show(m.autohide_was_on);
        clear_marker();
    }
}

/// Hide the taskbar. Idempotent.
pub fn hide() {
    if WANT_HIDDEN.swap(true, Ordering::SeqCst) {
        platform::hide_window_only();
        return;
    }
    // Keep the *original* setting if a marker already exists (crash before restore).
    let autohide_was_on = read_marker()
        .map(|m| m.autohide_was_on)
        .unwrap_or_else(platform::autohide_enabled);
    write_marker(Marker { autohide_was_on });
    platform::hide();
}

/// Show the taskbar and put the user's auto-hide setting back. Idempotent.
pub fn restore() {
    WANT_HIDDEN.store(false, Ordering::SeqCst);
    let was = read_marker().map(|m| m.autohide_was_on);
    if let Some(autohide_was_on) = was {
        platform::show(autohide_was_on);
        clear_marker();
    }
}

/// Start the watchdog process and a guard thread that re-hides the taskbar if
/// Explorer restarts (it recreates the taskbar visible).
pub fn start_guards() {
    platform::spawn_watchdog(WATCHDOG_ARG);

    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("panic: {info}");
        restore();
        prev(info);
    }));

    std::thread::Builder::new()
        .name("isle-taskbar-guard".into())
        .spawn(|| loop {
            std::thread::sleep(Duration::from_millis(1500));
            if WANT_HIDDEN.load(Ordering::SeqCst) && platform::taskbar_visible() {
                platform::hide();
            }
        })
        .expect("spawn taskbar guard");
}

#[cfg(windows)]
mod platform {
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, WAIT_OBJECT_0};
    use windows::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, INFINITE, PROCESS_SYNCHRONIZE,
    };
    use windows::Win32::UI::Shell::{
        SHAppBarMessage, ABM_GETSTATE, ABM_SETSTATE, ABS_AUTOHIDE, APPBARDATA,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        FindWindowExW, FindWindowW, IsWindowVisible, ShowWindow, SW_HIDE, SW_SHOWNA,
    };

    fn bars() -> Vec<HWND> {
        let mut out = Vec::new();
        unsafe {
            if let Ok(h) = FindWindowW(w!("Shell_TrayWnd"), PCWSTR::null()) {
                out.push(h);
            }
            // Taskbars on secondary monitors.
            let mut after: Option<HWND> = None;
            while let Ok(h) =
                FindWindowExW(None, after, w!("Shell_SecondaryTrayWnd"), PCWSTR::null())
            {
                if h.is_invalid() {
                    break;
                }
                out.push(h);
                after = Some(h);
            }
        }
        out
    }

    fn primary() -> Option<HWND> {
        unsafe { FindWindowW(w!("Shell_TrayWnd"), PCWSTR::null()).ok() }
    }

    fn set_autohide(on: bool) {
        let Some(h) = primary() else { return };
        let mut abd = APPBARDATA {
            cbSize: std::mem::size_of::<APPBARDATA>() as u32,
            hWnd: h,
            ..Default::default()
        };
        abd.lParam = LPARAM(if on { ABS_AUTOHIDE as isize } else { 0 });
        unsafe {
            SHAppBarMessage(ABM_SETSTATE, &mut abd);
        }
    }

    pub fn autohide_enabled() -> bool {
        let Some(h) = primary() else { return false };
        let mut abd = APPBARDATA {
            cbSize: std::mem::size_of::<APPBARDATA>() as u32,
            hWnd: h,
            ..Default::default()
        };
        let state = unsafe { SHAppBarMessage(ABM_GETSTATE, &mut abd) };
        state & ABS_AUTOHIDE as usize != 0
    }

    pub fn taskbar_visible() -> bool {
        bars()
            .into_iter()
            .any(|h| unsafe { IsWindowVisible(h).as_bool() })
    }

    pub fn hide_window_only() {
        for h in bars() {
            unsafe {
                let _ = ShowWindow(h, SW_HIDE);
            }
        }
    }

    pub fn hide() {
        set_autohide(true);
        hide_window_only();
    }

    pub fn show(autohide_was_on: bool) {
        for h in bars() {
            unsafe {
                let _ = ShowWindow(h, SW_SHOWNA);
            }
        }
        set_autohide(autohide_was_on);
    }

    pub fn wait_for_exit(pid: u32) {
        unsafe {
            if let Ok(h) = OpenProcess(PROCESS_SYNCHRONIZE, false, pid) {
                let r = WaitForSingleObject(h, INFINITE);
                let _ = r == WAIT_OBJECT_0;
                let _ = CloseHandle(h);
            }
        }
    }

    pub fn spawn_watchdog(arg: &str) {
        let Ok(exe) = std::env::current_exe() else {
            return;
        };
        let r = crate::util::no_console(
            std::process::Command::new(exe)
                .arg(arg)
                .arg(std::process::id().to_string()),
        )
        .spawn();
        if let Err(e) = r {
            log::warn!("could not start taskbar watchdog: {e}");
        }
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn autohide_enabled() -> bool {
        false
    }
    pub fn taskbar_visible() -> bool {
        false
    }
    pub fn hide_window_only() {}
    pub fn hide() {}
    pub fn show(_autohide_was_on: bool) {}
    pub fn wait_for_exit(_pid: u32) {}
    pub fn spawn_watchdog(_arg: &str) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marker_round_trips() {
        let m = Marker {
            autohide_was_on: true,
        };
        let s = serde_json::to_string(&m).unwrap();
        assert_eq!(s, r#"{"autohideWasOn":true}"#);
        assert_eq!(serde_json::from_str::<Marker>(&s).unwrap(), m);
    }
}
