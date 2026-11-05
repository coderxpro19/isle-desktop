//! Display brightness.
//!
//! Laptop panels: WMI `root\WMI` → `WmiMonitorBrightness` (read) and
//! `WmiMonitorBrightnessMethods.WmiSetBrightness` (write) — the same path the
//! Windows quick settings slider uses. External monitors: DDC/CI through
//! dxva2 on the primary monitor. Must run on a thread with COM initialised.

use std::mem::ManuallyDrop;
use windows::core::{BSTR, PCWSTR};
use windows::Win32::Devices::Display::{
    DestroyPhysicalMonitors, GetMonitorBrightness, GetNumberOfPhysicalMonitorsFromHMONITOR,
    GetPhysicalMonitorsFromHMONITOR, SetMonitorBrightness, PHYSICAL_MONITOR,
};
use windows::Win32::Foundation::POINT;
use windows::Win32::Graphics::Gdi::{MonitorFromPoint, MONITOR_DEFAULTTOPRIMARY};
use windows::Win32::System::Com::{
    CoCreateInstance, CoSetProxyBlanket, CLSCTX_INPROC_SERVER, EOAC_NONE, RPC_C_AUTHN_LEVEL_CALL,
    RPC_C_IMP_LEVEL_IMPERSONATE,
};
use windows::Win32::System::Rpc::{RPC_C_AUTHN_WINNT, RPC_C_AUTHZ_NONE};
use windows::Win32::System::Variant::{VARIANT, VARIANT_0_0, VT_I4, VT_UI1};
use windows::Win32::System::Wmi::{
    IEnumWbemClassObject, IWbemClassObject, IWbemLocator, IWbemServices, WbemLocator,
    WBEM_FLAG_FORWARD_ONLY, WBEM_FLAG_RETURN_IMMEDIATELY, WBEM_GENERIC_FLAG_TYPE, WBEM_INFINITE,
};

pub struct Brightness {
    wmi: Option<IWbemServices>,
    /// Remember which backend worked so we don't retry the other every poll.
    mode: Mode,
}

#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Unknown,
    Wmi,
    Ddc,
    None,
}

impl Brightness {
    pub fn open() -> Self {
        Self {
            wmi: connect_wmi()
                .map_err(|e| log::debug!("WMI unavailable: {e}"))
                .ok(),
            mode: Mode::Unknown,
        }
    }

    pub fn get(&mut self) -> Option<super::BrightnessState> {
        if matches!(self.mode, Mode::Unknown | Mode::Wmi) {
            if let Some(level) = self.wmi.as_ref().and_then(|w| wmi_get(w).ok()) {
                self.mode = Mode::Wmi;
                return Some(super::BrightnessState {
                    level,
                    source: "internal",
                });
            }
        }
        if matches!(self.mode, Mode::Unknown | Mode::Ddc) {
            if let Some(level) = ddc(None) {
                self.mode = Mode::Ddc;
                return Some(super::BrightnessState {
                    level,
                    source: "external",
                });
            }
        }
        if self.mode == Mode::Unknown {
            self.mode = Mode::None;
        }
        None
    }

    /// Returns the source on success.
    pub fn set(&mut self, level: u8) -> Option<&'static str> {
        match self.mode {
            Mode::Wmi => self
                .wmi
                .as_ref()
                .and_then(|w| wmi_set(w, level).ok())
                .map(|_| "internal"),
            Mode::Ddc => ddc(Some(level)).map(|_| "external"),
            _ => None,
        }
    }
}

fn connect_wmi() -> windows::core::Result<IWbemServices> {
    unsafe {
        let locator: IWbemLocator = CoCreateInstance(&WbemLocator, None, CLSCTX_INPROC_SERVER)?;
        let services = locator.ConnectServer(
            &BSTR::from("ROOT\\WMI"),
            &BSTR::new(),
            &BSTR::new(),
            &BSTR::new(),
            0,
            &BSTR::new(),
            None,
        )?;
        CoSetProxyBlanket(
            &services,
            RPC_C_AUTHN_WINNT,
            RPC_C_AUTHZ_NONE,
            PCWSTR::null(),
            RPC_C_AUTHN_LEVEL_CALL,
            RPC_C_IMP_LEVEL_IMPERSONATE,
            None,
            EOAC_NONE,
        )?;
        Ok(services)
    }
}

