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
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: 1,
            island: Default::default(),
            appearance: Default::default(),
            weather: Default::default(),
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
        }
    }
}

impl Default for Appearance {
    fn default() -> Self {
        Self {
            accent: "artwork".into(),
            corner_radius: 22,
            reduce_motion: false,
        }
    }
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
    store.save(&settings)?;
    *store.inner.write() = settings.clone();
    let _ = app.emit(events::SETTINGS_CHANGED, settings);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_json_fills_defaults() {
        let s: Settings = serde_json::from_str(r#"{"island":{"clock24h":true}}"#).unwrap();
        assert!(s.island.clock_24h);
        assert_eq!(s.island.top_offset, IslandSettings::default().top_offset);
        assert_eq!(s.appearance, Appearance::default());
    }
}
