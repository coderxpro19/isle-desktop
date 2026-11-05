//! Windows implementation of the command centre.

use parking_lot::Mutex;
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use windows::core::{implement, GUID, PCWSTR};
use windows::Devices::Radios::{Radio, RadioKind, RadioState};
use windows::Foundation::TypedEventHandler;
use windows::Networking::Connectivity::{
    NetworkConnectivityLevel, NetworkInformation, NetworkStatusChangedEventHandler,
};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::Media::Audio::Endpoints::{
    IAudioEndpointVolume, IAudioEndpointVolumeCallback, IAudioEndpointVolumeCallback_Impl,
};
use windows::Win32::Media::Audio::{
    eConsole, eRender, EDataFlow, ERole, IMMDeviceEnumerator, IMMNotificationClient,
    IMMNotificationClient_Impl, MMDeviceEnumerator, AUDIO_VOLUME_NOTIFICATION_DATA, DEVICE_STATE,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ,
};

use super::brightness::Brightness;
use super::{
    clamp_bars, coalesce, publish, BrightnessState, ControlAction, ControlsState, Msg,
    NetworkState, RadioInfo, VolumeState,
};

/// Tags volume changes we make ourselves, so a future HUD can ignore them.
pub const ISLE_EVENT_CONTEXT: GUID = GUID::from_u128(0x6c1b_3a52_7f0e_4e2b_9a0d_15e1_e500_0001);

#[implement(IAudioEndpointVolumeCallback)]
struct VolumeCallback(Sender<Msg>);

impl IAudioEndpointVolumeCallback_Impl for VolumeCallback_Impl {
    fn OnNotify(&self, data: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> windows::core::Result<()> {
        if let Some(d) = unsafe { data.as_ref() } {
            let _ = self
                .0
                .send(Msg::Volume(d.fMasterVolume, d.bMuted.as_bool()));
        }
        Ok(())
    }
}

#[implement(IMMNotificationClient)]
struct DeviceWatcher(Sender<Msg>);

impl IMMNotificationClient_Impl for DeviceWatcher_Impl {
    fn OnDeviceStateChanged(&self, _: &PCWSTR, _: DEVICE_STATE) -> windows::core::Result<()> {
        Ok(())
    }
    fn OnDeviceAdded(&self, _: &PCWSTR) -> windows::core::Result<()> {
        Ok(())
    }
    fn OnDeviceRemoved(&self, _: &PCWSTR) -> windows::core::Result<()> {
        Ok(())
    }
    fn OnDefaultDeviceChanged(
        &self,
        flow: EDataFlow,
        role: ERole,
        _: &PCWSTR,
    ) -> windows::core::Result<()> {
        if flow == eRender && role == eConsole {
            let _ = self.0.send(Msg::DeviceChanged);
        }
        Ok(())
    }
    fn OnPropertyValueChanged(&self, _: &PCWSTR, _: &PROPERTYKEY) -> windows::core::Result<()> {
        Ok(())
    }
}

/// The default output endpoint and our subscription on it.
struct Endpoint {
    volume: IAudioEndpointVolume,
    callback: IAudioEndpointVolumeCallback,
    device: String,
}

impl Endpoint {
    fn open(enumerator: &IMMDeviceEnumerator, tx: &Sender<Msg>) -> windows::core::Result<Self> {
        unsafe {
            let dev = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
            let device = dev
                .OpenPropertyStore(STGM_READ)
                .and_then(|store| store.GetValue(&PKEY_Device_FriendlyName))
                .map(|v| v.to_string())
                .unwrap_or_default();
            let volume: IAudioEndpointVolume = dev.Activate(CLSCTX_ALL, None)?;
            let callback: IAudioEndpointVolumeCallback = VolumeCallback(tx.clone()).into();
            volume.RegisterControlChangeNotify(&callback)?;
            Ok(Self {
                volume,
                callback,
                device,
            })
        }
    }

