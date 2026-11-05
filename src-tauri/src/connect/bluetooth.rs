//! Bluetooth: paired devices, discovery of new ones, pairing, forgetting, and
//! connecting/disconnecting audio devices.
//!
//! Windows has no public "connect this headset" API. Like Windows' own quick
//! settings, we ask the Bluetooth audio driver directly: find the device's KS
//! filter through the audio endpoint topology and send it
//! `KSPROPERTY_ONESHOT_RECONNECT` / `_DISCONNECT`.

use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::sync::{mpsc, Arc};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use windows::core::{Interface, HSTRING};
use windows::Devices::Bluetooth::{
    BluetoothConnectionStatus, BluetoothDevice, BluetoothLEDevice, BluetoothMajorClass,
};
use windows::Devices::Enumeration::{
    DeviceInformation, DeviceInformationCustomPairing, DeviceInformationKind,
    DeviceInformationUpdate, DevicePairingKinds, DevicePairingRequestedEventArgs,
    DevicePairingResultStatus, DeviceUnpairingResultStatus, DeviceWatcher,
};
use windows::Foundation::TypedEventHandler;
use windows::Win32::Media::Audio::{
    eAll, IConnector, IDeviceTopology, IMMDeviceEnumerator, IPart, MMDeviceEnumerator,
    DEVICE_STATE, DEVICE_STATEMASK_ALL,
};
use windows::Win32::Media::KernelStreaming::{
    IKsControl, KSPROPSETID_BtAudio, KSIDENTIFIER, KSIDENTIFIER_0, KSIDENTIFIER_0_0,
    KSPROPERTY_ONESHOT_DISCONNECT, KSPROPERTY_ONESHOT_RECONNECT, KSPROPERTY_TYPE_GET,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED,
};

use super::{bt_address_hex, BtAction, BtDevice, PairingPrompt};
use crate::events;

/// Classic + LE association endpoints that aren't paired yet.
const DISCOVERY_AQS: &str =
    "(System.Devices.Aep.ProtocolId:=\"{e0cbf06c-cd8b-4647-bb8a-263b43f0f974}\" OR \
System.Devices.Aep.ProtocolId:=\"{bb7bb05e-5972-42b5-94fc-76eaa7084d49}\") AND \
System.Devices.Aep.IsPaired:=System.StructuredQueryType.Boolean#False";

#[derive(Clone)]
pub struct Bluetooth(Arc<Inner>);

struct Inner {
    app: AppHandle,
    discovered: Mutex<HashMap<String, DeviceInformation>>,
    watcher: Mutex<Option<DeviceWatcher>>,
    /// Waiting PIN confirmation for an in-progress pairing.
    pending: Mutex<Option<mpsc::Sender<bool>>>,
}

