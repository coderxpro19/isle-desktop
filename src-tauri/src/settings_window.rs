//! The Isle Settings window: a normal, framed app window.

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "settings";

/// Open (or focus) Settings, optionally on a section ("island", "dock"…).
///
/// Async on purpose: creating a window from a synchronous command deadlocks
/// the main thread on Windows (blank window, frozen app).
#[tauri::command]
pub async fn isle_settings_open(app: AppHandle, section: Option<String>) -> Result<(), String> {
    open(&app, section.as_deref())
}

pub fn open(app: &AppHandle, section: Option<&str>) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(LABEL) {
        if let Some(s) = section {
            let _ = w.emit("settings://section", s);
        }
        let _ = w.unminimize();
        let _ = w.show();
        return w.set_focus().map_err(|e| e.to_string());
    }
    let sec: String = section
        .unwrap_or("general")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    WebviewWindowBuilder::new(
        app,
        LABEL,
        // Plain index.html: the UI routes by window label. A query string in
        // the asset path doesn't resolve on Windows (blank page).
        WebviewUrl::default(),
    )
    .initialization_script(format!("window.__ISLE_SECTION = {sec:?};"))
    .title("Isle Settings")
    .inner_size(860.0, 600.0)
    .min_inner_size(720.0, 480.0)
    .center()
    .resizable(true)
    .maximizable(false)
    // Isle draws its own dark frame (close button, drag area).
    .decorations(false)
    .shadow(true)
    .visible(true)
    .focused(true)
    .build()
    .map(|_| ())
    .map_err(|e| e.to_string())
}
