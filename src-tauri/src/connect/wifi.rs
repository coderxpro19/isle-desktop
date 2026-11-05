//! Wi-Fi via `Windows.Devices.WiFi`. Saved profiles come from the native WLAN API.

use std::collections::HashSet;
use windows::core::HSTRING;
use windows::Devices::WiFi::{
    WiFiAccessStatus, WiFiAdapter, WiFiAvailableNetwork, WiFiConnectionStatus, WiFiReconnectionKind,
};
use windows::Networking::Connectivity::NetworkAuthenticationType;
use windows::Security::Credentials::PasswordCredential;
use windows::Win32::Foundation::HANDLE;
use windows::Win32::NetworkManagement::WiFi::{
    WlanCloseHandle, WlanEnumInterfaces, WlanFreeMemory, WlanGetProfileList, WlanOpenHandle,
    WLAN_INTERFACE_INFO_LIST, WLAN_PROFILE_INFO_LIST,
};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

use super::{tidy_networks, WifiConnectResult, WifiNetwork};

const NO_ACCESS: &str =
    "Windows blocked Wi-Fi scanning. Turn on Settings → Privacy & security → Location → \"Let desktop apps access your location\".";

fn adapter() -> Result<WiFiAdapter, String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    let access = WiFiAdapter::RequestAccessAsync()
        .and_then(|op| op.join())
        .map_err(|e| e.to_string())?;
    if access != WiFiAccessStatus::Allowed {
        return Err(NO_ACCESS.into());
    }
    let list = WiFiAdapter::FindAllAdaptersAsync()
        .and_then(|op| op.join())
        .map_err(|e| e.to_string())?;
    list.GetAt(0)
        .map_err(|_| "No Wi-Fi adapter found".to_string())
}

fn connected_ssid(a: &WiFiAdapter) -> Option<String> {
    let profile = a
        .NetworkAdapter()
        .ok()?
        .GetConnectedProfileAsync()
        .ok()?
        .join()
        .ok()?;
    if !profile.IsWlanConnectionProfile().ok()? {
        return None;
    }
    profile
        .WlanConnectionProfileDetails()
        .ok()?
        .GetConnectedSsid()
        .ok()
        .map(|s| s.to_string())
}

fn is_secured(n: &WiFiAvailableNetwork) -> bool {
    n.SecuritySettings()
        .and_then(|s| s.NetworkAuthenticationType())
        .map(|t| t != NetworkAuthenticationType::None && t != NetworkAuthenticationType::Open80211)
        .unwrap_or(true)
}

fn available(a: &WiFiAdapter) -> Result<Vec<WiFiAvailableNetwork>, String> {
    let report = a.NetworkReport().map_err(|e| e.to_string())?;
    Ok(report
        .AvailableNetworks()
        .map_err(|e| e.to_string())?
        .into_iter()
        .collect())
}

pub fn scan() -> Result<Vec<WifiNetwork>, String> {
    let a = adapter()?;
    a.ScanAsync()
        .and_then(|op| op.join())
        .map_err(|e| e.to_string())?;
    let current = connected_ssid(&a);
    let saved = saved_profiles();
    let list = available(&a)?
        .iter()
        .map(|n| {
            let ssid = n.Ssid().map(|s| s.to_string()).unwrap_or_default();
            WifiNetwork {
                signal: n.SignalBars().unwrap_or(0).min(4),
                secured: is_secured(n),
                saved: saved.contains(&ssid),
                connected: current.as_deref() == Some(ssid.as_str()),
                ssid,
            }
        })
        .collect();
    Ok(tidy_networks(list))
}

