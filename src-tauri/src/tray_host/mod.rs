//! System tray host: Isle receives other apps' tray icons (Shell_NotifyIcon)
//! so they can live in the dock while the Windows taskbar is hidden.
//!
//! How: apps send `WM_COPYDATA` to the first window of class `Shell_TrayWnd`.
//! Isle creates its own `Shell_TrayWnd`, keeps it top-most so it's found first,
//! and asks every app to re-register its icons (the `TaskbarCreated` broadcast).
//! Every message is also forwarded to Explorer's real tray, so Explorer stays in
//! sync and nothing is lost when Isle stops; stopping (or the crash watchdog)
//! broadcasts `TaskbarCreated` again so apps go back to Explorer.

// The protocol code is only exercised by the Windows host (and tests).
#![cfg_attr(not(windows), allow(dead_code))]

#[cfg(windows)]
mod win;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tauri::{AppHandle, Manager, State};

pub const NIM_ADD: u32 = 0;
pub const NIM_MODIFY: u32 = 1;
pub const NIM_DELETE: u32 = 2;
pub const NIM_SETVERSION: u32 = 4;
pub const NIF_MESSAGE: u32 = 0x01;
pub const NIF_ICON: u32 = 0x02;
pub const NIF_TIP: u32 = 0x04;
pub const NIF_STATE: u32 = 0x08;
pub const NIF_GUID: u32 = 0x20;
pub const NIS_HIDDEN: u32 = 0x01;

/// One tray icon as shown in the dock.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrayIcon {
    pub id: String,
    pub tip: String,
    /// PNG data URL.
    pub icon: Option<String>,
    #[serde(skip)]
    pub hwnd: u32,
    #[serde(skip)]
    pub uid: u32,
    #[serde(skip)]
    pub callback: u32,
    #[serde(skip)]
    pub version: u32,
    #[serde(skip)]
    pub hidden: bool,
    /// Order of first appearance, for stable placement.
    #[serde(skip)]
    pub seq: u64,
}

/// Decoded `SHELLTRAYDATA` (the payload of `WM_COPYDATA` with `dwData == 1`).
/// Handles are 32-bit on the wire, even for 64-bit processes.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct TrayData {
    pub message: u32,
    pub hwnd: u32,
    pub uid: u32,
    pub flags: u32,
    pub callback: u32,
    pub hicon: u32,
    pub tip: String,
    pub state: u32,
    pub state_mask: u32,
    pub version: u32,
    pub guid: Option<[u8; 16]>,
}

const SIGNATURE: u32 = 0x3475_3423;