fn first(services: &IWbemServices, query: &str) -> windows::core::Result<IWbemClassObject> {
    unsafe {
        let flags =
            WBEM_GENERIC_FLAG_TYPE(WBEM_FLAG_FORWARD_ONLY.0 | WBEM_FLAG_RETURN_IMMEDIATELY.0);
        let e: IEnumWbemClassObject =
            services.ExecQuery(&BSTR::from("WQL"), &BSTR::from(query), flags, None)?;
        let mut row = [None];
        let mut n = 0;
        e.Next(WBEM_INFINITE, &mut row, &mut n).ok()?;
        row[0]
            .take()
            .ok_or_else(|| windows::core::Error::from_hresult(windows::Win32::Foundation::E_FAIL))
    }
}

fn get_prop(obj: &IWbemClassObject, name: &str) -> windows::core::Result<VARIANT> {
    let mut v = VARIANT::default();
    let name = windows::core::HSTRING::from(name);
    unsafe { obj.Get(&name, 0, &mut v, None, None)? };
    Ok(v)
}

fn wmi_get(services: &IWbemServices) -> windows::core::Result<u8> {
    let obj = first(
        services,
        "SELECT CurrentBrightness FROM WmiMonitorBrightness WHERE Active=TRUE",
    )?;
    let v = get_prop(&obj, "CurrentBrightness")?;
    Ok(u32::try_from(&v)?.min(100) as u8)
}

fn wmi_set(services: &IWbemServices, level: u8) -> windows::core::Result<()> {
    unsafe {
        let instance = first(
            services,
            "SELECT * FROM WmiMonitorBrightnessMethods WHERE Active=TRUE",
        )?;
        let path = BSTR::try_from(&get_prop(&instance, "__PATH")?)?;

        let mut class = None;
        services.GetObject(
            &BSTR::from("WmiMonitorBrightnessMethods"),
            WBEM_GENERIC_FLAG_TYPE(0),
            None,
            Some(&mut class),
            None,
        )?;
        let class = class.ok_or_else(|| {
            windows::core::Error::from_hresult(windows::Win32::Foundation::E_FAIL)
        })?;
        let mut in_sig = None;
        class.GetMethod(
            &windows::core::HSTRING::from("WmiSetBrightness"),
            0,
            &mut in_sig,
            std::ptr::null_mut(),
        )?;
        let params = in_sig
            .ok_or_else(|| windows::core::Error::from_hresult(windows::Win32::Foundation::E_FAIL))?
            .SpawnInstance(0)?;

        params.Put(
            &windows::core::HSTRING::from("Timeout"),
            0,
            &variant_i4(0),
            0,
        )?;
        params.Put(
            &windows::core::HSTRING::from("Brightness"),
            0,
            &variant_u8(level),
            0,
        )?;
        services.ExecMethod(
            &path,
            &BSTR::from("WmiSetBrightness"),
            WBEM_GENERIC_FLAG_TYPE(0),
            None,
            &params,
            None,
            None,
        )
    }
}

fn variant_i4(v: i32) -> VARIANT {
    let mut out = VARIANT::default();
    unsafe {
        let inner: &mut ManuallyDrop<VARIANT_0_0> = &mut out.Anonymous.Anonymous;
        inner.vt = VT_I4;
        inner.Anonymous.lVal = v;
    }
    out
}

fn variant_u8(v: u8) -> VARIANT {
    let mut out = VARIANT::default();
    unsafe {
        let inner: &mut ManuallyDrop<VARIANT_0_0> = &mut out.Anonymous.Anonymous;
        inner.vt = VT_UI1;
        inner.Anonymous.bVal = v;
    }
    out
}

/// DDC/CI on the primary monitor: read when `set` is None, else write. Returns the level.
fn ddc(set: Option<u8>) -> Option<u8> {
    unsafe {
        let hmon = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
        let mut count = 0u32;
        GetNumberOfPhysicalMonitorsFromHMONITOR(hmon, &mut count).ok()?;
        if count == 0 {
            return None;
        }
        let mut mons = vec![PHYSICAL_MONITOR::default(); count as usize];
        GetPhysicalMonitorsFromHMONITOR(hmon, &mut mons).ok()?;
        let h = mons[0].hPhysicalMonitor;
        let (mut min, mut cur, mut max) = (0u32, 0u32, 0u32);
        let ok = GetMonitorBrightness(h, &mut min, &mut cur, &mut max) != 0 && max > min;
        let result = if !ok {
            None
        } else if let Some(level) = set {
            let raw = min + (max - min) * level as u32 / 100;
            (SetMonitorBrightness(h, raw) != 0).then_some(level)
        } else {
            Some(((cur.saturating_sub(min)) * 100 / (max - min)).min(100) as u8)
        };
        let _ = DestroyPhysicalMonitors(&mons);
        result
    }
}
