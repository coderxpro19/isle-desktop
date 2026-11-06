//! Clipboard history: text, images and files copied anywhere, kept (and
//! pinned) in the island. Alt+Shift+V opens it over the current app; Enter
//! pastes the chosen item back into that app.
//!
//! Content that apps mark as private (password managers set
//! `ExcludeClipboardContentFromMonitorProcessing` /
//! `CanIncludeInClipboardHistory = 0`) is never recorded.

mod dib;
#[cfg(windows)]
mod win;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::events;

pub const MAX_ITEMS: usize = 200;
pub const MAX_IMAGES: usize = 40;
pub const MAX_TEXT: usize = 256 * 1024;
const THUMB_PX: u32 = 240;

pub(crate) static ENABLED: AtomicBool = AtomicBool::new(true);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ClipKind {
    Text,
    Image,
    Files,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: u64,
    pub kind: ClipKind,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub files: Vec<String>,
    /// Image thumbnail data URL (not stored on disk; rebuilt on load).
    #[serde(default, skip_deserializing)]
    pub preview: Option<String>,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    /// Content signature for de-duplication.
    #[serde(default)]
    pub sig: u64,
    #[serde(default)]
    pub pinned: bool,
    pub at_ms: u64,
    /// App that put it on the clipboard (exe stem), if known.
    #[serde(default)]
    pub app: Option<String>,
}

/// What the platform layer read off the clipboard.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) enum Captured {
    Text(String),
    Files(Vec<String>),
    /// Full-size PNG + dimensions.
    Image {
        png: Vec<u8>,
        w: u32,
        h: u32,
    },
}

pub(crate) fn fnv(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325u64, |h, b| {
        (h ^ *b as u64).wrapping_mul(0x100000001b3)
    })
}

#[derive(Default)]
pub struct History {
    pub items: Vec<Clip>,
    next_id: u64,
}

impl History {
    /// Insert a new clip at the top. An identical earlier clip moves up (keeping
    /// its id and pin) instead. Returns the clips evicted to stay within limits.
    pub fn push(&mut self, mut clip: Clip) -> (u64, Vec<Clip>) {
        if let Some(i) = self
            .items
            .iter()
            .position(|c| c.kind == clip.kind && c.sig == clip.sig)
        {
            let old = self.items.remove(i);
            clip.id = old.id;
            clip.pinned = old.pinned;
            if clip.preview.is_none() {
                clip.preview = old.preview;
            }
        } else {
            self.next_id = self
                .next_id
                .max(self.items.iter().map(|c| c.id).max().unwrap_or(0))
                + 1;
            clip.id = self.next_id;
        }
        let id = clip.id;
        self.items.insert(0, clip);
        (id, self.trim())
    }

    fn trim(&mut self) -> Vec<Clip> {
        let mut evicted = Vec::new();
        let mut images = 0;
        let mut kept = 0;
        self.items.retain(|c| {
            if c.pinned {
                return true;
            }
            let is_img = c.kind == ClipKind::Image;
            if kept >= MAX_ITEMS || (is_img && images >= MAX_IMAGES) {
                evicted.push(c.clone());
                return false;
            }
            kept += 1;
            images += is_img as usize;
            true
        });
        evicted
    }

    pub fn remove(&mut self, id: Option<u64>) -> Vec<Clip> {
        let (gone, keep): (Vec<_>, Vec<_>) =
            std::mem::take(&mut self.items)
                .into_iter()
                .partition(|c| match id {
                    Some(id) => c.id == id,
                    None => !c.pinned,
                });
        self.items = keep;
        gone
    }
}

pub struct ClipboardService {
    pub(crate) hist: Arc<Mutex<History>>,
    pub(crate) dir: Option<PathBuf>,
}