    fn read(&self) -> Option<VolumeState> {
        unsafe {
            Some(VolumeState {
                level: self.volume.GetMasterVolumeLevelScalar().ok()?,
                muted: self.volume.GetMute().ok()?.as_bool(),
                device: self.device.clone(),
            })
        }
    }
}

impl Drop for Endpoint {
    fn drop(&mut self) {
        unsafe {
            let _ = self.volume.UnregisterControlChangeNotify(&self.callback);
        }
    }
}

struct Radios {
    wifi: Option<Radio>,
    bluetooth: Option<Radio>,
    _tokens: Vec<(Radio, i64)>,
}

impl Radios {
    fn discover(tx: &Sender<Msg>) -> Self {
        let mut out = Self {
            wifi: None,
            bluetooth: None,
            _tokens: Vec::new(),
        };
        // Without access, SetStateAsync fails; state reads still work.
        let _ = Radio::RequestAccessAsync().and_then(|op| op.join());
        let Ok(list) = Radio::GetRadiosAsync().and_then(|op| op.join()) else {
            return out;
        };
        for radio in list {
            let kind = radio.Kind().unwrap_or_default();
            let slot = match kind {
                RadioKind::WiFi => &mut out.wifi,
                RadioKind::Bluetooth => &mut out.bluetooth,
                _ => continue,
            };
            if slot.is_some() {
                continue;
            }
            let tx = tx.clone();
            if let Ok(token) = radio.StateChanged(&TypedEventHandler::new(move |_, _| {
                let _ = tx.send(Msg::RadiosChanged);
                Ok(())
            })) {
                out._tokens.push((radio.clone(), token));
            }
            *slot = Some(radio);
        }
        out
    }

    fn info(r: &Option<Radio>) -> Option<RadioInfo> {
        let state = r.as_ref()?.State().ok()?;
        Some(RadioInfo {
            on: state == RadioState::On,
        })
    }

    fn set(r: &Option<Radio>, on: bool) {
        if let Some(radio) = r {
            let target = if on { RadioState::On } else { RadioState::Off };
            match radio.SetStateAsync(target).and_then(|op| op.join()) {
                Ok(status) => log::debug!("radio set -> {status:?}"),
                Err(e) => log::warn!("radio set failed: {e}"),
            }
        }
    }
}

impl Drop for Radios {
    fn drop(&mut self) {
        for (radio, token) in &self._tokens {
            let _ = radio.RemoveStateChanged(*token);
        }
    }
}

fn read_network() -> NetworkState {
    let Ok(profile) = NetworkInformation::GetInternetConnectionProfile() else {
        return NetworkState {
            kind: "none",
            ..Default::default()
        };
    };
    let online = profile
        .GetNetworkConnectivityLevel()
        .map(|l| l == NetworkConnectivityLevel::InternetAccess)
        .unwrap_or(false);
    let signal = profile
        .GetSignalBars()
        .ok()
        .and_then(|r| r.Value().ok())
        .map(clamp_bars);
    if profile.IsWlanConnectionProfile().unwrap_or(false) {
        let ssid = profile
            .WlanConnectionProfileDetails()
            .and_then(|d| d.GetConnectedSsid())
            .map(|s| s.to_string())
            .ok()
            .filter(|s| !s.is_empty())
            .or_else(|| profile.ProfileName().ok().map(|s| s.to_string()));
        NetworkState {
            kind: "wifi",
            name: ssid,
            signal,
            online,
        }
    } else if profile.IsWwanConnectionProfile().unwrap_or(false) {
        NetworkState {
            kind: "cellular",
            name: profile.ProfileName().ok().map(|s| s.to_string()),
            signal,
            online,
        }
    } else {
        NetworkState {
            kind: "ethernet",
            name: profile.ProfileName().ok().map(|s| s.to_string()),
            signal: None,
            online,
        }
    }
}

pub fn run(app: AppHandle, shared: Arc<Mutex<ControlsState>>, tx: Sender<Msg>, rx: Receiver<Msg>) {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }

