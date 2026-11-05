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

/// Each key press moves the volume by 2 %, like Windows.
#[cfg_attr(not(windows), allow(dead_code))]
pub const STEP: f32 = 0.02;

pub fn spawn() {
    #[cfg(windows)]
    std::thread::Builder::new()
        .name("isle-keys".into())
        .spawn(platform::run)
        .expect("spawn key hook thread");
}

#[cfg(windows)]
mod platform {
    use super::{ENABLED, STEP};
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
        if code >= 0 && ENABLED.load(Ordering::Relaxed) {
            if let Some(k) = (lparam.0 as *const KBDLLHOOKSTRUCT).as_ref() {
                let vk = k.vkCode as u16;
                let ours = vk == VK_VOLUME_UP.0 || vk == VK_VOLUME_DOWN.0 || vk == VK_VOLUME_MUTE.0;
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