impl ClipboardService {
    pub fn spawn(app: AppHandle, enabled: bool) -> Self {
        ENABLED.store(enabled, Ordering::Relaxed);
        let dir = app.path().app_data_dir().ok().map(|d| d.join("clipboard"));
        let hist = Arc::new(Mutex::new(History::default()));
        if let Some(d) = &dir {
            let _ = std::fs::create_dir_all(d.join("images"));
            if let Ok(text) = std::fs::read_to_string(d.join("history.json")) {
                if let Ok(mut items) = serde_json::from_str::<Vec<Clip>>(&text) {
                    for c in items.iter_mut().filter(|c| c.kind == ClipKind::Image) {
                        c.preview = std::fs::read(image_path(d, c.id, true))
                            .ok()
                            .map(|b| png_url(&b));
                    }
                    items.retain(|c| c.kind != ClipKind::Image || c.preview.is_some());
                    hist.lock().items = items;
                }
            }
        }
        let me = Self { hist, dir };
        #[cfg(windows)]
        {
            let (h, d) = (me.hist.clone(), me.dir.clone());
            std::thread::Builder::new()
                .name("isle-clipboard".into())
                .spawn(move || win::run(app, h, d))
                .ok();
        }
        #[cfg(not(windows))]
        let _ = app;
        me
    }
}

pub(crate) fn image_path(dir: &std::path::Path, id: u64, thumb: bool) -> PathBuf {
    dir.join("images").join(if thumb {
        format!("{id}.thumb.png")
    } else {
        format!("{id}.png")
    })
}

fn png_url(bytes: &[u8]) -> String {
    use base64::Engine as _;
    format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

pub(crate) fn save(dir: &Option<PathBuf>, hist: &History) {
    let Some(d) = dir else { return };
    let items: Vec<Clip> = hist
        .items
        .iter()
        .map(|c| Clip {
            preview: None,
            ..c.clone()
        })
        .collect();
    if let Ok(json) = serde_json::to_string(&items) {
        let tmp = d.join("history.json.tmp");
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(&tmp, d.join("history.json"));
        }
    }
}

fn forget_files(dir: &Option<PathBuf>, gone: &[Clip]) {
    if let Some(d) = dir {
        for c in gone.iter().filter(|c| c.kind == ClipKind::Image) {
            let _ = std::fs::remove_file(image_path(d, c.id, false));
            let _ = std::fs::remove_file(image_path(d, c.id, true));
        }
    }
}

/// Record something read off the clipboard.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn record(
    app: &AppHandle,
    hist: &Mutex<History>,
    dir: &Option<PathBuf>,
    cap: Captured,
    src: Option<String>,
) {
    let now = crate::util::now_ms();
    let base = |kind, sig| Clip {
        id: 0,
        kind,
        text: None,
        files: Vec::new(),
        preview: None,
        width: 0,
        height: 0,
        sig,
        pinned: false,
        at_ms: now,
        app: src.clone(),
    };
    let mut h = hist.lock();
    let (gone, id_png) = match cap {
        Captured::Text(t) => {
            if t.trim().is_empty() || t.len() > MAX_TEXT {
                return;
            }
            let c = Clip {
                text: Some(t.clone()),
                ..base(ClipKind::Text, fnv(t.as_bytes()))
            };
            (h.push(c).1, None)
        }
        Captured::Files(f) => {
            let c = Clip {
                files: f.clone(),
                ..base(ClipKind::Files, fnv(f.join("\n").as_bytes()))
            };
            (h.push(c).1, None)
        }
        Captured::Image { png, w, h: ih } => {
            let thumb = dib::decode_png(&png)
                .map(|img| dib::thumbnail(&img, THUMB_PX))
                .and_then(|t| dib::encode_png(&t));
            let Some(thumb) = thumb else { return };
            let c = Clip {
                preview: Some(png_url(&thumb)),
                width: w,
                height: ih,
                ..base(ClipKind::Image, fnv(&png))
            };
            let (id, gone) = h.push(c);
            (gone, Some((id, png, thumb)))
        }
    };
    if let (Some(d), Some((id, png, thumb))) = (dir, id_png) {
        let _ = std::fs::write(image_path(d, id, false), png);
        let _ = std::fs::write(image_path(d, id, true), thumb);
    }
    forget_files(dir, &gone);
    save(dir, &h);
    let _ = app.emit(events::CLIP_CHANGED, &h.items);
}