    let enumerator: Option<IMMDeviceEnumerator> =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok() };
    let watcher: IMMNotificationClient = DeviceWatcher(tx.clone()).into();
    if let Some(e) = &enumerator {
        unsafe {
            let _ = e.RegisterEndpointNotificationCallback(&watcher);
        }
    }
    let mut endpoint = enumerator
        .as_ref()
        .and_then(|e| Endpoint::open(e, &tx).ok());
    let radios = Radios::discover(&tx);
    let mut brightness = Brightness::open();

    {
        let tx = tx.clone();
        let _ = NetworkInformation::NetworkStatusChanged(&NetworkStatusChangedEventHandler::new(
            move |_| {
                let _ = tx.send(Msg::NetworkChanged);
                Ok(())
            },
        ));
    }

    let full_read = |endpoint: &Option<Endpoint>, brightness: &mut Brightness| ControlsState {
        volume: endpoint.as_ref().and_then(Endpoint::read),
        brightness: brightness.get(),
        wifi: Radios::info(&radios.wifi),
        bluetooth: Radios::info(&radios.bluetooth),
        network: read_network(),
    };
    publish(&app, &shared, |s| {
        *s = full_read(&endpoint, &mut brightness)
    });

    let mut active = false;
    let mut last_brightness_poll = Instant::now();
    loop {
        let wait = if active {
            Duration::from_millis(1500)
        } else {
            Duration::from_secs(3600)
        };
        let first = match rx.recv_timeout(wait) {
            Ok(m) => Some(m),
            Err(RecvTimeoutError::Timeout) => None,
            Err(RecvTimeoutError::Disconnected) => return,
        };
        let msgs: Vec<Msg> = first.into_iter().chain(rx.try_iter()).collect();

        let mut actions = Vec::new();
        let mut refresh_radios = false;
        let mut refresh_network = false;
        let mut volume_update = None;
        for m in msgs {
            match m {
                Msg::Action(a) => actions.push(a),
                Msg::Active(a) => {
                    active = a;
                    if a {
                        // Opening the panel: refresh everything once, right away.
                        publish(&app, &shared, |s| {
                            *s = full_read(&endpoint, &mut brightness)
                        });
                    }
                }
                Msg::Volume(level, muted) => volume_update = Some((level, muted)),
                Msg::DeviceChanged => {
                    endpoint = enumerator
                        .as_ref()
                        .and_then(|e| Endpoint::open(e, &tx).ok());
                    let v = endpoint.as_ref().and_then(Endpoint::read);
                    publish(&app, &shared, |s| s.volume = v);
                }
                Msg::RadiosChanged => refresh_radios = true,
                Msg::NetworkChanged => refresh_network = true,
            }
        }

        for a in coalesce(actions) {
            match a {
                ControlAction::SetVolume { level } => {
                    if let Some(ep) = &endpoint {
                        unsafe {
                            let _ = ep
                                .volume
                                .SetMasterVolumeLevelScalar(level, &ISLE_EVENT_CONTEXT);
                            if level > 0.0
                                && ep.volume.GetMute().map(|m| m.as_bool()).unwrap_or(false)
                            {
                                let _ = ep.volume.SetMute(false, &ISLE_EVENT_CONTEXT);
                            }
                        }
                    }
                }
                ControlAction::SetMute { muted } => {
                    if let Some(ep) = &endpoint {
                        unsafe {
                            let _ = ep.volume.SetMute(muted, &ISLE_EVENT_CONTEXT);
                        }
                    }
                }
                ControlAction::SetBrightness { level } => {
                    if let Some(src) = brightness.set(level) {
                        publish(&app, &shared, |s| {
                            s.brightness = Some(BrightnessState { level, source: src })
                        });
                    }
                    last_brightness_poll = Instant::now();
                }
                ControlAction::SetWifi { on } => Radios::set(&radios.wifi, on),
                ControlAction::SetBluetooth { on } => Radios::set(&radios.bluetooth, on),
            }
        }

        if let Some((level, muted)) = volume_update {
            publish(&app, &shared, |s| {
                if let Some(v) = &mut s.volume {
                    v.level = level;
                    v.muted = muted;
                }
            });
        }
        if refresh_radios {
            let (w, b) = (Radios::info(&radios.wifi), Radios::info(&radios.bluetooth));
            publish(&app, &shared, |s| {
                s.wifi = w;
                s.bluetooth = b;
            });
        }
        if refresh_network {
            // Status events fire before the SSID is available; give it a beat.
            std::thread::sleep(Duration::from_millis(300));
            let n = read_network();
            publish(&app, &shared, |s| s.network = n);
        }
        // Brightness can change from the keyboard or Windows; poll while visible.
        if active && last_brightness_poll.elapsed() >= Duration::from_millis(1400) {
            last_brightness_poll = Instant::now();
            let b = brightness.get();
            publish(&app, &shared, |s| s.brightness = b);
        }
    }
}
