//! Windows media sessions (GSMTC) backend.
//!
//! Event-driven: the session manager and the current session push change
//! notifications into our channel; we re-read state on each one. A slow timer
//! (1 s playing / 4 s paused) covers apps that update the timeline without
//! raising events.

use base64::Engine as _;
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::time::Duration;
use tauri::AppHandle;
use windows::core::{Interface, RuntimeType};
use windows::Foundation::TypedEventHandler;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};
use windows::Storage::Streams::{DataReader, IInputStream};
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

use super::{
    friendly_app_name, publish, publish_artwork, track_key, Artwork, MediaAction, MediaState, Msg,
    Shared,
};
use crate::util::now_ms;

/// WinRT `TimeSpan`/`DateTime` tick = 100 ns.
const TICKS_PER_MS: i64 = 10_000;
/// 1601-01-01 → 1970-01-01 in ticks.
const UNIX_EPOCH_TICKS: i64 = 116_444_736_000_000_000;
const MAX_ARTWORK_BYTES: u64 = 6 * 1024 * 1024;

/// The current session plus the event subscriptions we hold on it.
struct Bound {
    session: Session,
    props_token: i64,
    playback_token: i64,
    timeline_token: i64,
}

impl Bound {
    fn new(session: Session, tx: &Sender<Msg>) -> windows::core::Result<Self> {
        let props_token = session.MediaPropertiesChanged(&notify(tx, Msg::Refresh))?;
        let playback_token = session.PlaybackInfoChanged(&notify(tx, Msg::Refresh))?;
        let timeline_token = session.TimelinePropertiesChanged(&notify(tx, Msg::Refresh))?;
        Ok(Self {
            session,
            props_token,
            playback_token,
            timeline_token,
        })
    }
}

/// An event handler that just pokes the media thread.
fn notify<S: RuntimeType + 'static, A: RuntimeType + 'static>(
    tx: &Sender<Msg>,
    msg: Msg,
) -> TypedEventHandler<S, A> {
    let tx = tx.clone();
    TypedEventHandler::new(move |_, _| {
        let _ = tx.send(msg);
        Ok(())
    })
}

impl Drop for Bound {
    fn drop(&mut self) {
        let _ = self.session.RemoveMediaPropertiesChanged(self.props_token);
        let _ = self.session.RemovePlaybackInfoChanged(self.playback_token);
        let _ = self
            .session
            .RemoveTimelinePropertiesChanged(self.timeline_token);
    }
}

