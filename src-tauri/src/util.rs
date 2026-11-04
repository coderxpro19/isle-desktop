use std::time::{SystemTime, UNIX_EPOCH};

/// Milliseconds since the Unix epoch.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
