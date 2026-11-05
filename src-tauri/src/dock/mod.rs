//! The dock: pinned + running apps, window previews, places, and the Start
//! menu (launcher). Replaces the Windows taskbar when enabled.

#[cfg(windows)]
mod win;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindowBuilder,
    WindowEvent,
};

use crate::settings::{DockMode, PinnedApp, SettingsStore};
use crate::shell::{appbar, taskbar};

pub const DOCK_LABEL: &str = "dock-0";
pub const LAUNCHER_LABEL: &str = "launcher";
/// Logical height of the dock window: bar + magnification + previews/menus above it.
pub const DOCK_CANVAS_H: f64 = 340.0;
pub const LAUNCHER_W: f64 = 640.0;
pub const LAUNCHER_H: f64 = 560.0;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DockWindow {
    /// Native window handle (as a number) — passed back for actions/previews.
    pub hwnd: i64,
    pub title: String,
    pub minimized: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DockApp {
    pub key: String,
    pub name: String,
    pub pinned: bool,
    pub running: bool,
    /// Owns the foreground window.
    pub active: bool,
    /// Most recently used first.
    pub windows: Vec<DockWindow>,
}

/// A running top-level window as seen by the platform layer.
#[derive(Debug, Clone, PartialEq)]
pub struct RawWindow {
    pub hwnd: i64,
    pub title: String,
    pub minimized: bool,
    /// Lower-cased full exe path.
    pub exe: String,
    pub aumid: Option<String>,
    pub app_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherApp {
    /// AppsFolder parsing name; launch with `shell:AppsFolder\<id>`.
    pub id: String,
    pub name: String,
    /// Key to pin it with (AUMID or exe path), when resolvable.
    pub pin_key: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Places {
    pub recycle_bin_items: i64,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WindowAction {
    Activate,
    Minimize,
    Close,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Power {
    Lock,
    Sleep,
    SignOut,
    Restart,
    Shutdown,
}

#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct PreviewSlot {
    pub hwnd: i64,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Merge pinned apps with running windows into the dock's app list.
pub fn merge(pinned: &[PinnedApp], windows: &[RawWindow], foreground: i64) -> Vec<DockApp> {
    let matches = |key: &str, w: &RawWindow| {
        w.aumid
            .as_deref()
            .is_some_and(|a| a.eq_ignore_ascii_case(key))
            || w.exe == key.to_lowercase()
    };
    let mut used = vec![false; windows.len()];
    let mut out: Vec<DockApp> = pinned
        .iter()
        .map(|p| {
            let wins: Vec<DockWindow> = windows
                .iter()
                .enumerate()
                .filter(|(_, w)| matches(&p.key, w))
                .map(|(i, w)| {
                    used[i] = true;
                    DockWindow {
                        hwnd: w.hwnd,
                        title: w.title.clone(),
                        minimized: w.minimized,
                    }
                })
                .collect();
            DockApp {
                key: p.key.clone(),
                name: p.name.clone(),
                pinned: true,
                running: !wins.is_empty(),
                active: wins.iter().any(|w| w.hwnd == foreground),
                windows: wins,
            }
        })
        .collect();

    // Unpinned running apps, grouped by identity, in first-seen (z-order) order.
    for (i, w) in windows.iter().enumerate() {
        if used[i] {
            continue;
        }
        let key = w.aumid.clone().unwrap_or_else(|| w.exe.clone());
        let win = DockWindow {
            hwnd: w.hwnd,
            title: w.title.clone(),
            minimized: w.minimized,
        };
        if let Some(app) = out.iter_mut().find(|a| !a.pinned && a.key == key) {
            app.active |= w.hwnd == foreground;
            app.windows.push(win);
        } else {
            out.push(DockApp {
                key,
                name: w.app_name.clone(),
                pinned: false,
                running: true,
                active: w.hwnd == foreground,
                windows: vec![win],
            });
        }
    }
    out
}

pub struct DockService {
    apps: Mutex<Vec<DockApp>>,
    icons: Mutex<HashMap<String, Option<String>>>,
    #[cfg(windows)]
    thumbs: Mutex<HashMap<i64, isize>>,
}

impl DockService {
    pub fn new() -> Self {
        Self {
            apps: Mutex::new(Vec::new()),
            icons: Mutex::new(HashMap::new()),
            #[cfg(windows)]
            thumbs: Mutex::new(HashMap::new()),
        }
    }
}

/// Recompute the app list and emit it if it changed. Called by the window watcher.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn refresh(app: &AppHandle, windows: Vec<RawWindow>, foreground: i64, overlap: bool) {
    let pinned = app
        .state::<SettingsStore>()
        .get()
        .dock
        .pinned
        .unwrap_or_default();
    let next = merge(&pinned, &windows, foreground);
    let svc = app.state::<DockService>();
    let mut cur = svc.apps.lock();
    if *cur != next {
        *cur = next.clone();
        let _ = app.emit(crate::events::DOCK_APPS, &next);
    }
    drop(cur);
    static LAST_OVERLAP: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if LAST_OVERLAP.swap(overlap, std::sync::atomic::Ordering::Relaxed) != overlap {
        let _ = app.emit(crate::events::DOCK_OVERLAP, overlap);
    }
}

/* ───────────────────────── windows (dock + launcher) ───────────────────────── */

pub fn create_windows(app: &AppHandle) -> tauri::Result<()> {
    let Some(mon) = app.primary_monitor()? else {
        return Ok(());
    };
    let scale = mon.scale_factor();
    let (mw, mh) = (
        mon.size().width as f64 / scale,
        mon.size().height as f64 / scale,
    );

    let dock = WebviewWindowBuilder::new(app, DOCK_LABEL, WebviewUrl::default())
        .title("Isle Dock")
        .inner_size(mw, DOCK_CANVAS_H)
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
    let _ = dock.set_position(PhysicalPosition::new(
        mon.position().x,
        mon.position().y + (mh * scale - DOCK_CANVAS_H * scale).round() as i32,
    ));

    let launcher = WebviewWindowBuilder::new(app, LAUNCHER_LABEL, WebviewUrl::default())
        .title("Isle Start")
        .inner_size(LAUNCHER_W, LAUNCHER_H)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible(false)
        .build()?;
    let _ = launcher.set_position(PhysicalPosition::new(
        mon.position().x + ((mw - LAUNCHER_W) / 2.0 * scale).round() as i32,
        mon.position().y + ((mh - LAUNCHER_H - 96.0) * scale).round() as i32,
    ));
    let l2 = launcher.clone();
    launcher.on_window_event(move |e| {
        if let WindowEvent::Focused(false) = e {
            let _ = l2.hide();
        }
    });

    #[cfg(windows)]
    win::spawn_watcher(app.clone());
    Ok(())
}

/// Fill in default pins on first run.
pub fn ensure_default_pins(app: &AppHandle) {
    let store = app.state::<SettingsStore>();
    if store.get().dock.pinned.is_some() {
        return;
    }
    let mut pins = vec![PinnedApp {
        key: "c:\\windows\\explorer.exe".into(),
        name: "File Explorer".into(),
    }];
    let browsers = [
        (
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            "Google Chrome",
        ),
        (
            "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
            "Microsoft Edge",
        ),
    ];
    if let Some((path, name)) = browsers
        .iter()
        .find(|(p, _)| std::path::Path::new(p).exists())
    {
        pins.push(PinnedApp {
            key: path.to_lowercase(),
            name: (*name).into(),
        });
    }
    pins.push(PinnedApp {
        key: "windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel"
            .into(),
        name: "Settings".into(),
    });
    store.update(app, |s| s.dock.pinned = Some(pins));
}

/// Bar height to reserve in fixed mode (logical px).
pub fn bar_height(icon_size: u32) -> f64 {
    icon_size as f64 + 28.0
}

/// Make the dock, the taskbar and the reserved screen space match the settings.
pub fn apply_settings(app: &AppHandle) {
    let s = app.state::<SettingsStore>().get().dock;
    let Some(win) = app.get_webview_window(DOCK_LABEL) else {
        return;
    };
    let hwnd = native_hwnd(&win);
    if !s.enabled {
        let _ = win.hide();
        if let Some(h) = hwnd {
            appbar::release(h);
        }
        taskbar::restore();
        return;
    }
    if crate::fullscreen::ISLAND_READY.load(std::sync::atomic::Ordering::Relaxed) {
        let _ = win.show();
    }
    if s.replace_taskbar {
        taskbar::hide();
    } else {
        taskbar::restore();
    }
    if let (Some(h), Ok(Some(mon))) = (hwnd, win.current_monitor()) {
        if s.mode == DockMode::Fixed {
            let p = mon.position();
            let z = mon.size();
            let m = appbar::PxRect {
                left: p.x,
                top: p.y,
                right: p.x + z.width as i32,
                bottom: p.y + z.height as i32,
            };
            appbar::reserve(
                h,
                appbar::bottom_strip(
                    m,
                    (bar_height(s.icon_size) * mon.scale_factor()).round() as i32,
                ),
            );
        } else {
            appbar::release(h);
        }
    }
}

/// Undo everything on exit.
pub fn teardown(app: &AppHandle) {
    if let Some(h) = app
        .get_webview_window(DOCK_LABEL)
        .as_ref()
        .and_then(native_hwnd)
    {
        appbar::release(h);
    }
    taskbar::restore();
}

fn native_hwnd(win: &tauri::WebviewWindow) -> Option<isize> {
    #[cfg(target_os = "windows")]
    {
        win.hwnd().ok().map(|h| h.0 as isize)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = win;
        None
    }
}

/* ───────────────────────────── commands ───────────────────────────── */

#[tauri::command]
pub fn dock_apps(svc: State<'_, DockService>) -> Vec<DockApp> {
    svc.apps.lock().clone()
}

/// App icon as a PNG data URL (cached). `key` is a dock key or `app:<AppsFolder id>`.
#[tauri::command]
pub async fn dock_icon(app: AppHandle, key: String) -> Result<Option<String>, String> {
    if let Some(hit) = app.state::<DockService>().icons.lock().get(&key) {
        return Ok(hit.clone());
    }
    let k = key.clone();
    let icon = tauri::async_runtime::spawn_blocking(move || platform_icon(&k))
        .await
        .map_err(|e| e.to_string())?;
    app.state::<DockService>()
        .icons
        .lock()
        .insert(key, icon.clone());
    Ok(icon)
}

#[cfg(windows)]
fn platform_icon(key: &str) -> Option<String> {
    win::icon(key)
}
#[cfg(not(windows))]
fn platform_icon(_key: &str) -> Option<String> {
    None
}

#[tauri::command]
pub fn dock_launch(key: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        win::launch(&key)
    }
    #[cfg(not(windows))]
    {
        Err(format!("can't launch {key} here"))
    }
}

#[tauri::command]
pub fn dock_window(hwnd: i64, action: WindowAction) -> Result<(), String> {
    #[cfg(windows)]
    {
        win::window_action(hwnd, action);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (hwnd, action);
        Ok(())
    }
}

#[tauri::command]
pub fn dock_pin(app: AppHandle, key: String, name: String, pinned: bool) {
    app.state::<SettingsStore>().update(&app, |s| {
        let list = s.dock.pinned.get_or_insert_with(Vec::new);
        list.retain(|p| !p.key.eq_ignore_ascii_case(&key));
        if pinned {
            list.push(PinnedApp { key, name });
        }
    });
    #[cfg(windows)]
    win::poke();
}

#[tauri::command]
pub fn dock_reorder(app: AppHandle, keys: Vec<String>) {
    app.state::<SettingsStore>().update(&app, |s| {
        if let Some(list) = s.dock.pinned.as_mut() {
            list.sort_by_key(|p| {
                keys.iter()
                    .position(|k| k.eq_ignore_ascii_case(&p.key))
                    .unwrap_or(usize::MAX)
            });
        }
    });
    #[cfg(windows)]
    win::poke();
}

/// Draw live window thumbnails into the dock window at these rects (logical px,
/// relative to the dock window). An empty list removes all previews.
#[tauri::command]
pub fn dock_previews(app: AppHandle, slots: Vec<PreviewSlot>) {
    #[cfg(windows)]
    if let Some(w) = app.get_webview_window(DOCK_LABEL) {
        let scale = w.scale_factor().unwrap_or(1.0);
        if let Some(h) = native_hwnd(&w) {
            win::set_previews(&app.state::<DockService>().thumbs, h, scale, &slots);
        }
    }
    #[cfg(not(windows))]
    let _ = (app, slots);
}

#[tauri::command]
pub fn dock_places() -> Places {
    #[cfg(windows)]
    {
        Places {
            recycle_bin_items: win::recycle_bin_items(),
        }
    }
    #[cfg(not(windows))]
    {
        Places {
            recycle_bin_items: 0,
        }
    }
}

/// "downloads" | "documents" | "recycle" | "this-pc"
#[tauri::command]
pub fn dock_open_place(place: String) -> Result<(), String> {
    let target = match place.as_str() {
        "downloads" => "shell:Downloads",
        "documents" => "shell:Personal",
        "recycle" => "shell:RecycleBinFolder",
        "this-pc" => "shell:MyComputerFolder",
        _ => return Err("unknown place".into()),
    };
    #[cfg(windows)]
    {
        win::shell_open("explorer.exe", Some(target))
    }
    #[cfg(not(windows))]
    {
        Err(format!("{target} only on Windows"))
    }
}

/// Windows shows its own "are you sure?" dialog.
#[tauri::command]
pub fn dock_empty_recycle_bin() {
    #[cfg(windows)]
    win::empty_recycle_bin();
}

#[tauri::command]
pub async fn launcher_apps() -> Result<Vec<LauncherApp>, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(win::apps_folder)
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
}

#[tauri::command]
pub fn launcher_launch(app: AppHandle, id: String) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(LAUNCHER_LABEL) {
        let _ = w.hide();
    }
    #[cfg(windows)]
    {
        win::shell_open("explorer.exe", Some(&format!("shell:AppsFolder\\{id}")))
    }
    #[cfg(not(windows))]
    {
        Err(format!("can't launch {id} here"))
    }
}

#[tauri::command]
pub fn launcher_toggle(app: AppHandle, show: Option<bool>) {
    let Some(w) = app.get_webview_window(LAUNCHER_LABEL) else {
        return;
    };
    let visible = w.is_visible().unwrap_or(false);
    if show.unwrap_or(!visible) {
        let _ = w.show();
        let _ = w.set_focus();
        let _ = app.emit_to(LAUNCHER_LABEL, crate::events::LAUNCHER_OPENED, ());
    } else {
        let _ = w.hide();
    }
}

#[tauri::command]
pub fn power(app: AppHandle, action: Power) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(LAUNCHER_LABEL) {
        let _ = w.hide();
    }
    #[cfg(windows)]
    {
        win::power(action)
    }
    #[cfg(not(windows))]
    {
        let _ = action;
        Err("power actions only on Windows".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(hwnd: i64, exe: &str, aumid: Option<&str>) -> RawWindow {
        RawWindow {
            hwnd,
            title: format!("w{hwnd}"),
            minimized: false,
            exe: exe.into(),
            aumid: aumid.map(Into::into),
            app_name: exe.into(),
        }
    }

    #[test]
    fn pinned_first_then_running_grouped() {
        let pins = vec![
            PinnedApp {
                key: "c:\\windows\\explorer.exe".into(),
                name: "Explorer".into(),
            },
            PinnedApp {
                key: "Spotify.exe".into(),
                name: "Spotify".into(),
            },
        ];
        let wins = vec![
            w(1, "c:\\code\\code.exe", None),
            w(
                2,
                "c:\\windows\\explorer.exe",
                Some("Microsoft.Windows.Explorer"),
            ),
            w(3, "c:\\code\\code.exe", None),
            w(4, "c:\\x\\spotify.exe", Some("Spotify.exe")),
        ];
        let apps = merge(&pins, &wins, 3);
        let keys: Vec<_> = apps.iter().map(|a| a.key.as_str()).collect();
        assert_eq!(
            keys,
            [
                "c:\\windows\\explorer.exe",
                "Spotify.exe",
                "c:\\code\\code.exe"
            ]
        );
        assert!(apps[0].running && apps[0].pinned);
        assert!(apps[1].running, "matched by AUMID, case-insensitive");
        assert_eq!(apps[2].windows.len(), 2);
        assert!(apps[2].active);
        assert!(!apps[0].active);
    }

    #[test]
    fn pinned_not_running() {
        let pins = vec![PinnedApp {
            key: "c:\\a.exe".into(),
            name: "A".into(),
        }];
        let apps = merge(&pins, &[], 0);
        assert_eq!(apps.len(), 1);
        assert!(!apps[0].running && apps[0].windows.is_empty());
    }

    #[test]
    fn bar_height_grows_with_icons() {
        assert!(bar_height(64) > bar_height(48));
    }
}
