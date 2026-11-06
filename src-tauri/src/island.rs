//! Island windows.
//!
//! Each island is a transparent, borderless, always-on-top window parked at the
//! top-centre of a monitor and sized for the *largest* state the island can grow
//! to. Everything outside the visible pill is click-through: the UI reports the
//! rectangles it is currently drawing (`island_set_hit_rects`) and a lightweight
//! thread watches the cursor, flipping `set_ignore_cursor_events` only when the
//! cursor crosses a rectangle edge. Resizing the native window on every animation
//! frame would stutter; this keeps animations purely inside the webview.

use parking_lot::Mutex;
use serde::Deserialize;
use std::collections::HashMap;
use std::time::Duration;
use tauri::{
    AppHandle, Emitter, Manager, Monitor, PhysicalPosition, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

use crate::{events, settings::SettingsStore};

/// Logical size of the island canvas (max expanded size + room for shadows and bubbles).
pub const CANVAS_W: f64 = 680.0;
pub const CANVAS_H: f64 = 440.0;
const LABEL_PREFIX: &str = "island-";
/// Windows whose click-through is driven by reported hit rects.
const HIT_TESTED: [&str; 3] = ["island-", "dock-", "edge-"];

#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    fn contains(&self, x: f64, y: f64, slop: f64) -> bool {
        x >= self.x - slop
            && x <= self.x + self.w + slop
            && y >= self.y - slop
            && y <= self.y + self.h + slop
    }
}

/// Interactive regions per island window, in logical px relative to the window.
#[derive(Default)]
pub struct HitRegions(Mutex<HashMap<String, Vec<Rect>>>);

#[tauri::command]
pub fn island_set_hit_rects(
    window: tauri::Window,
    regions: State<'_, HitRegions>,
    rects: Vec<Rect>,
) {
    regions.0.lock().insert(window.label().to_string(), rects);
}

/// Called by the UI once the first frame is painted, so the window never flashes.
#[tauri::command]
pub fn island_ready(window: tauri::Window) -> Result<(), String> {
    log::info!("{} painted", window.label());
    if window.label().starts_with(LABEL_PREFIX) {
        crate::fullscreen::ISLAND_READY.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    if window.label().starts_with("dock-") {
        // The dock decides its own visibility (enabled? mode?) and only then
        // takes over from the taskbar.
        window
            .set_ignore_cursor_events(true)
            .map_err(|e| e.to_string())?;
        crate::dock::mark_dock_ready(window.app_handle());
        return Ok(());
    }
    window.show().map_err(|e| e.to_string())?;
    // Start fully click-through; the hit tester takes over from here.
    window
        .set_ignore_cursor_events(true)
        .map_err(|e| e.to_string())
}

/// Re-place every island after a settings change (notch style / top offset).
pub fn reposition(app: &AppHandle) {
    for (label, win) in app.webview_windows() {
        if label.starts_with(LABEL_PREFIX) {
            if let Ok(Some(m)) = win.current_monitor() {
                place(app, &win, &m);
            }
        }
    }
}

/// Monitors that get an island: the primary first (it hosts `island-0`, which
/// the clipboard hotkey focuses), then the rest unless "all displays" is off.
fn island_monitors(app: &AppHandle) -> Vec<Monitor> {
    let all = app.available_monitors().unwrap_or_default();
    let primary = app
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| all.first().cloned());
    let Some(primary) = primary else {
        return Vec::new();
    };
    let mut out = vec![primary.clone()];
    if app.state::<SettingsStore>().get().island.all_monitors {
        out.extend(
            all.into_iter()
                .filter(|m| m.position() != primary.position()),
        );
    }
    out
}

fn monitors_key(ms: &[Monitor]) -> String {
    ms.iter()
        .map(|m| {
            format!(
                "{},{},{}x{}@{}",
                m.position().x,
                m.position().y,
                m.size().width,
                m.size().height,
                m.scale_factor()
            )
        })
        .collect::<Vec<_>>()
        .join(";")
}

fn create_island(app: &AppHandle, idx: usize, monitor: &Monitor) -> tauri::Result<()> {
    let label = format!("{LABEL_PREFIX}{idx}");
    let win = WebviewWindowBuilder::new(app, &label, WebviewUrl::default())
        .title("Isle")
        .inner_size(CANVAS_W, CANVAS_H)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .focused(false)
        .visible(false)
        .build()?;
    place(app, &win, monitor);

    let app2 = app.clone();
    let win2 = win.clone();
    win.on_window_event(move |e| {
        if let WindowEvent::ScaleFactorChanged { .. } = e {
            if let Ok(Some(m)) = win2.current_monitor() {
                place(&app2, &win2, &m);
            }
        }
    });
    Ok(())
}

/// Make the set of islands (and screen-corner strips) match the connected displays.
pub fn sync_monitors(app: &AppHandle) {
    let monitors = island_monitors(app);
    for (idx, m) in monitors.iter().enumerate() {
        match app.get_webview_window(&format!("{LABEL_PREFIX}{idx}")) {
            Some(w) => place(app, &w, m),
            None => {
                if let Err(e) = create_island(app, idx, m) {
                    log::warn!("island {idx}: {e}");
                }
            }
        }
        crate::edges::ensure_corners(app, idx, m);
    }
    // Displays that went away (or "all displays" turned off).
    for (label, w) in app.webview_windows() {
        let idx = label
            .strip_prefix(LABEL_PREFIX)
            .or_else(|| label.strip_prefix(crate::edges::CORNERS_PREFIX))
            .and_then(|n| n.parse::<usize>().ok());
        if idx.is_some_and(|i| i >= monitors.len() && i > 0) {
            log::info!("closing {label}: display gone");
            let _ = w.close();
        }
    }
}