fn com() {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

fn err(e: windows::core::Error) -> String {
    e.message().to_string()
}

impl Bluetooth {
    pub fn new(app: AppHandle) -> Self {
        Self(Arc::new(Inner {
            app,
            discovered: Mutex::new(HashMap::new()),
            watcher: Mutex::new(None),
            pending: Mutex::new(None),
        }))
    }

    fn changed(&self) {
        let _ = self.0.app.emit(events::BT_CHANGED, ());
    }

    pub fn devices(&self) -> Result<Vec<BtDevice>, String> {
        com();
        let audio = audio_filters();
        let mut out: Vec<BtDevice> = Vec::new();
        let mut seen_addr = HashSet::new();

        // Classic paired devices.
        let sel = BluetoothDevice::GetDeviceSelectorFromPairingState(true).map_err(err)?;
        for info in DeviceInformation::FindAllAsyncAqsFilter(&sel)
            .and_then(|o| o.join())
            .map_err(err)?
        {
            let Ok(id) = info.Id() else { continue };
            let Ok(dev) = BluetoothDevice::FromIdAsync(&id).and_then(|o| o.join()) else {
                continue;
            };
            let addr = bt_address_hex(dev.BluetoothAddress().unwrap_or(0));
            seen_addr.insert(addr.clone());
            let kind = dev
                .ClassOfDevice()
                .and_then(|c| c.MajorClass())
                .map(major_kind)
                .unwrap_or("other");
            out.push(BtDevice {
                id: id.to_string(),
                name: dev
                    .Name()
                    .map(|n| n.to_string())
                    .unwrap_or_else(|_| "Unknown device".into()),
                kind,
                paired: true,
                connected: dev
                    .ConnectionStatus()
                    .map(|s| s == BluetoothConnectionStatus::Connected)
                    .unwrap_or(false),
                can_connect: audio.iter().any(|f| f.contains(&addr)),
            });
        }

        // LE paired devices (mice, keyboards, some earbuds) not already listed.
        let sel = BluetoothLEDevice::GetDeviceSelectorFromPairingState(true).map_err(err)?;
        if let Ok(list) = DeviceInformation::FindAllAsyncAqsFilter(&sel).and_then(|o| o.join()) {
            for info in list {
                let Ok(id) = info.Id() else { continue };
                let Ok(dev) = BluetoothLEDevice::FromIdAsync(&id).and_then(|o| o.join()) else {
                    continue;
                };
                let addr = bt_address_hex(dev.BluetoothAddress().unwrap_or(0));
                if !seen_addr.insert(addr) {
                    continue;
                }
                out.push(BtDevice {
                    id: id.to_string(),
                    name: dev
                        .Name()
                        .map(|n| n.to_string())
                        .unwrap_or_else(|_| "Unknown device".into()),
                    kind: "input",
                    paired: true,
                    connected: dev
                        .ConnectionStatus()
                        .map(|s| s == BluetoothConnectionStatus::Connected)
                        .unwrap_or(false),
                    can_connect: false,
                });
            }
        }

        // Newly discovered (unpaired) devices with a name.
        for (id, info) in self.0.discovered.lock().iter() {
            let name = info.Name().map(|n| n.to_string()).unwrap_or_default();
            if name.trim().is_empty() {
                continue;
            }
            out.push(BtDevice {
                id: id.clone(),
                name,
                kind: "other",
                paired: false,
                connected: false,
                can_connect: false,
            });
        }

        out.sort_by(|a, b| {
            b.paired
                .cmp(&a.paired)
                .then(b.connected.cmp(&a.connected))
                .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(out)
    }

    pub fn set_discovery(&self, active: bool) {
        let mut slot = self.0.watcher.lock();
        if !active {
            if let Some(w) = slot.take() {
                let _ = w.Stop();
            }
            self.0.discovered.lock().clear();
            return;
        }
        if slot.is_some() {
            return;
        }
        com();
        let props: windows_collections::IIterable<HSTRING> = Vec::<HSTRING>::new().into();
        let w = match DeviceInformation::CreateWatcherWithKindAqsFilterAndAdditionalProperties(
            &HSTRING::from(DISCOVERY_AQS),
            &props,
            DeviceInformationKind::AssociationEndpoint,
        ) {
            Ok(w) => w,
            Err(e) => {
                log::warn!("bluetooth discovery unavailable: {e}");
                return;
            }
        };
        let me = self.clone();
        let _ = w.Added(&TypedEventHandler::<DeviceWatcher, DeviceInformation>::new(
            move |_, info| {
                if let Ok(info) = info.ok() {
                    if let Ok(id) = info.Id() {
                        me.0.discovered.lock().insert(id.to_string(), info.clone());
                        me.changed();
                    }
                }
                Ok(())
            },
        ));
        let me = self.clone();
        let _ = w.Updated(
            &TypedEventHandler::<DeviceWatcher, DeviceInformationUpdate>::new(move |_, up| {
                if let Ok(up) = up.ok() {
                    if let Ok(id) = up.Id() {
                        if let Some(info) = me.0.discovered.lock().get(&id.to_string()) {
                            let _ = info.Update(up);
                        }
                        me.changed();
                    }
                }
                Ok(())
            }),
        );
        let me = self.clone();
        let _ = w.Removed(
            &TypedEventHandler::<DeviceWatcher, DeviceInformationUpdate>::new(move |_, up| {
                if let Ok(up) = up.ok() {
                    if let Ok(id) = up.Id() {
                        me.0.discovered.lock().remove(&id.to_string());
                        me.changed();
                    }
                }
                Ok(())
            }),
        );
        if w.Start().is_ok() {
            *slot = Some(w);
        }
    }

    pub fn respond(&self, accept: bool) {
        if let Some(tx) = self.0.pending.lock().take() {
            let _ = tx.send(accept);
        }
    }

    pub fn act(&self, id: &str, action: BtAction) -> Result<(), String> {
        com();
        let r = match action {
            BtAction::Connect | BtAction::Disconnect => {
                let dev = BluetoothDevice::FromIdAsync(&HSTRING::from(id))
                    .and_then(|o| o.join())
                    .map_err(err)?;
                let addr = bt_address_hex(dev.BluetoothAddress().map_err(err)?);
                ks_toggle(&addr, matches!(action, BtAction::Connect))
            }
            BtAction::Pair => self.pair(id),
            BtAction::Forget => {
                let info = self.info(id)?;
                let res = info
                    .Pairing()
                    .and_then(|p| p.UnpairAsync())
                    .and_then(|o| o.join())
                    .and_then(|r| r.Status())
                    .map_err(err)?;
                if res == DeviceUnpairingResultStatus::Unpaired
                    || res == DeviceUnpairingResultStatus::AlreadyUnpaired
                {
                    Ok(())
                } else {
                    Err("Couldn't remove the device".into())
                }
            }
        };
        self.changed();
        r
    }

    fn info(&self, id: &str) -> Result<DeviceInformation, String> {
        if let Some(i) = self.0.discovered.lock().get(id) {
            return Ok(i.clone());
        }
        DeviceInformation::CreateFromIdAsync(&HSTRING::from(id))
            .and_then(|o| o.join())
            .map_err(err)
    }

    fn pair(&self, id: &str) -> Result<(), String> {
        let info = self.info(id)?;
        let custom: DeviceInformationCustomPairing =
            info.Pairing().and_then(|p| p.Custom()).map_err(err)?;
        let me = self.clone();
        let dev_id = id.to_string();
        let token = custom
            .PairingRequested(&TypedEventHandler::<
                DeviceInformationCustomPairing,
                DevicePairingRequestedEventArgs,
            >::new(move |_, args| {
                let args = args.ok()?;
                let kind = args.PairingKind()?;
                let pin = args.Pin().map(|p| p.to_string()).unwrap_or_default();
                if kind == DevicePairingKinds::ConfirmOnly {
                    args.Accept()?;
                } else if kind == DevicePairingKinds::DisplayPin {
                    let _ = me.0.app.emit(
                        events::BT_PAIRING,
                        PairingPrompt {
                            id: dev_id.clone(),
                            kind: "displayPin",
                            pin,
                        },
                    );
                    args.Accept()?;
                } else if kind == DevicePairingKinds::ConfirmPinMatch {
                    let deferral = args.GetDeferral()?;
                    let (tx, rx) = mpsc::channel();
                    *me.0.pending.lock() = Some(tx);
                    let _ = me.0.app.emit(
                        events::BT_PAIRING,
                        PairingPrompt {
                            id: dev_id.clone(),
                            kind: "confirmPin",
                            pin,
                        },
                    );
                    if rx.recv_timeout(Duration::from_secs(60)).unwrap_or(false) {
                        args.Accept()?;
                    }
                    me.0.pending.lock().take();
                    deferral.Complete()?;
                }
                Ok(())
            }))
            .map_err(err)?;

        let kinds = DevicePairingKinds::ConfirmOnly
            | DevicePairingKinds::DisplayPin
            | DevicePairingKinds::ConfirmPinMatch;
        let status = custom
            .PairAsync(kinds)
            .and_then(|o| o.join())
            .and_then(|r| r.Status());
        let _ = custom.RemovePairingRequested(token);
        let _ = self
            .0
            .app
            .emit(events::BT_PAIRING, Option::<PairingPrompt>::None);
        match status.map_err(err)? {
            DevicePairingResultStatus::Paired | DevicePairingResultStatus::AlreadyPaired => {
                self.0.discovered.lock().remove(id);
                Ok(())
            }
            DevicePairingResultStatus::AuthenticationTimeout => Err("Pairing timed out".into()),
            DevicePairingResultStatus::RejectedByHandler
            | DevicePairingResultStatus::PairingCanceled => Err("Pairing cancelled".into()),
            DevicePairingResultStatus::RequiredHandlerNotRegistered => {
                Err("This device needs a PIN typed in — pair it once from Windows Settings".into())
            }
            other => Err(format!("Pairing failed ({})", other.0)),
        }
    }
}

fn major_kind(c: BluetoothMajorClass) -> &'static str {
    match c {
        BluetoothMajorClass::AudioVideo => "audio",
        BluetoothMajorClass::Peripheral => "input",
        BluetoothMajorClass::Phone => "phone",
        BluetoothMajorClass::Computer => "computer",
        BluetoothMajorClass::Wearable => "wearable",
        _ => "other",
    }
}

/// KS filter device ids behind every audio endpoint that is a Bluetooth device.
fn audio_filters() -> Vec<String> {
    audio_filter_devices()
        .into_iter()
        .map(|(id, _)| id)
        .collect()
}

fn audio_filter_devices() -> Vec<(String, IMMDeviceEnumerator)> {
    let mut out = Vec::new();
    unsafe {
        let Ok(en) =
            CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL)
        else {
            return out;
        };
        let Ok(coll) = en.EnumAudioEndpoints(eAll, DEVICE_STATE(DEVICE_STATEMASK_ALL)) else {
            return out;
        };
        let mut seen = HashSet::new();
        for i in 0..coll.GetCount().unwrap_or(0) {
            let Ok(ep) = coll.Item(i) else { continue };
            let Ok(topo) = ep.Activate::<IDeviceTopology>(CLSCTX_ALL, None) else {
                continue;
            };
            let filter_id = (|| -> windows::core::Result<String> {
                let conn: IConnector = topo.GetConnector(0)?;
                let other = conn.GetConnectedTo()?;
                let part: IPart = other.cast()?;
                let ftopo = part.GetTopologyObject()?;
                let p = ftopo.GetDeviceId()?;
                let s = p.to_string().unwrap_or_default();
                CoTaskMemFree(Some(p.0 as *const _));
                Ok(s)
            })();
            let Ok(fid) = filter_id else { continue };
            let up = fid.to_uppercase();
            if (up.contains("BTHENUM") || up.contains("BTHHFENUM")) && seen.insert(up.clone()) {
                out.push((fid, en.clone()));
            }
        }
    }
    out
}

/// Ask the Bluetooth audio driver to (re)connect or disconnect the device.
fn ks_toggle(addr_hex: &str, connect: bool) -> Result<(), String> {
    let targets: Vec<_> = audio_filter_devices()
        .into_iter()
        .filter(|(id, _)| id.to_uppercase().contains(addr_hex))
        .collect();
    if targets.is_empty() {
        return Err("This device connects on its own — turn it on or wake it to connect".into());
    }
    let prop = KSIDENTIFIER {
        Anonymous: KSIDENTIFIER_0 {
            Anonymous: KSIDENTIFIER_0_0 {
                Set: KSPROPSETID_BtAudio,
                Id: if connect {
                    KSPROPERTY_ONESHOT_RECONNECT.0
                } else {
                    KSPROPERTY_ONESHOT_DISCONNECT.0
                } as u32,
                Flags: KSPROPERTY_TYPE_GET,
            },
        },
    };
    let mut any_ok = false;
    for (fid, en) in targets {
        unsafe {
            let Ok(dev) = en.GetDevice(&HSTRING::from(fid.as_str())) else {
                continue;
            };
            let Ok(ks) = dev.Activate::<IKsControl>(CLSCTX_ALL, None) else {
                continue;
            };
            let mut returned = 0u32;
            // The driver often reports an error code even when it acts; the
            // connection state change is what matters.
            let _ = ks.KsProperty(
                &prop,
                std::mem::size_of::<KSIDENTIFIER>() as u32,
                std::ptr::null_mut(),
                0,
                &mut returned,
            );
            any_ok = true;
        }
    }
    if any_ok {
        Ok(())
    } else {
        Err("Couldn't reach the device's audio driver".into())
    }
}
