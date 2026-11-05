//! Windows notifications mirrored into the island.
//!
//! Reads the Action Center through `UserNotificationListener`. Unpackaged apps
//! can't subscribe to its change event, so a thread polls it (1 s); that's a
//! cheap in-process call. Access is the user's "Let apps access your
//! notifications" privacy switch.

#[cfg(windows)]
mod win;

use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashSet;
use std::sync::Arc;
use tauri::{AppHandle, State};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    pub id: u32,
    pub app: String,
    /// AppUserModelID, used to open the app.
    pub app_id: String,
    pub title: String,
    pub body: String,
    /// PNG/JPEG data URL of the app logo.
    pub icon: Option<String>,
    pub at_ms: u64,
}

#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum Access {
    #[default]
    Unknown,
    Allowed,
    Denied,
    Unsupported,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NoticeState {
    pub access: Access,
    /// Newest first.
    pub items: Vec<Notice>,
}

#[derive(Clone, Default)]
pub struct Notifications {
    pub(crate) state: Arc<Mutex<NoticeState>>,
}

/// Which ids are new since the last poll, and which disappeared.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn diff(prev: &HashSet<u32>, now: &[u32]) -> (Vec<u32>, Vec<u32>) {
    let cur: HashSet<u32> = now.iter().copied().collect();
    let added = now.iter().copied().filter(|i| !prev.contains(i)).collect();
    let mut removed: Vec<u32> = prev.difference(&cur).copied().collect();
    removed.sort_unstable();
    (added, removed)
}

/// Toast text elements → (title, body).
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn split_text(texts: &[String]) -> (String, String) {
    let mut it = texts.iter().map(|t| t.trim()).filter(|t| !t.is_empty());
    let title = it.next().unwrap_or_default().to_string();
    let body = it.collect::<Vec<_>>().join("\n");
    (title, body)
}

impl Notifications {
    pub fn spawn(app: AppHandle) -> Self {
        let me = Self::default();
        #[cfg(windows)]
        {
            let state = me.state.clone();
            std::thread::Builder::new()
                .name("isle-notify".into())
                .spawn(move || win::run(app, state))
                .ok();
        }
        #[cfg(not(windows))]
        {
            let _ = app;
            me.state.lock().access = Access::Unsupported;
        }
        me
    }
}

#[tauri::command]
pub fn notify_state(n: State<'_, Notifications>) -> NoticeState {
    n.state.lock().clone()
}

#[tauri::command]
pub fn notify_dismiss(id: Option<u32>) {
    #[cfg(windows)]
    win::dismiss(id);
    #[cfg(not(windows))]
    let _ = id;
}

#[tauri::command]
pub fn notify_open(app_id: String) -> Result<(), String> {
    if app_id.is_empty() {
        return Err("unknown app".into());
    }
    crate::dock::open_shell(&format!("shell:AppsFolder\\{app_id}"))
}

#[tauri::command]
pub fn notify_settings() -> Result<(), String> {
    crate::dock::open_shell("ms-settings:privacy-notifications")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diffs() {
        let prev: HashSet<u32> = [1, 2, 3].into();
        let (a, r) = diff(&prev, &[3, 4, 1]);
        assert_eq!(a, vec![4]);
        assert_eq!(r, vec![2]);
    }

    #[test]
    fn splits() {
        let t = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(
            split_text(&t(&["Ada", " hi ", "", "there"])),
            ("Ada".into(), "hi\nthere".into())
        );
        assert_eq!(split_text(&[]), (String::new(), String::new()));
    }
}
