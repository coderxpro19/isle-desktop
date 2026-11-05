//! "Start with Windows": a per-user Run key pointing at Isle's exe.
#![cfg_attr(not(windows), allow(dead_code))]

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const VALUE: &str = "Isle";

/// Command line Windows runs at sign-in.
pub fn command_line(exe: &str) -> String {
    format!("\"{exe}\" --autostart")
}

#[cfg(windows)]
pub fn set(on: bool) {
    use windows::core::HSTRING;
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{
        RegDeleteKeyValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ,
    };
    // Debug builds run from target/; don't register those.
    if cfg!(debug_assertions) {
        return;
    }
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    unsafe {
        let r = if on {
            let mut data: Vec<u16> = command_line(&exe.to_string_lossy())
                .encode_utf16()
                .collect();
            data.push(0);
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                &HSTRING::from(RUN_KEY),
                &HSTRING::from(VALUE),
                REG_SZ.0,
                Some(data.as_ptr() as *const _),
                (data.len() * 2) as u32,
            )
        } else {
            RegDeleteKeyValueW(
                HKEY_CURRENT_USER,
                &HSTRING::from(RUN_KEY),
                &HSTRING::from(VALUE),
            )
        };
        if r != ERROR_SUCCESS && on {
            log::warn!("autostart: couldn't update Run key: {r:?}");
        }
    }
}

#[cfg(not(windows))]
pub fn set(_on: bool) {}

#[cfg(test)]
mod tests {
    #[test]
    fn quotes_path() {
        assert_eq!(
            super::command_line(r"C:\Program Files\Isle\isle.exe"),
            r#""C:\Program Files\Isle\isle.exe" --autostart"#
        );
    }
}