pub fn run(app: AppHandle, shared: Shared, tx: Sender<Msg>, rx: Receiver<Msg>) {
    // Multithreaded apartment: WinRT callbacks arrive on pool threads.
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }

    let manager = loop {
        match Manager::RequestAsync().and_then(|op| op.join()) {
            Ok(m) => break m,
            Err(e) => {
                log::warn!("media session manager unavailable: {e}; retrying");
                std::thread::sleep(Duration::from_secs(5));
            }
        }
    };

    // Subscriptions live as long as `manager`, i.e. for the life of this thread.
    if let Err(e) = manager.CurrentSessionChanged(&notify(&tx, Msg::SessionsChanged)) {
        log::warn!("CurrentSessionChanged subscribe failed: {e}");
    }
    if let Err(e) = manager.SessionsChanged(&notify(&tx, Msg::SessionsChanged)) {
        log::warn!("SessionsChanged subscribe failed: {e}");
    }

    let mut bound: Option<Bound> = None;
    let mut rebind = true;
    let mut artwork_for: Option<String> = None;
    let mut last: Option<MediaState> = None;

    loop {
        if rebind {
            rebind = false;
            bound = None; // unsubscribe from the old session first
            if let Ok(session) = manager.GetCurrentSession() {
                match Bound::new(session, &tx) {
                    Ok(b) => bound = Some(b),
                    Err(e) => log::warn!("failed to subscribe to media session: {e}"),
                }
            }
        }

        let state = match &bound {
            Some(b) => match read_state(&b.session) {
                Ok(s) => Some(s),
                // Transient during track switches; keep showing what we had.
                Err(e) => {
                    log::debug!("media read failed: {e}");
                    last.clone()
                }
            },
            None => None,
        };

        if let (Some(b), Some(s)) = (&bound, &state) {
            if artwork_for.as_deref() != Some(s.track_key.as_str()) {
                // Players often publish the thumbnail a beat after the title; we
                // retry on the next properties event until it shows up.
                if let Ok(Some(data_url)) = read_artwork(&b.session) {
                    artwork_for = Some(s.track_key.clone());
                    publish_artwork(
                        &app,
                        &shared,
                        Artwork {
                            key: s.track_key.clone(),
                            data_url,
                        },
                    );
                }
            }
        }

        let playing = state.as_ref().is_some_and(|s| s.playing);
        publish(&app, &shared, state.clone());
        last = state;

        let wait = Duration::from_millis(if playing { 1000 } else { 4000 });
        match rx.recv_timeout(wait) {
            Ok(msg) => {
                // Coalesce bursts (a track change fires 3-4 events at once).
                let mut msgs = vec![msg];
                msgs.extend(rx.try_iter());
                for m in msgs {
                    match m {
                        Msg::SessionsChanged => rebind = true,
                        Msg::Refresh => {}
                        Msg::Action(a) => {
                            if let Some(b) = &bound {
                                if let Err(e) = apply(&b.session, a) {
                                    log::warn!("media action {a:?} failed: {e}");
                                }
                            }
                        }
                    }
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

fn read_state(session: &Session) -> windows::core::Result<MediaState> {
    let app_id = session.SourceAppUserModelId()?.to_string();
    let props = session.TryGetMediaPropertiesAsync()?.join()?;
    let title = props.Title()?.to_string();
    let artist = props.Artist()?.to_string();
    let album = props.AlbumTitle()?.to_string();

    let info = session.GetPlaybackInfo()?;
    let playing = info.PlaybackStatus()? == Status::Playing;
    let controls = info.Controls()?;

    let tl = session.GetTimelineProperties()?;
    let start = tl.StartTime()?.Duration;
    let end = tl.EndTime()?.Duration;
    let pos = tl.Position()?.Duration;
    let updated = tl.LastUpdatedTime()?.UniversalTime;

    let now = now_ms();
    let duration_ms = ((end - start).max(0) / TICKS_PER_MS) as u64;
    let mut position_ms = ((pos - start).max(0) / TICKS_PER_MS) as u64;
    if playing && updated > 0 {
        // Position is a snapshot taken at `updated`; bring it up to now.
        let updated_unix_ms = (updated - UNIX_EPOCH_TICKS) / TICKS_PER_MS;
        let elapsed = now as i64 - updated_unix_ms;
        if (0..6 * 3600 * 1000).contains(&elapsed) {
            position_ms += elapsed as u64;
        }
    }
    if duration_ms > 0 {
        position_ms = position_ms.min(duration_ms);
    }

    Ok(MediaState {
        app_name: friendly_app_name(&app_id),
        track_key: track_key(&app_id, &title, &artist, &album),
        app_id,
        title,
        artist,
        album,
        playing,
        can_play_pause: controls.IsPlayPauseToggleEnabled().unwrap_or(true),
        can_next: controls.IsNextEnabled().unwrap_or(false),
        can_previous: controls.IsPreviousEnabled().unwrap_or(false),
        can_seek: controls.IsPlaybackPositionEnabled().unwrap_or(false) && duration_ms > 0,
        position_ms,
        duration_ms,
        sampled_at_ms: now,
    })
}

fn read_artwork(session: &Session) -> windows::core::Result<Option<String>> {
    let props = session.TryGetMediaPropertiesAsync()?.join()?;
    let Ok(thumb) = props.Thumbnail() else {
        return Ok(None);
    };
    let stream = thumb.OpenReadAsync()?.join()?;
    let size = stream.Size()?;
    if size == 0 || size > MAX_ARTWORK_BYTES {
        return Ok(None);
    }
    let mime = stream
        .ContentType()
        .map(|s| s.to_string())
        .unwrap_or_default();
    let input: IInputStream = stream.cast()?;
    let reader = DataReader::CreateDataReader(&input)?;
    let read = reader.LoadAsync(size as u32)?.join()?;
    let mut buf = vec![0u8; read as usize];
    reader.ReadBytes(&mut buf)?;
    let mime = if mime.starts_with("image/") {
        mime
    } else {
        sniff_mime(&buf).to_string()
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(&buf);
    Ok(Some(format!("data:{mime};base64,{b64}")))
}

fn sniff_mime(bytes: &[u8]) -> &'static str {
    match bytes {
        [0x89, b'P', b'N', b'G', ..] => "image/png",
        [0xFF, 0xD8, ..] => "image/jpeg",
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => "image/webp",
        [b'G', b'I', b'F', ..] => "image/gif",
        _ => "image/jpeg",
    }
}

fn apply(session: &Session, action: MediaAction) -> windows::core::Result<()> {
    let _ok = match action {
        MediaAction::PlayPause => session.TryTogglePlayPauseAsync()?.join()?,
        MediaAction::Next => session.TrySkipNextAsync()?.join()?,
        MediaAction::Previous => session.TrySkipPreviousAsync()?.join()?,
        MediaAction::Seek { position_ms } => {
            let start = session.GetTimelineProperties()?.StartTime()?.Duration;
            let ticks = start + position_ms as i64 * TICKS_PER_MS;
            session.TryChangePlaybackPositionAsync(ticks)?.join()?
        }
    };
    Ok(())
}
