//! Wi-Fi network list + connect, and Bluetooth device list + connect / pair,
//! so the island can do it without opening Windows Settings.
//!
//! WinRT calls here are slow (a Wi-Fi scan takes seconds), so every command
//! is async and runs its blocking work on Tauri's blocking pool.

#[cfg(windows)]
mod bluetooth;
#[cfg(windows)]
mod wifi;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WifiNetwork {
    pub ssid: String,
    /// 0–4
    pub signal: u8,
    pub secured: bool,
    /// Windows has a saved profile (password) for it.
    pub saved: bool,
    pub connected: bool,
}

#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum WifiConnectResult {
    Connected,
    /// Secured network with no saved password, or the saved one was rejected.
    NeedsPassword,
    WrongPassword,
    Failed {
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BtDevice {
    pub id: String,
    pub name: String,
    /// "audio" | "input" | "phone" | "computer" | "wearable" | "other"
    pub kind: &'static str,
    pub paired: bool,
    pub connected: bool,
    /// Isle can connect/disconnect it (audio devices); others connect on their own.
    pub can_connect: bool,
}

#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingPrompt {
    pub id: String,
    /// "confirmPin": user must confirm `pin` matches the device;
    /// "displayPin": type `pin` on the device.
    pub kind: &'static str,
    pub pin: String,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BtAction {
    Connect,
    Disconnect,
    Pair,
    Forget,
}

#[cfg(not(windows))]
mod wifi {
    use super::{WifiConnectResult, WifiNetwork};
    pub fn scan() -> Result<Vec<WifiNetwork>, String> {
        Err("Wi-Fi is only available on Windows".into())
    }
    pub fn connect(ssid: &str, _password: Option<&str>) -> Result<WifiConnectResult, String> {
        Ok(WifiConnectResult::Failed {
            message: format!("Can't join {ssid} here"),
        })
    }
    pub fn disconnect() -> Result<(), String> {
        Ok(())
    }
}

#[cfg(not(windows))]
mod bluetooth {
    use super::{BtAction, BtDevice};
    #[derive(Clone)]
    pub struct Bluetooth;
    impl Bluetooth {
        pub fn new(_app: tauri::AppHandle) -> Self {
            Self
        }
        pub fn devices(&self) -> Result<Vec<BtDevice>, String> {
            Ok(Vec::new())
        }
        pub fn set_discovery(&self, _active: bool) {}
        pub fn act(&self, _id: &str, _action: BtAction) -> Result<(), String> {
            Err("Bluetooth is only available on Windows".into())
        }
        pub fn respond(&self, _accept: bool) {}
    }
}

/// Lives in Tauri state; holds the discovery watcher and pairing handshakes.
pub struct ConnectService {
    bt: bluetooth::Bluetooth,
}

impl ConnectService {
    pub fn new(app: AppHandle) -> Self {
        Self {
            bt: bluetooth::Bluetooth::new(app),
        }
    }
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn wifi_scan() -> Result<Vec<WifiNetwork>, String> {
    blocking(wifi::scan).await
}

#[tauri::command]
pub async fn wifi_connect(
    ssid: String,
    password: Option<String>,
) -> Result<WifiConnectResult, String> {
    blocking(move || wifi::connect(&ssid, password.as_deref())).await
}

#[tauri::command]
pub async fn wifi_disconnect() -> Result<(), String> {
    blocking(wifi::disconnect).await
}

#[tauri::command]
pub async fn bt_devices(svc: State<'_, ConnectService>) -> Result<Vec<BtDevice>, String> {
    let bt = svc.bt.clone();
    blocking(move || bt.devices()).await
}

/// Start/stop scanning for new (unpaired) devices; changes arrive as `bt://changed`.
#[tauri::command]
pub fn bt_set_discovery(svc: State<'_, ConnectService>, active: bool) {
    svc.bt.set_discovery(active);
}

#[tauri::command]
pub async fn bt_action(
    svc: State<'_, ConnectService>,
    id: String,
    action: BtAction,
) -> Result<(), String> {
    let bt = svc.bt.clone();
    blocking(move || bt.act(&id, action)).await
}

/// Answer a `bt://pairing` prompt.
#[tauri::command]
pub fn bt_pair_respond(svc: State<'_, ConnectService>, accept: bool) {
    svc.bt.respond(accept);
}

/// Keep one entry per SSID (strongest signal), hide hidden networks, and sort
/// connected → saved → signal → name.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn tidy_networks(mut list: Vec<WifiNetwork>) -> Vec<WifiNetwork> {
    list.retain(|n| !n.ssid.trim().is_empty());
    list.sort_by(|a, b| a.ssid.cmp(&b.ssid).then(b.signal.cmp(&a.signal)));
    let mut out: Vec<WifiNetwork> = Vec::new();
    for n in list {
        match out.last_mut() {
            Some(prev) if prev.ssid == n.ssid => {
                prev.connected |= n.connected;
                prev.saved |= n.saved;
            }
            _ => out.push(n),
        }
    }
    out.sort_by(|a, b| {
        b.connected
            .cmp(&a.connected)
            .then(b.saved.cmp(&a.saved))
            .then(b.signal.cmp(&a.signal))
            .then(a.ssid.to_lowercase().cmp(&b.ssid.to_lowercase()))
    });
    out
}

/// 0x001122AABBCC → "001122AABBCC" (how the address appears in PnP device ids).
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn bt_address_hex(addr: u64) -> String {
    format!("{addr:012X}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn n(ssid: &str, signal: u8, saved: bool, connected: bool) -> WifiNetwork {
        WifiNetwork {
            ssid: ssid.into(),
            signal,
            secured: true,
            saved,
            connected,
        }
    }

    #[test]
    fn dedupes_and_sorts_networks() {
        let out = tidy_networks(vec![
            n("Cafe", 2, false, false),
            n("Home", 1, true, false),
            n("Home", 4, false, true),
            n("", 4, false, false),
            n("Office", 4, false, false),
        ]);
        let names: Vec<_> = out.iter().map(|n| n.ssid.as_str()).collect();
        assert_eq!(names, ["Home", "Office", "Cafe"]);
        assert!(out[0].connected && out[0].saved);
        assert_eq!(out[0].signal, 4);
    }

    #[test]
    fn address_formatting() {
        assert_eq!(bt_address_hex(0x0011_22aa_bbcc), "001122AABBCC");
    }

    #[test]
    fn result_json_shape() {
        let j = serde_json::to_string(&WifiConnectResult::Failed {
            message: "x".into(),
        })
        .unwrap();
        assert_eq!(j, r#"{"status":"failed","message":"x"}"#);
        assert_eq!(
            serde_json::to_string(&WifiConnectResult::NeedsPassword).unwrap(),
            r#"{"status":"needsPassword"}"#
        );
    }
}