pub fn create_windows(app: &AppHandle) -> tauri::Result<()> {
    let monitors = island_monitors(app);
    match monitors.first() {
        Some(m) => create_island(app, 0, m)?,
        None => log::warn!("no monitors found"),
    }
    // Other displays (and later hot-plugs) are handled by the watcher.
    let app = app.clone();
    std::thread::Builder::new()
        .name("isle-monitors".into())
        .spawn(move || {
            let mut last = String::new();
            loop {
                let key = format!(
                    "{}|{}",
                    monitors_key(&app.available_monitors().unwrap_or_default()),
                    app.state::<SettingsStore>().get().island.all_monitors
                );
                if key != last {
                    log::info!("displays: {key}");
                    last = key;
                    let a = app.clone();
                    // Window creation must happen on the main thread.
                    let _ = app.run_on_main_thread(move || sync_monitors(&a));
                }
                std::thread::sleep(Duration::from_secs(3));
            }
        })
        .ok();
    Ok(())
}

/// Top-centre of `monitor`, respecting the user's top offset.
fn place(app: &AppHandle, win: &WebviewWindow, monitor: &Monitor) {
    let scale = monitor.scale_factor();
    let isl = app.state::<SettingsStore>().get().island;
    // A notch sits flush against the top edge.
    let offset = if isl.notch_style == crate::settings::NotchStyle::Notch {
        6.0
    } else {
        isl.top_offset as f64
    };
    let (x, y) = top_centre(
        monitor.position().x as f64,
        monitor.position().y as f64,
        monitor.size().width as f64,
        scale,
        offset,
    );
    if let Err(e) = win.set_position(PhysicalPosition::new(x, y)) {
        log::warn!("failed to place island: {e}");
    }
}

fn top_centre(mon_x: f64, mon_y: f64, mon_w: f64, scale: f64, top_offset: f64) -> (i32, i32) {
    let w = CANVAS_W * scale;
    // The island's own top margin is drawn by the UI; the offset here is the
    // user's extra nudge. Islands hug the top edge like the hardware notch.
    let x = mon_x + (mon_w - w) / 2.0;
    let y = mon_y + (top_offset - 6.0).max(0.0) * scale;
    (x.round() as i32, y.round() as i32)
}

/// Watches the cursor and toggles click-through for every island window.
pub fn spawn_hit_tester(app: AppHandle) {
    std::thread::Builder::new()
        .name("isle-hit-test".into())
        .spawn(move || {
            let mut inside_by_label: HashMap<String, bool> = HashMap::new();
            loop {
                let mut near_any = false;
                if let Ok(cursor) = app.cursor_position() {
                    for (label, win) in app.webview_windows() {
                        if !HIT_TESTED.iter().any(|p| label.starts_with(p))
                            || !win.is_visible().unwrap_or(false)
                        {
                            continue;
                        }
                        let (Ok(pos), Ok(size), Ok(scale)) =
                            (win.outer_position(), win.inner_size(), win.scale_factor())
                        else {
                            continue;
                        };
                        let lx = (cursor.x - pos.x as f64) / scale;
                        let ly = (cursor.y - pos.y as f64) / scale;
                        let (w, h) = (size.width as f64 / scale, size.height as f64 / scale);
                        near_any |= lx > -160.0 && lx < w + 160.0 && ly > -160.0 && ly < h + 160.0;

                        let inside = app
                            .state::<HitRegions>()
                            .0
                            .lock()
                            .get(&label)
                            .map(|rects| rects.iter().any(|r| r.contains(lx, ly, 1.0)))
                            .unwrap_or(false);

                        let prev = inside_by_label.insert(label.clone(), inside);
                        if prev != Some(inside) {
                            let _ = win.set_ignore_cursor_events(!inside);
                            let _ = app.emit_to(label.as_str(), events::ISLAND_HOVER, inside);
                        }
                    }
                }
                // ~60 Hz when the cursor is near an island, ~10 Hz otherwise.
                std::thread::sleep(Duration::from_millis(if near_any { 16 } else { 100 }));
            }
        })
        .expect("spawn hit-test thread");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn centres_on_secondary_monitor_with_scaling() {
        // 2560px-wide monitor to the right of a 1920px primary, at 150%.
        let (x, y) = top_centre(1920.0, 0.0, 2560.0, 1.5, 6.0);
        assert_eq!(x, (1920.0 + (2560.0 - CANVAS_W * 1.5) / 2.0).round() as i32);
        assert_eq!(y, 0);
    }

    #[test]
    fn rect_contains_with_slop() {
        let r = Rect {
            x: 10.0,
            y: 10.0,
            w: 100.0,
            h: 30.0,
        };
        assert!(r.contains(10.0, 10.0, 0.0));
        assert!(r.contains(9.5, 40.5, 1.0));
        assert!(!r.contains(200.0, 20.0, 1.0));
    }
}
