//! Now playing. On Windows this reads the system media sessions
//! (`GlobalSystemMediaTransportControlsSessionManager`), which every well-behaved
//! player publishes to: Spotify, Apple Music, browsers (YouTube, SoundCloud…),
//! VLC, foobar2000 with the SMTC plugin, and so on.
//!
//! The platform layer runs on its own thread and talks to the rest of the app
//! through a channel, so WinRT never blocks a Tauri command.

#[cfg(windows)]
mod win;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::{mpsc, Arc};
use tauri::{AppHandle, Emitter, State};

use crate::events;

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaState {
    /// Windows AppUserModelID of the source (e.g. `Spotify.exe`).
    pub app_id: String,
    /// Human-friendly app name derived from the id.
    pub app_name: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub playing: bool,
    pub can_play_pause: bool,
    pub can_next: bool,
    pub can_previous: bool,
    pub can_seek: bool,
    /// Playback position at `sampled_at_ms`. The UI extrapolates while playing.
    pub position_ms: u64,
    pub duration_ms: u64,
    pub sampled_at_ms: u64,
    /// Identifies the current track; matches `Artwork::key` once art is loaded.
    pub track_key: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Artwork {
    pub key: String,
    /// `data:image/...;base64,...`
    pub data_url: String,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum MediaAction {
    PlayPause,
    Next,
    Previous,
    Seek { position_ms: u64 },
}

#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, Clone, Copy)]
pub(crate) enum Msg {
    Action(MediaAction),
    /// The current session's properties, playback state or timeline changed.
    Refresh,
    /// The set of sessions, or which one is current, changed.
    SessionsChanged,
}

#[derive(Clone, Default)]
pub(crate) struct Shared {
    pub state: Arc<Mutex<Option<MediaState>>>,
    pub artwork: Arc<Mutex<Option<Artwork>>>,
}

pub struct MediaService {
    tx: mpsc::Sender<Msg>,
    shared: Shared,
}

impl MediaService {
    pub fn spawn(app: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel();
        let shared = Shared::default();
        #[cfg(windows)]
        {
            let (app, shared, tx2) = (app.clone(), shared.clone(), tx.clone());
            std::thread::Builder::new()
                .name("isle-media".into())
                .spawn(move || win::run(app, shared, tx2, rx))
                .expect("spawn media thread");
        }
        #[cfg(not(windows))]
        {
            // No media session API off Windows; keep the channel alive and idle.
            let _ = (app, rx);
        }
        Self { tx, shared }
    }
}

#[tauri::command]
pub fn media_state(svc: State<'_, MediaService>) -> Option<MediaState> {
    svc.shared.state.lock().clone()
}

#[tauri::command]
pub fn media_artwork(svc: State<'_, MediaService>) -> Option<Artwork> {
    svc.shared.artwork.lock().clone()
}

#[tauri::command]
pub fn media_control(svc: State<'_, MediaService>, action: MediaAction) -> Result<(), String> {
    svc.tx.send(Msg::Action(action)).map_err(|e| e.to_string())
}

/// Store `next` and emit it if the UI would render something different.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn publish(app: &AppHandle, shared: &Shared, next: Option<MediaState>) {
    let mut cur = shared.state.lock();
    if needs_emit(cur.as_ref(), next.as_ref()) {
        let _ = app.emit(events::MEDIA_CHANGED, &next);
    }
    *cur = next;
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn publish_artwork(app: &AppHandle, shared: &Shared, art: Artwork) {
    let _ = app.emit(events::MEDIA_ARTWORK, &art);
    *shared.artwork.lock() = Some(art);
}

/// True when anything other than natural playback progress changed, or the
/// position jumped (seek) away from where the UI would have extrapolated it.
pub(crate) fn needs_emit(prev: Option<&MediaState>, next: Option<&MediaState>) -> bool {
    match (prev, next) {
        (None, None) => false,
        (Some(_), None) | (None, Some(_)) => true,
        (Some(a), Some(b)) => {
            let strip = |s: &MediaState| MediaState {
                position_ms: 0,
                sampled_at_ms: 0,
                ..s.clone()
            };
            if strip(a) != strip(b) {
                return true;
            }
            let elapsed = if a.playing {
                b.sampled_at_ms.saturating_sub(a.sampled_at_ms)
            } else {
                0
            };
            let expected = (a.position_ms + elapsed) as i64;
            (expected - b.position_ms as i64).abs() > 1500
        }
    }
}

/// Turn an AppUserModelID into something readable.
/// `Spotify.exe` → Spotify, `SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify` → Spotify,
/// `MSEdge` → Microsoft Edge, `308046B0AF4A39CB` (Firefox) → Firefox.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn friendly_app_name(app_id: &str) -> String {
    let lower = app_id.to_ascii_lowercase();
    const KNOWN: &[(&str, &str)] = &[
        ("spotify", "Spotify"),
        ("msedge", "Microsoft Edge"),
        ("chrome", "Google Chrome"),
        ("308046b0af4a39cb", "Firefox"),
        ("firefox", "Firefox"),
        ("brave", "Brave"),
        ("opera", "Opera"),
        ("vivaldi", "Vivaldi"),
        ("applemusic", "Apple Music"),
        ("itunes", "iTunes"),
        ("zunemusic", "Media Player"),
        ("vlc", "VLC"),
        ("foobar2000", "foobar2000"),
        ("tidal", "TIDAL"),
        ("deezer", "Deezer"),
        ("amazonmusic", "Amazon Music"),
        ("youtube", "YouTube Music"),
    ];
    if let Some((_, name)) = KNOWN.iter().find(|(k, _)| lower.contains(k)) {
        return (*name).to_string();
    }
    // Packaged apps: "Publisher.App_hash!AppId" → "AppId"; classic: "Foo.exe" → "Foo".
    let base = app_id.rsplit('!').next().unwrap_or(app_id);
    let base = base.rsplit(['\\', '/']).next().unwrap_or(base);
    let base = base
        .strip_suffix(".exe")
        .or_else(|| base.strip_suffix(".EXE"))
        .unwrap_or(base);
    if base.is_empty() {
        "Media".into()
    } else {
        base.to_string()
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn track_key(app_id: &str, title: &str, artist: &str, album: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (app_id, title, artist, album).hash(&mut h);
    format!("{:016x}", h.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn st(pos: u64, at: u64, playing: bool) -> MediaState {
        MediaState {
            title: "A".into(),
            playing,
            position_ms: pos,
            sampled_at_ms: at,
            ..Default::default()
        }
    }

    #[test]
    fn natural_progress_is_not_emitted() {
        assert!(!needs_emit(
            Some(&st(10_000, 0, true)),
            Some(&st(11_000, 1_000, true))
        ));
    }

    #[test]
    fn seek_is_emitted() {
        assert!(needs_emit(
            Some(&st(10_000, 0, true)),
            Some(&st(60_000, 1_000, true))
        ));
    }

    #[test]
    fn pause_is_emitted() {
        assert!(needs_emit(
            Some(&st(10_000, 0, true)),
            Some(&st(10_000, 0, false))
        ));
    }

    #[test]
    fn appearing_and_disappearing() {
        assert!(needs_emit(None, Some(&st(0, 0, true))));
        assert!(needs_emit(Some(&st(0, 0, true)), None));
        assert!(!needs_emit(None, None));
    }

    #[test]
    fn app_names() {
        assert_eq!(friendly_app_name("Spotify.exe"), "Spotify");
        assert_eq!(
            friendly_app_name("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"),
            "Spotify"
        );
        assert_eq!(friendly_app_name("MSEdge"), "Microsoft Edge");
        assert_eq!(friendly_app_name("308046B0AF4A39CB"), "Firefox");
        assert_eq!(friendly_app_name("C:\\Tools\\Winamp.exe"), "Winamp");
        assert_eq!(friendly_app_name("Contoso.Player_abc!App"), "App");
    }

    #[test]
    fn action_json_shape() {
        let a: MediaAction = serde_json::from_str(r#"{"type":"seek","positionMs":42}"#).unwrap();
        assert_eq!(a, MediaAction::Seek { position_ms: 42 });
        let b: MediaAction = serde_json::from_str(r#"{"type":"playPause"}"#).unwrap();
        assert_eq!(b, MediaAction::PlayPause);
    }
}
