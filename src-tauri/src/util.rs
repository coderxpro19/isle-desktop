use std::time::{SystemTime, UNIX_EPOCH};

/// Milliseconds since the Unix epoch.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Don't flash a console window for helper processes (no-op off Windows).
/// `target_os` rather than `windows` so the Linux type-check harness skips it.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn no_console(cmd: &mut std::process::Command) -> &mut std::process::Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
    }
    cmd
}