/// Put plain text on the clipboard and paste it into the app that was in front
/// when Isle was summoned by a hotkey.
pub fn paste_text(text: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        let clip = Clip {
            id: 0,
            kind: ClipKind::Text,
            text: Some(text.to_string()),
            files: Vec::new(),
            preview: None,
            width: 0,
            height: 0,
            sig: 0,
            pinned: false,
            at_ms: 0,
            app: None,
        };
        win::write(&clip, None)?;
        win::paste_into_previous();
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = text;
        Err("not supported on this platform".into())
    }
}

pub fn set_enabled(on: bool) {
    ENABLED.store(on, Ordering::Relaxed);
}

#[tauri::command]
pub fn clip_list(svc: State<'_, ClipboardService>) -> Vec<Clip> {
    svc.hist.lock().items.clone()
}

#[tauri::command]
pub fn clip_pin(app: AppHandle, svc: State<'_, ClipboardService>, id: u64, pinned: bool) {
    let mut h = svc.hist.lock();
    if let Some(c) = h.items.iter_mut().find(|c| c.id == id) {
        c.pinned = pinned;
    }
    save(&svc.dir, &h);
    let _ = app.emit(events::CLIP_CHANGED, &h.items);
}

/// Delete one clip, or (with no id) everything that isn't pinned.
#[tauri::command]
pub fn clip_delete(app: AppHandle, svc: State<'_, ClipboardService>, id: Option<u64>) {
    let mut h = svc.hist.lock();
    let gone = h.remove(id);
    forget_files(&svc.dir, &gone);
    save(&svc.dir, &h);
    let _ = app.emit(events::CLIP_CHANGED, &h.items);
}

/// Put a clip back on the clipboard; with `paste`, also paste it into the app
/// that was in front when the history was opened with the hotkey.
#[tauri::command]
pub fn clip_copy(svc: State<'_, ClipboardService>, id: u64, paste: bool) -> Result<(), String> {
    let clip = svc
        .hist
        .lock()
        .items
        .iter()
        .find(|c| c.id == id)
        .cloned()
        .ok_or("not found")?;
    #[cfg(windows)]
    {
        let image = match (&svc.dir, clip.kind) {
            (Some(d), ClipKind::Image) => {
                let png =
                    std::fs::read(image_path(d, clip.id, false)).map_err(|e| e.to_string())?;
                Some(dib::rgba_to_dib(&dib::decode_png(&png).ok_or("bad image")?))
            }
            _ => None,
        };
        win::write(&clip, image.as_deref())?;
        if paste {
            win::paste_into_previous();
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (clip, paste);
        Err("not supported on this platform".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(t: &str) -> Clip {
        Clip {
            id: 0,
            kind: ClipKind::Text,
            text: Some(t.into()),
            files: vec![],
            preview: None,
            width: 0,
            height: 0,
            sig: fnv(t.as_bytes()),
            pinned: false,
            at_ms: 0,
            app: None,
        }
    }

    #[test]
    fn dedupes_and_moves_to_top() {
        let mut h = History::default();
        let (a, _) = h.push(text("a"));
        h.push(text("b"));
        h.items[1].pinned = true; // "a"
        let (a2, _) = h.push(text("a"));
        assert_eq!(a, a2);
        assert_eq!(
            h.items
                .iter()
                .map(|c| c.text.clone().unwrap())
                .collect::<Vec<_>>(),
            ["a", "b"]
        );
        assert!(h.items[0].pinned);
    }

    #[test]
    fn evicts_oldest_unpinned() {
        let mut h = History::default();
        h.push(text("keep"));
        h.items[0].pinned = true;
        let mut evicted = 0;
        for i in 0..MAX_ITEMS + 5 {
            evicted += h.push(text(&format!("t{i}"))).1.len();
        }
        assert_eq!(evicted, 5);
        assert_eq!(h.items.len(), MAX_ITEMS + 1);
        assert!(h.items.iter().any(|c| c.text.as_deref() == Some("keep")));
    }

    #[test]
    fn clear_keeps_pinned() {
        let mut h = History::default();
        h.push(text("x"));
        h.push(text("y"));
        h.items[0].pinned = true;
        let gone = h.remove(None);
        assert_eq!(gone.len(), 1);
        assert_eq!(h.items[0].text.as_deref(), Some("y"));
    }
}
