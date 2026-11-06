//! Persisted settings. Stored as JSON in the app config dir
//! (`%APPDATA%\app.isle.desktop\settings.json` on Windows).
//!
//! Every field has a serde default so old files keep loading as the schema grows,
//! and the UI is the source of truth for validation of individual values.

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::events;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub version: u32,
    pub island: IslandSettings,
    pub appearance: Appearance,
    pub weather: WeatherSettings,
    pub dock: DockSettings,
    pub calendar: CalendarSettings,
    pub general: GeneralSettings,
    pub overlays: OverlaySettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct GeneralSettings {
    /// Launch Isle when you sign in to Windows.
    pub start_with_windows: bool,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            start_with_windows: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CalendarSettings {
    pub feeds: Vec<CalendarFeed>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CalendarFeed {
    pub url: String,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct IslandSettings {
    /// Pixels from the top edge of the monitor.
    pub top_offset: u32,
    /// Show seconds in the clock.
    pub show_seconds: bool,
    /// 24h clock.
    pub clock_24h: bool,
    /// Show battery percentage text next to the icon.
    pub battery_percent: bool,
    /// Expand automatically on hover instead of a smaller peek.
    pub expand_on_hover: bool,
    /// Audio-reactive visualiser (captures system audio while music plays).
    pub visualizer: bool,
    /// Briefly show a live activity when the charger is plugged in.
    pub charging_activity: bool,
    /// Hide the island while a full-screen app, game or video is in front.
    pub hide_in_fullscreen: bool,
    /// Isle focus mode: suppresses alerts (and notifications, from Phase 4).
    pub focus_mode: bool,
    /// Volume keys show Isle's HUD instead of the Windows flyout.
    pub volume_hud: bool,
    /// Show Windows notifications on the island.
    pub notifications: bool,
    /// Keep clipboard history (Alt+Shift+V).
    pub clipboard_history: bool,
    /// Flush against the top edge like a notch, or a floating pill.
    pub notch_style: NotchStyle,
    /// How hovering behaves.
    pub notch_behavior: NotchBehavior,
    /// How long to rest on the island before it peeks (ms).
    pub peek_delay_ms: u32,
    /// Reopen on the last page used instead of the control centre.
    pub remember_panel: bool,
    /// Show visualiser and artwork while collapsed and music plays.
    pub compact_mode: bool,
    /// Status widgets either side of the clock in the open island.
    pub widgets_left: Vec<String>,
    pub widgets_right: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum NotchStyle {
    #[default]
    Notch,
    Floating,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum NotchBehavior {
    /// Hover peeks, click opens.
    #[default]
    Smart,
    /// Hover opens fully.
    Hover,
    /// Nothing on hover; click opens.
    Click,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct OverlaySettings {
    /// Volume HUD slides in from the left edge on hover.
    pub volume_edge: bool,
    /// Isle brightness HUD (right edge).
    pub brightness_hud: bool,
    /// Brightness HUD slides in from the right edge on hover.
    pub brightness_edge: bool,
}

impl Default for OverlaySettings {
    fn default() -> Self {
        Self {
            volume_edge: true,
            brightness_hud: true,
            brightness_edge: true,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum DockMode {
    /// Always visible; maximised windows stop above it.
    #[default]
    Fixed,
    /// Hidden until the cursor touches the bottom edge.
    AutoHide,
    /// Visible, but slides away when a window would overlap it.
    Smart,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct DockSettings {
    pub enabled: bool,
    /// Hide the Windows taskbar while the dock is on.
    pub replace_taskbar: bool,
    pub mode: DockMode,
    pub magnification: bool,
    /// Icon size in logical px.
    pub icon_size: u32,
    /// `None` until first run, when sensible defaults are filled in.
    pub pinned: Option<Vec<PinnedApp>>,
    /// No bar behind the icons.
    pub icon_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PinnedApp {
    /// Identity used to match running windows: an AppUserModelID or a lower-cased exe path.
    pub key: String,
    pub name: String,
}

impl Default for DockSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            replace_taskbar: true,
            mode: DockMode::Fixed,
            magnification: true,
            icon_size: 40,
            pinned: None,
            icon_only: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct WeatherSettings {
    pub location: Option<WeatherLocation>,
    pub fahrenheit: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WeatherLocation {
    pub name: String,
    pub latitude: f64,
    pub longitude: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Appearance {
    /// Accent colour as #rrggbb, or "artwork" to follow album art.
    pub accent: String,
    pub corner_radius: u32,
    pub reduce_motion: bool,
    /// Island / dock surface colour as #rrggbb.
    pub surface: String,
    /// Round the top corners of the screen.
    pub screen_corners: bool,
    /// Opacity of the island and dock surfaces (0.5–1).
    pub background_opacity: f32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            island: Default::default(),
            appearance: Default::default(),
            weather: Default::default(),
            dock: Default::default(),
            calendar: Default::default(),
            general: Default::default(),
            overlays: Default::default(),
        }
    }
}

impl Default for IslandSettings {
    fn default() -> Self {
        Self {
            top_offset: 6,
            show_seconds: false,
            clock_24h: false,
            battery_percent: true,
            expand_on_hover: false,
            visualizer: true,
            charging_activity: true,
            hide_in_fullscreen: true,
            focus_mode: false,
            volume_hud: true,
            notifications: true,
            clipboard_history: true,
            notch_style: NotchStyle::Notch,
            notch_behavior: NotchBehavior::Smart,
            peek_delay_ms: 200,
            remember_panel: true,
            compact_mode: true,
            widgets_left: vec!["weather".into(), "cpu".into()],
            widgets_right: vec!["battery".into(), "ram".into()],
        }
    }
}

impl Default for Appearance {
    fn default() -> Self {
        Self {
            accent: "artwork".into(),
            corner_radius: 22,
            reduce_motion: false,
            surface: "#000000".into(),
            screen_corners: true,
            background_opacity: 1.0,
        }
    }
}

pub const SETTINGS_VERSION: u32 = 2;

/// Bring older settings files up to date.
fn migrate(mut s: Settings) -> Settings {
    if s.version < 2 {
        // v2: smaller default dock (was 48 px).
        if s.dock.icon_size == 48 {
            s.dock.icon_size = 40;
        }
    }
    s.version = SETTINGS_VERSION;
    s
}

pub struct SettingsStore {
    path: Option<PathBuf>,
    inner: RwLock<Settings>,
}

impl SettingsStore {
    pub fn load(app: &AppHandle) -> Self {
        let path = app
            .path()
            .app_config_dir()
            .ok()
            .map(|d| d.join("settings.json"));
        let settings = path
            .as_ref()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|s| match serde_json::from_str::<Settings>(&s) {
                Ok(v) => Some(v),
                Err(e) => {
                    log::warn!("settings.json unreadable, using defaults: {e}");
                    None
                }
            })
            .map(migrate)
            .unwrap_or_default();
        Self {
            path,
            inner: RwLock::new(settings),
        }
    }

    pub fn get(&self) -> Settings {
        self.inner.read().clone()
    }

    fn save(&self, s: &Settings) -> Result<(), String> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        // Write-then-rename so a crash never leaves a half-written file.
        let tmp = path.with_extension("json.tmp");
        let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
        std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, path).map_err(|e| e.to_string())
    }
}

impl SettingsStore {
    /// Change settings from Rust (tray menu etc.), persist, broadcast, and apply.
    pub fn update(&self, app: &AppHandle, f: impl FnOnce(&mut Settings)) {
        let mut next = self.get();
        f(&mut next);
        if let Err(e) = self.save(&next) {
            log::warn!("saving settings failed: {e}");
        }
        *self.inner.write() = next.clone();
        apply(app, &next);
    }

    fn replace(&self, app: &AppHandle, settings: Settings) -> Result<(), String> {
        self.save(&settings)?;
        *self.inner.write() = settings.clone();
        apply(app, &settings);
        Ok(())
    }
}

/// Push settings out to every subsystem and window.
pub fn apply(app: &AppHandle, s: &Settings) {
    crate::hud::set_enabled(s.island.volume_hud);
    crate::clipboard::set_enabled(s.island.clipboard_history);
    crate::autostart::set(s.general.start_with_windows);
    crate::island::reposition(app);
    let _ = app.emit(events::SETTINGS_CHANGED, s);
    crate::dock::apply_settings(app);
}

/// Parse a settings backup (any older version; missing fields get defaults).
pub fn parse_backup(json: &str) -> Result<Settings, String> {
    let v: serde_json::Value = serde_json::from_str(json)
        .map_err(|_| "That isn't a valid Isle settings file.".to_string())?;
    if !v.is_object() || v.get("island").is_none() {
        return Err("That isn't an Isle settings file.".into());
    }
    let s: Settings =
        serde_json::from_value(v).map_err(|e| format!("Couldn't read that file: {e}"))?;
    Ok(migrate(s))
}

#[tauri::command]
pub fn settings_import(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    json: String,
) -> Result<Settings, String> {
    let s = parse_backup(&json)?;
    store.replace(&app, s.clone())?;
    Ok(s)
}

/// Save a backup to Downloads and show it in Explorer. Returns the file path.
#[tauri::command]
pub fn settings_export(app: AppHandle, store: State<'_, SettingsStore>) -> Result<String, String> {
    let dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().document_dir())
        .map_err(|e| e.to_string())?;
    let path = dir.join("Isle settings.json");
    let json = serde_json::to_string_pretty(&store.get()).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    let p = path.to_string_lossy().into_owned();
    let _ = crate::shelf::shelf_reveal(p.clone());
    Ok(p)
}

#[tauri::command]
pub fn settings_get(store: State<'_, SettingsStore>) -> Settings {
    store.get()
}

#[tauri::command]
pub fn settings_set(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    settings: Settings,
) -> Result<(), String> {
    store.replace(&app, settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backups_are_validated() {
        assert!(parse_backup("nope").is_err());
        assert!(parse_backup(r#"{"hello":1}"#).is_err());
        let s = parse_backup(r#"{"version":1,"island":{"clock24h":true},"dock":{"iconSize":48}}"#)
            .unwrap();
        assert!(s.island.clock_24h);
        assert!(s.general.start_with_windows);
        assert_eq!(s.version, SETTINGS_VERSION);
    }

    #[test]
    fn partial_json_fills_defaults() {
        let s: Settings = serde_json::from_str(r#"{"island":{"clock24h":true}}"#).unwrap();
        assert!(s.island.clock_24h);
        assert_eq!(s.island.top_offset, IslandSettings::default().top_offset);
        assert_eq!(s.appearance, Appearance::default());
    }
}