fn u32_at(b: &[u8], off: usize) -> Option<u32> {
    b.get(off..off + 4)
        .map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

fn wstr_at(b: &[u8], off: usize, chars: usize) -> String {
    let Some(bytes) = b.get(off..(off + chars * 2).min(b.len())) else {
        return String::new();
    };
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .take_while(|&u| u != 0)
        .collect();
    String::from_utf16_lossy(&units)
}

/// Parse the raw bytes of a `SHELLTRAYDATA`. Older apps send shorter structs;
/// fields beyond their `cbSize` are left at defaults.
pub fn parse(bytes: &[u8]) -> Option<TrayData> {
    if u32_at(bytes, 0)? != SIGNATURE {
        return None;
    }
    let message = u32_at(bytes, 4)?;
    let nid = bytes.get(8..)?;
    let size = (u32_at(nid, 0)? as usize).min(nid.len());
    let nid = &nid[..size];
    let flags = u32_at(nid, 12).unwrap_or(0);
    let guid = nid.get(936..952).map(|g| {
        let mut a = [0u8; 16];
        a.copy_from_slice(g);
        a
    });
    Some(TrayData {
        message,
        hwnd: u32_at(nid, 4)?,
        uid: u32_at(nid, 8).unwrap_or(0),
        flags,
        callback: u32_at(nid, 16).unwrap_or(0),
        hicon: u32_at(nid, 20).unwrap_or(0),
        tip: wstr_at(nid, 24, 128),
        state: u32_at(nid, 280).unwrap_or(0),
        state_mask: u32_at(nid, 284).unwrap_or(0),
        version: u32_at(nid, 800).unwrap_or(0),
        guid: guid.filter(|g| flags & NIF_GUID != 0 && g.iter().any(|&x| x != 0)),
    })
}

pub fn icon_id(d: &TrayData) -> String {
    match d.guid {
        Some(g) => format!(
            "g:{}",
            g.iter().map(|b| format!("{b:02x}")).collect::<String>()
        ),
        None => format!("h:{:x}:{}", d.hwnd, d.uid),
    }
}

/// Apply one Shell_NotifyIcon message. Returns true if the visible set changed.
pub fn apply(
    icons: &mut BTreeMap<String, TrayIcon>,
    d: &TrayData,
    seq: &mut u64,
    to_png: impl Fn(u32) -> Option<String>,
) -> bool {
    let id = icon_id(d);
    match d.message {
        NIM_DELETE => icons.remove(&id).is_some(),
        NIM_SETVERSION => {
            if let Some(i) = icons.get_mut(&id) {
                i.version = d.version;
            }
            false
        }
        NIM_ADD | NIM_MODIFY => {
            let before = icons.get(&id).cloned();
            let entry = icons.entry(id.clone()).or_insert_with(|| {
                *seq += 1;
                TrayIcon {
                    id,
                    tip: String::new(),
                    icon: None,
                    hwnd: d.hwnd,
                    uid: d.uid,
                    callback: 0,
                    version: 0,
                    hidden: false,
                    seq: *seq,
                }
            });
            entry.hwnd = d.hwnd;
            entry.uid = d.uid;
            if d.flags & NIF_MESSAGE != 0 {
                entry.callback = d.callback;
            }
            if d.flags & NIF_TIP != 0 {
                entry.tip = d.tip.clone();
            }
            if d.flags & NIF_ICON != 0 && d.hicon != 0 {
                if let Some(png) = to_png(d.hicon) {
                    entry.icon = Some(png);
                }
            }
            if d.flags & NIF_STATE != 0 && d.state_mask & NIS_HIDDEN != 0 {
                entry.hidden = d.state & NIS_HIDDEN != 0;
            }
            before.as_ref() != Some(entry)
        }
        _ => false,
    }
}

/// Visible icons in a stable order.
pub fn visible(icons: &BTreeMap<String, TrayIcon>) -> Vec<TrayIcon> {
    let mut v: Vec<TrayIcon> = icons
        .values()
        .filter(|i| !i.hidden && i.icon.is_some())
        .cloned()
        .collect();
    v.sort_by_key(|i| i.seq);
    v
}

#[derive(Default)]
pub struct TrayHost {
    pub(crate) icons: Mutex<BTreeMap<String, TrayIcon>>,
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn emit(app: &AppHandle) {
    use tauri::Emitter;
    let list = visible(&app.state::<TrayHost>().icons.lock());
    let _ = app.emit(crate::events::TRAY_ICONS, list);
}

/// Start or stop hosting. Cheap and non-blocking; safe to call repeatedly.
pub fn set_enabled(app: &AppHandle, on: bool) {
    #[cfg(windows)]
    win::set_enabled(app, on);
    #[cfg(not(windows))]
    let _ = (app, on);
}

/// Stop hosting synchronously (process exit).
pub fn shutdown() {
    #[cfg(windows)]
    win::shutdown();
}

/// Tell every app to re-register its tray icons (used after Isle stops).
pub fn broadcast_taskbar_created() {
    #[cfg(windows)]
    win::broadcast_taskbar_created();
}

#[tauri::command]
pub fn tray_icons(host: State<'_, TrayHost>) -> Vec<TrayIcon> {
    visible(&host.icons.lock())
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TrayButton {
    Left,
    Right,
    Double,
}

/// Click a tray icon. `x`/`y` are logical px inside the dock window (icon centre).
#[tauri::command]
pub fn tray_click(app: AppHandle, id: String, button: TrayButton, x: f64, y: f64) {
    let Some(icon) = app.state::<TrayHost>().icons.lock().get(&id).cloned() else {
        return;
    };
    #[cfg(windows)]
    if let Some(dock) = app.get_webview_window(crate::dock::DOCK_LABEL) {
        let (Ok(pos), Ok(k)) = (dock.outer_position(), dock.scale_factor()) else {
            return;
        };
        win::click(
            &icon,
            button,
            pos.x + (x * k) as i32,
            pos.y + (y * k) as i32,
        );
    }
    #[cfg(not(windows))]
    let _ = (icon, button, x, y);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wire(
        message: u32,
        hwnd: u32,
        uid: u32,
        flags: u32,
        tip: &str,
        extra: impl Fn(&mut Vec<u8>),
    ) -> Vec<u8> {
        let mut b = vec![0u8; 8 + 956];
        b[0..4].copy_from_slice(&SIGNATURE.to_le_bytes());
        b[4..8].copy_from_slice(&message.to_le_bytes());
        let n = 8;
        b[n..n + 4].copy_from_slice(&956u32.to_le_bytes());
        b[n + 4..n + 8].copy_from_slice(&hwnd.to_le_bytes());
        b[n + 8..n + 12].copy_from_slice(&uid.to_le_bytes());
        b[n + 12..n + 16].copy_from_slice(&flags.to_le_bytes());
        b[n + 16..n + 20].copy_from_slice(&0x8001u32.to_le_bytes());
        b[n + 20..n + 24].copy_from_slice(&0xabcdu32.to_le_bytes());
        for (i, u) in tip.encode_utf16().enumerate() {
            b[n + 24 + i * 2..n + 26 + i * 2].copy_from_slice(&u.to_le_bytes());
        }
        extra(&mut b);
        b
    }

    #[test]
    fn parses_add_with_tip() {
        let d = parse(&wire(
            NIM_ADD,
            0x1234,
            7,
            NIF_MESSAGE | NIF_ICON | NIF_TIP,
            "NordVPN",
            |_| {},
        ))
        .unwrap();
        assert_eq!(
            (d.message, d.hwnd, d.uid, d.callback, d.hicon),
            (NIM_ADD, 0x1234, 7, 0x8001, 0xabcd)
        );
        assert_eq!(d.tip, "NordVPN");
        assert_eq!(d.guid, None);
        assert_eq!(icon_id(&d), "h:1234:7");
    }

    #[test]
    fn rejects_bad_signature() {
        let mut b = wire(NIM_ADD, 1, 1, 0, "", |_| {});
        b[0] = 0;
        assert!(parse(&b).is_none());
    }

    #[test]
    fn guid_identity_when_flagged() {
        let b = wire(NIM_ADD, 1, 1, NIF_GUID, "", |b| b[8 + 936] = 0x42);
        let d = parse(&b).unwrap();
        assert!(icon_id(&d).starts_with("g:42"));
    }

    #[test]
    fn short_legacy_struct_is_ok() {
        let mut b = wire(NIM_ADD, 9, 2, NIF_TIP, "old", |_| {});
        b[8..12].copy_from_slice(&88u32.to_le_bytes()); // NOTIFYICONDATA v1 size
        let d = parse(&b).unwrap();
        assert_eq!(d.hwnd, 9);
        assert_eq!(d.version, 0);
    }

    #[test]
    fn add_modify_hide_delete() {
        let mut icons = BTreeMap::new();
        let mut seq = 0;
        let png = |_h: u32| Some("data:x".to_string());
        let add = parse(&wire(
            NIM_ADD,
            5,
            1,
            NIF_ICON | NIF_TIP | NIF_MESSAGE,
            "A",
            |_| {},
        ))
        .unwrap();
        assert!(apply(&mut icons, &add, &mut seq, png));
        assert_eq!(visible(&icons).len(), 1);

        let hide = parse(&wire(NIM_MODIFY, 5, 1, NIF_STATE, "", |b| {
            b[8 + 280..8 + 284].copy_from_slice(&NIS_HIDDEN.to_le_bytes());
            b[8 + 284..8 + 288].copy_from_slice(&NIS_HIDDEN.to_le_bytes());
        }))
        .unwrap();
        assert!(apply(&mut icons, &hide, &mut seq, png));
        assert!(visible(&icons).is_empty());

        let del = parse(&wire(NIM_DELETE, 5, 1, 0, "", |_| {})).unwrap();
        assert!(apply(&mut icons, &del, &mut seq, png));
        assert!(icons.is_empty());
    }

    #[test]
    fn modify_without_changes_is_quiet() {
        let mut icons = BTreeMap::new();
        let mut seq = 0;
        let png = |_h: u32| Some("data:x".to_string());
        let add = parse(&wire(NIM_ADD, 5, 1, NIF_ICON | NIF_TIP, "A", |_| {})).unwrap();
        apply(&mut icons, &add, &mut seq, png);
        let same = parse(&wire(NIM_MODIFY, 5, 1, NIF_TIP, "A", |_| {})).unwrap();
        assert!(!apply(&mut icons, &same, &mut seq, png));
    }
}
