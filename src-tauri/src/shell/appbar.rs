//! Reserve space at the bottom of the screen so maximised windows stop above the
//! dock ("fixed" mode), via the Windows AppBar API.

/// Physical-pixel rect.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PxRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

/// The strip to reserve at the bottom of `monitor` for a dock `height_px` tall.
pub fn bottom_strip(monitor: PxRect, height_px: i32) -> PxRect {
    PxRect {
        top: monitor.bottom - height_px.max(0),
        ..monitor
    }
}

#[cfg(windows)]
mod platform {
    use super::PxRect;
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::UI::Shell::{
        SHAppBarMessage, ABE_BOTTOM, ABM_NEW, ABM_QUERYPOS, ABM_REMOVE, ABM_SETPOS, APPBARDATA,
    };
    use windows::Win32::UI::WindowsAndMessaging::{RegisterWindowMessageW, WM_USER};

    fn data(hwnd: isize) -> APPBARDATA {
        APPBARDATA {
            cbSize: std::mem::size_of::<APPBARDATA>() as u32,
            hWnd: HWND(hwnd as *mut _),
            ..Default::default()
        }
    }

    pub fn reserve(hwnd: isize, strip: PxRect) {
        unsafe {
            let mut abd = data(hwnd);
            let msg = RegisterWindowMessageW(windows::core::w!("IsleAppBar"));
            abd.uCallbackMessage = if msg != 0 { msg } else { WM_USER + 0x4c };
            // ABM_NEW fails harmlessly if already registered.
            SHAppBarMessage(ABM_NEW, &mut abd);
            abd.uEdge = ABE_BOTTOM;
            abd.rc = RECT {
                left: strip.left,
                top: strip.top,
                right: strip.right,
                bottom: strip.bottom,
            };
            SHAppBarMessage(ABM_QUERYPOS, &mut abd);
            // QUERYPOS may move the rect up past other bars; keep our height.
            let h = strip.bottom - strip.top;
            abd.rc.top = abd.rc.bottom - h;
            SHAppBarMessage(ABM_SETPOS, &mut abd);
        }
    }

    pub fn release(hwnd: isize) {
        unsafe {
            let mut abd = data(hwnd);
            SHAppBarMessage(ABM_REMOVE, &mut abd);
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::PxRect;
    pub fn reserve(_hwnd: isize, _strip: PxRect) {}
    pub fn release(_hwnd: isize) {}
}

pub use platform::{release, reserve};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_is_at_bottom() {
        let m = PxRect {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1080,
        };
        assert_eq!(
            bottom_strip(m, 80),
            PxRect {
                left: 0,
                top: 1000,
                right: 1920,
                bottom: 1080
            }
        );
    }
}
