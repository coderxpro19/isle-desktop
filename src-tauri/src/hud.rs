//! Volume keys → Isle's HUD instead of the Windows volume flyout.
//!
//! A low-level keyboard hook swallows the volume up/down/mute keys and applies
//! the change itself (tagged so the island shows its HUD). Windows never sees the
//! key, so its own flyout doesn't appear. Turned off by the `volumeHud` setting.
//! Brightness keys are handled by firmware, so Windows' brightness flyout still
//! shows; Isle shows its HUD alongside it.

use std::sync::atomic::{AtomicBool, Ordering};

pub static ENABLED: AtomicBool = AtomicBool::new(true);

pub fn set_enabled(on: bool) {
    ENABLED.store(on, Ordering::Relaxed);
}

/// Win+1…9 → the dock's pinned apps (instead of the hidden taskbar's).
pub static WIN_NUMBERS: AtomicBool = AtomicBool::new(false);
static APP: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

pub fn set_win_numbers(on: bool) {
    WIN_NUMBERS.store(on, Ordering::Relaxed);
}

/// `vk` is a top-row digit key 1–9: its dock slot (0-based).
#[cfg_attr(not(windows), allow(dead_code))]
pub fn digit_slot(vk: u32) -> Option<u32> {
    (0x31..=0x39).contains(&vk).then(|| vk - 0x31)
}

/// Each key press moves the volume by 2 %, like Windows.
#[cfg_attr(not(windows), allow(dead_code))]
pub const STEP: f32 = 0.02;

pub fn spawn(app: tauri::AppHandle) {
    let _ = APP.set(app);
    #[cfg(windows)]
    std::thread::Builder::new()
        .name("isle-keys".into())
        .spawn(platform::run)
        .expect("spawn key hook thread");
}

#[cfg(windows)]
mod platform {
    use super::{digit_slot, APP, ENABLED, STEP, WIN_NUMBERS};
    use std::sync::atomic::AtomicU32;
    use tauri::Emitter;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
        KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };

    /// Digit whose key-up we must also swallow.
    static SWALLOWED: AtomicU32 = AtomicU32::new(0);

    fn down(vk: VIRTUAL_KEY) -> bool {
        unsafe { GetAsyncKeyState(vk.0 as i32) as u16 & 0x8000 != 0 }
    }

    /// A harmless unassigned key, so releasing Win doesn't open the Start menu.
    fn mask_win_release() {
        let key = |flags| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0xE8),
                    dwFlags: flags,
                    ..Default::default()
                },
            },
        };
        unsafe {
            SendInput(
                &[key(KEYBD_EVENT_FLAGS(0)), key(KEYEVENTF_KEYUP)],
                std::mem::size_of::<INPUT>() as i32,
            );
        }
    }

    /// Win+digit: returns true when handled (and the key must be swallowed).
    fn win_number(vk: u32, msg: u32) -> bool {
        if msg == WM_KEYUP || msg == WM_SYSKEYUP {
            return SWALLOWED
                .compare_exchange(vk, 0, Ordering::Relaxed, Ordering::Relaxed)
                .is_ok();
        }
        if !WIN_NUMBERS.load(Ordering::Relaxed) {
            return false;
        }
        let Some(slot) = digit_slot(vk) else {
            return false;
        };
        if !(down(VK_LWIN) || down(VK_RWIN)) || down(VK_SHIFT) || down(VK_CONTROL) || down(VK_MENU)
        {
            return false;
        }
        SWALLOWED.store(vk, Ordering::Relaxed);
        mask_win_release();
        if let Some(app) = APP.get() {
            let _ = app.emit(crate::events::DOCK_HOTKEY, slot);
        }
        true
    }
    use crate::controls::{ControlAction, Msg, CONTROLS_TX};
    use std::sync::atomic::Ordering;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        VK_VOLUME_DOWN, VK_VOLUME_MUTE, VK_VOLUME_UP,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage,
        KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    unsafe extern "system" fn hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 {
            if let Some(k) = (lparam.0 as *const KBDLLHOOKSTRUCT).as_ref() {
                if win_number(k.vkCode, wparam.0 as u32) {
                    return LRESULT(1);
                }
                let vk = k.vkCode as u16;
                let ours = ENABLED.load(Ordering::Relaxed)
                    && (vk == VK_VOLUME_UP.0 || vk == VK_VOLUME_DOWN.0 || vk == VK_VOLUME_MUTE.0);
                if ours {
                    let msg = wparam.0 as u32;
                    if msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN {
                        let action = if vk == VK_VOLUME_UP.0 {
                            ControlAction::StepVolume { delta: STEP }
                        } else if vk == VK_VOLUME_DOWN.0 {
                            ControlAction::StepVolume { delta: -STEP }
                        } else {
                            ControlAction::ToggleMute
                        };
                        if let Some(tx) = CONTROLS_TX.get() {
                            let _ = tx.send(Msg::Action(action));
                        }
                    }
                    if msg == WM_KEYDOWN
                        || msg == WM_SYSKEYDOWN
                        || msg == WM_KEYUP
                        || msg == WM_SYSKEYUP
                    {
                        // Swallow: Windows must not see it (no native flyout).
                        return LRESULT(1);
                    }
                }
            }
        }
        CallNextHookEx(None, code, wparam, lparam)
    }

    pub fn run() {
        unsafe {
            let module = GetModuleHandleW(PCWSTR::null()).ok();
            if let Err(e) = SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook), module.map(Into::into), 0)
            {
                log::warn!("volume key hook unavailable: {e}");
                return;
            }
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn digits_map_to_slots() {
        assert_eq!(super::digit_slot(0x31), Some(0));
        assert_eq!(super::digit_slot(0x39), Some(8));
        assert_eq!(super::digit_slot(0x30), None);
        assert_eq!(super::digit_slot(0x41), None);
    }
}
