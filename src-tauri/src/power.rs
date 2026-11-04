//! Battery / AC state. Polled cheaply (one syscall every few seconds) and only
//! emitted when something the UI shows actually changes.

use parking_lot::Mutex;
use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::events;

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BatteryState {
    pub has_battery: bool,
    /// 0-100, `None` when unknown.
    pub percent: Option<u8>,
    pub charging: bool,
    pub on_ac: bool,
    pub saver: bool,
    pub minutes_left: Option<u32>,
}

#[derive(Default)]
pub struct PowerState(pub Mutex<BatteryState>);

#[tauri::command]
pub fn battery_state(state: State<'_, PowerState>) -> BatteryState {
    state.0.lock().clone()
}

pub fn spawn_monitor(app: AppHandle) {
    std::thread::Builder::new()
        .name("isle-power".into())
        .spawn(move || loop {
            let next = read();
            let changed = {
                let state = app.state::<PowerState>();
                let mut cur = state.0.lock();
                // `minutes_left` jitters constantly; don't wake the UI just for it.
                let significant = cur.percent != next.percent
                    || cur.charging != next.charging
                    || cur.on_ac != next.on_ac
                    || cur.saver != next.saver
                    || cur.has_battery != next.has_battery;
                *cur = next.clone();
                significant
            };
            if changed {
                let _ = app.emit(events::BATTERY_CHANGED, &next);
            }
            // Poll faster while on AC so plug/unplug feels instant on the island.
            std::thread::sleep(Duration::from_secs(if next.has_battery { 2 } else { 30 }));
        })
        .expect("spawn power thread");
}

#[cfg(windows)]
fn read() -> BatteryState {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    let mut s = SYSTEM_POWER_STATUS::default();
    if unsafe { GetSystemPowerStatus(&mut s) }.is_err() {
        return BatteryState::default();
    }
    from_raw(
        s.ACLineStatus,
        s.BatteryFlag,
        s.BatteryLifePercent,
        s.SystemStatusFlag,
        s.BatteryLifeTime,
    )
}

/// Decode `SYSTEM_POWER_STATUS` fields. Kept platform-independent so it's unit-tested.
#[cfg_attr(not(windows), allow(dead_code))]
fn from_raw(ac: u8, flag: u8, percent: u8, status: u8, life_secs: u32) -> BatteryState {
    const NO_BATTERY: u8 = 128;
    const UNKNOWN: u8 = 255;
    const CHARGING: u8 = 8;
    let has_battery = flag != NO_BATTERY && flag != UNKNOWN;
    BatteryState {
        has_battery,
        percent: (has_battery && percent <= 100).then_some(percent),
        charging: has_battery && flag & CHARGING != 0,
        on_ac: ac == 1,
        saver: status == 1,
        minutes_left: (life_secs != u32::MAX).then_some(life_secs / 60),
    }
}

/// Non-Windows fallback (development on Linux): read sysfs.
#[cfg(not(windows))]
fn read() -> BatteryState {
    let Ok(entries) = std::fs::read_dir("/sys/class/power_supply") else {
        return BatteryState::default();
    };
    let mut st = BatteryState::default();
    for e in entries.flatten() {
        let p = e.path();
        let kind = std::fs::read_to_string(p.join("type")).unwrap_or_default();
        match kind.trim() {
            "Battery" => {
                st.has_battery = true;
                st.percent = std::fs::read_to_string(p.join("capacity"))
                    .ok()
                    .and_then(|s| s.trim().parse().ok());
                st.charging = std::fs::read_to_string(p.join("status"))
                    .map(|s| s.trim() == "Charging")
                    .unwrap_or(false);
            }
            "Mains" => {
                st.on_ac = std::fs::read_to_string(p.join("online"))
                    .map(|s| s.trim() == "1")
                    .unwrap_or(false);
            }
            _ => {}
        }
    }
    st
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_desktop_without_battery() {
        let s = from_raw(1, 128, 255, 0, u32::MAX);
        assert!(!s.has_battery);
        assert_eq!(s.percent, None);
        assert!(s.on_ac);
    }

    #[test]
    fn decodes_charging_laptop() {
        let s = from_raw(1, 8 | 1, 87, 0, u32::MAX);
        assert!(s.has_battery && s.charging);
        assert_eq!(s.percent, Some(87));
        assert_eq!(s.minutes_left, None);
    }

    #[test]
    fn decodes_discharging_with_saver() {
        let s = from_raw(0, 2, 18, 1, 3600);
        assert!(!s.charging && !s.on_ac && s.saver);
        assert_eq!(s.minutes_left, Some(60));
    }
}