pub fn connect(ssid: &str, password: Option<&str>) -> Result<WifiConnectResult, String> {
    let a = adapter()?;
    // Use the last scan; rescan only if the network isn't in it.
    let find = |a: &WiFiAdapter| -> Result<Option<WiFiAvailableNetwork>, String> {
        Ok(available(a)?
            .into_iter()
            .filter(|n| n.Ssid().map(|s| s == ssid).unwrap_or(false))
            .max_by_key(|n| n.SignalBars().unwrap_or(0)))
    };
    let net = match find(&a)? {
        Some(n) => n,
        None => {
            a.ScanAsync()
                .and_then(|op| op.join())
                .map_err(|e| e.to_string())?;
            match find(&a)? {
                Some(n) => n,
                None => {
                    return Ok(WifiConnectResult::Failed {
                        message: format!("{ssid} is out of range"),
                    })
                }
            }
        }
    };

    let secured = is_secured(&net);
    if secured && password.is_none() && !saved_profiles().contains(ssid) {
        return Ok(WifiConnectResult::NeedsPassword);
    }

    let result = match password {
        Some(pw) => {
            let cred = PasswordCredential::new().map_err(|e| e.to_string())?;
            cred.SetPassword(&HSTRING::from(pw))
                .map_err(|e| e.to_string())?;
            a.ConnectWithPasswordCredentialAsync(&net, WiFiReconnectionKind::Automatic, &cred)
        }
        None => a.ConnectAsync(&net, WiFiReconnectionKind::Automatic),
    }
    .and_then(|op| op.join())
    .and_then(|r| r.ConnectionStatus())
    .map_err(|e| e.to_string())?;

    Ok(match result {
        WiFiConnectionStatus::Success => WifiConnectResult::Connected,
        WiFiConnectionStatus::InvalidCredential if password.is_some() => {
            WifiConnectResult::WrongPassword
        }
        WiFiConnectionStatus::InvalidCredential => WifiConnectResult::NeedsPassword,
        WiFiConnectionStatus::Timeout => WifiConnectResult::Failed {
            message: "Timed out".into(),
        },
        WiFiConnectionStatus::NetworkNotAvailable => WifiConnectResult::Failed {
            message: format!("{ssid} is out of range"),
        },
        WiFiConnectionStatus::UnsupportedAuthenticationProtocol => WifiConnectResult::Failed {
            message: "This network needs a sign-in Isle can't do yet".into(),
        },
        _ => WifiConnectResult::Failed {
            message: "Couldn't connect".into(),
        },
    })
}

pub fn disconnect() -> Result<(), String> {
    adapter()?.Disconnect().map_err(|e| e.to_string())
}

/// Names of saved Wi-Fi profiles (normally the SSID) across all adapters.
fn saved_profiles() -> HashSet<String> {
    let mut out = HashSet::new();
    unsafe {
        let mut version = 0u32;
        let mut handle = HANDLE::default();
        if WlanOpenHandle(2, None, &mut version, &mut handle) != 0 {
            return out;
        }
        let mut ifaces: *mut WLAN_INTERFACE_INFO_LIST = std::ptr::null_mut();
        if WlanEnumInterfaces(handle, None, &mut ifaces) == 0 && !ifaces.is_null() {
            let list = &*ifaces;
            let items = std::slice::from_raw_parts(
                list.InterfaceInfo.as_ptr(),
                list.dwNumberOfItems as usize,
            );
            for iface in items {
                let mut profiles: *mut WLAN_PROFILE_INFO_LIST = std::ptr::null_mut();
                if WlanGetProfileList(handle, &iface.InterfaceGuid, None, &mut profiles) == 0
                    && !profiles.is_null()
                {
                    let pl = &*profiles;
                    for p in std::slice::from_raw_parts(
                        pl.ProfileInfo.as_ptr(),
                        pl.dwNumberOfItems as usize,
                    ) {
                        let len = p
                            .strProfileName
                            .iter()
                            .position(|&c| c == 0)
                            .unwrap_or(p.strProfileName.len());
                        out.insert(String::from_utf16_lossy(&p.strProfileName[..len]));
                    }
                    WlanFreeMemory(profiles as *const _);
                }
            }
            WlanFreeMemory(ifaces as *const _);
        }
        WlanCloseHandle(handle, None);
    }
    out
}
