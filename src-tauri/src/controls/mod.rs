//! Command centre: volume, brightness, Wi-Fi, Bluetooth and network status.
//!
//! One thread owns every COM/WinRT object (multithreaded apartment). Volume,
//! radios and network are event-driven; brightness has no change event we can
//! subscribe to cheaply, so it is polled — but only while the UI shows the
//! controls (`controls_set_active`).

#[cfg(windows)]
mod brightness;
#[cfg(windows)]
mod win;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::{mpsc, Arc};
use tauri::{AppHandle, Emitter, State};

use crate::events;

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ControlsState {
    pub volume: Option<VolumeState>,
    pub brightness: Option<BrightnessState>,
    pub wifi: Option<RadioInfo>,
    pub bluetooth: Option<RadioInfo>,
    pub network: NetworkState,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VolumeState {
    /// 0.0 – 1.0
    pub level: f32,
    pub muted: bool,
    /// Friendly name of the default output device.
    pub device: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BrightnessState {
    /// 0 – 100
    pub level: u8,
    /// "internal" (laptop panel via WMI) or "external" (DDC/CI monitor).
    pub source: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RadioInfo {
    pub on: bool,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NetworkState {
    /// "wifi" | "ethernet" | "cellular" | "none"
    pub kind: &'static str,
    /// SSID for Wi-Fi, profile name otherwise.
    pub name: Option<String>,
    /// Wi-Fi/cellular signal, 0–5.
    pub signal: Option<u8>,
    pub online: bool,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
// Variant names are the JSON contract with the UI (`setVolume`, …).
#[allow(clippy::enum_variant_names)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ControlAction {
    SetVolume { level: f32 },
    SetMute { muted: bool },
    SetBrightness { level: u8 },
    SetWifi { on: bool },
    SetBluetooth { on: bool },
}

#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, Clone, Copy)]
pub(crate) enum Msg {
    Action(ControlAction),
    Active(bool),
    /// Volume callback fired (level, muted, caused-by-us).
    Volume(f32, bool),
    /// Default output device changed.
    DeviceChanged,
    RadiosChanged,
    NetworkChanged,
}

pub struct ControlsService {
    tx: mpsc::Sender<Msg>,
    state: Arc<Mutex<ControlsState>>,
}

impl ControlsService {
    pub fn spawn(app: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel();
        let state = Arc::new(Mutex::new(ControlsState::default()));
        #[cfg(windows)]
        {
            let (state, tx2) = (state.clone(), tx.clone());
            std::thread::Builder::new()
                .name("isle-controls".into())
                .spawn(move || win::run(app, state, tx2, rx))
                .expect("spawn controls thread");
        }
        #[cfg(not(windows))]
        {
            let _ = (app, rx);
        }
        Self { tx, state }
    }
}

#[tauri::command]
pub fn controls_state(svc: State<'_, ControlsService>) -> ControlsState {
    svc.state.lock().clone()
}

#[tauri::command]
pub fn controls_set(svc: State<'_, ControlsService>, action: ControlAction) -> Result<(), String> {
    svc.tx
        .send(Msg::Action(clamp(action)))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn controls_set_active(svc: State<'_, ControlsService>, active: bool) {
    let _ = svc.tx.send(Msg::Active(active));
}

fn clamp(a: ControlAction) -> ControlAction {
    match a {
        ControlAction::SetVolume { level } => ControlAction::SetVolume {
            level: if level.is_finite() {
                level.clamp(0.0, 1.0)
            } else {
                0.0
            },
        },
        ControlAction::SetBrightness { level } => ControlAction::SetBrightness {
            level: level.min(100),
        },
        other => other,
    }
}

/// Store and emit if changed.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn publish(
    app: &AppHandle,
    shared: &Mutex<ControlsState>,
    f: impl FnOnce(&mut ControlsState),
) {
    let mut cur = shared.lock();
    let before = cur.clone();
    f(&mut cur);
    if *cur != before {
        let _ = app.emit(events::CONTROLS_CHANGED, &*cur);
    }
}

/// While dragging a slider the UI sends a burst of set-actions; only the last
/// of each kind matters.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn coalesce(actions: Vec<ControlAction>) -> Vec<ControlAction> {
    let mut out: Vec<ControlAction> = Vec::new();
    for a in actions {
        let same = |b: &ControlAction| std::mem::discriminant(b) == std::mem::discriminant(&a);
        if let Some(slot) = out.iter_mut().find(|b| same(b)) {
            *slot = a;
        } else {
            out.push(a);
        }
    }
    out
}

/// Windows reports Wi-Fi strength as 0–5 bars.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn clamp_bars(bars: u8) -> u8 {
    bars.min(5)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_json() {
        let a: ControlAction = serde_json::from_str(r#"{"type":"setVolume","level":0.5}"#).unwrap();
        assert_eq!(a, ControlAction::SetVolume { level: 0.5 });
        let b: ControlAction = serde_json::from_str(r#"{"type":"setWifi","on":false}"#).unwrap();
        assert_eq!(b, ControlAction::SetWifi { on: false });
    }

    #[test]
    fn clamps_out_of_range() {
        assert_eq!(
            clamp(ControlAction::SetVolume { level: 1.7 }),
            ControlAction::SetVolume { level: 1.0 }
        );
        assert_eq!(
            clamp(ControlAction::SetVolume { level: f32::NAN }),
            ControlAction::SetVolume { level: 0.0 }
        );
        assert_eq!(
            clamp(ControlAction::SetBrightness { level: 250 }),
            ControlAction::SetBrightness { level: 100 }
        );
    }

    #[test]
    fn coalesce_keeps_last_per_kind_in_order() {
        let out = coalesce(vec![
            ControlAction::SetVolume { level: 0.1 },
            ControlAction::SetBrightness { level: 10 },
            ControlAction::SetVolume { level: 0.4 },
            ControlAction::SetMute { muted: true },
            ControlAction::SetVolume { level: 0.6 },
        ]);
        assert_eq!(
            out,
            vec![
                ControlAction::SetVolume { level: 0.6 },
                ControlAction::SetBrightness { level: 10 },
                ControlAction::SetMute { muted: true },
            ]
        );
    }
}
