//! Small system helpers: open Windows Settings pages, current location.

use serde::Serialize;

/// Settings pages the UI may open. Anything else is rejected.
pub fn settings_uri(page: &str) -> Option<&'static str> {
    Some(match page {
        "sound" => "ms-settings:sound",
        "display" => "ms-settings:display",
        "wifi" => "ms-settings:network-wifi",
        "network" => "ms-settings:network-status",
        "bluetooth" => "ms-settings:bluetooth",
        "focus" => "ms-settings:quiethours",
        "notifications" => "ms-settings:notifications",
        "battery" => "ms-settings:batterysaver",
        "location" => "ms-settings:privacy-location",
        "taskmgr" => "taskmgr.exe",
        _ => return None,
    })
}

#[tauri::command]
pub fn open_settings(page: String) -> Result<(), String> {
    let target = settings_uri(&page).ok_or_else(|| format!("unknown settings page: {page}"))?;
    platform::open(target)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Position {
    pub latitude: f64,
    pub longitude: f64,
}

/// Device location (Windows location services). Blocking WinRT work runs off
/// the async runtime.
#[tauri::command]
pub async fn location_current() -> Result<Position, String> {
    tauri::async_runtime::spawn_blocking(platform::locate)
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(windows)]
mod platform {
    use super::Position;
    use windows::core::{HSTRING, PCWSTR};
    use windows::Devices::Geolocation::{GeolocationAccessStatus, Geolocator};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    pub fn open(target: &str) -> Result<(), String> {
        let h = unsafe {
            ShellExecuteW(
                None,
                &HSTRING::from("open"),
                &HSTRING::from(target),
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            )
        };
        // ShellExecute returns a value > 32 on success.
        if h.0 as usize > 32 {
            Ok(())
        } else {
            Err(format!("could not open {target}"))
        }
    }

    pub fn locate() -> Result<Position, String> {
        let access = Geolocator::RequestAccessAsync()
            .and_then(|op| op.join())
            .map_err(|e| e.to_string())?;
        if access != GeolocationAccessStatus::Allowed {
            return Err(
                "Location access is off. Turn it on in Settings → Privacy → Location.".into(),
            );
        }
        let pos = Geolocator::new()
            .and_then(|g| g.GetGeopositionAsync())
            .and_then(|op| op.join())
            .and_then(|p| p.Coordinate())
            .and_then(|c| c.Point())
            .and_then(|p| p.Position())
            .map_err(|e| e.to_string())?;
        Ok(Position {
            latitude: pos.Latitude,
            longitude: pos.Longitude,
        })
    }
}

#[cfg(not(windows))]
mod platform {
    use super::Position;
    pub fn open(target: &str) -> Result<(), String> {
        Err(format!("{target} is only available on Windows"))
    }
    pub fn locate() -> Result<Position, String> {
        Err("Location is only available on Windows".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_pages_open() {
        assert_eq!(settings_uri("sound"), Some("ms-settings:sound"));
        assert_eq!(settings_uri("https://evil.example"), None);
        assert_eq!(settings_uri("ms-settings:sound"), None);
    }
}
