//! Audio-reactive visualiser.
//!
//! Captures what the speakers are playing (WASAPI loopback: an input stream on
//! the default *output* device) and emits ~30 band frames per second. Capture
//! only runs while the UI asks for it — i.e. music is playing and the island is
//! visible — so the idle cost is zero.

mod analyzer;

use analyzer::{Analyzer, BANDS};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use parking_lot::Mutex;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

use crate::events;

const FRAME: Duration = Duration::from_millis(33);

pub struct Visualizer {
    tx: mpsc::Sender<bool>,
}

impl Visualizer {
    pub fn spawn(app: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel::<bool>();
        std::thread::Builder::new()
            .name("isle-visualizer".into())
            .spawn(move || run(app, rx))
            .expect("spawn visualizer thread");
        Self { tx }
    }
}

#[tauri::command]
pub fn visualizer_set_active(viz: State<'_, Visualizer>, active: bool) {
    let _ = viz.tx.send(active);
}

struct Capture {
    _stream: cpal::Stream,
    ring: Arc<Mutex<VecDeque<f32>>>,
    broken: Arc<AtomicBool>,
    analyzer: Analyzer,
}

fn run(app: AppHandle, rx: mpsc::Receiver<bool>) {
    let mut want = false;
    let mut capture: Option<Capture> = None;
    let mut last_sent = [0u8; BANDS];
    let mut retry_after = 0u32;

    loop {
        // Block indefinitely while idle; tick at frame rate while capturing.
        let msg = if want {
            rx.recv_timeout(FRAME)
                .map_err(|e| matches!(e, mpsc::RecvTimeoutError::Disconnected))
        } else {
            rx.recv().map_err(|_| true)
        };
        match msg {
            Ok(active) => {
                want = active;
                if !want {
                    capture = None; // drops the stream, releasing the device
                    if last_sent != [0; BANDS] {
                        last_sent = [0; BANDS];
                        let _ = app.emit(events::MEDIA_SPECTRUM, last_sent);
                    }
                }
                continue;
            }
            Err(true) => return, // app is shutting down
            Err(false) => {}     // frame tick
        }

        if capture
            .as_ref()
            .is_some_and(|c| c.broken.load(Ordering::Relaxed))
        {
            log::info!("visualiser capture invalidated (device change?); reopening");
            capture = None;
        }
        if capture.is_none() {
            if retry_after > 0 {
                retry_after -= 1;
                continue;
            }
            match open_capture() {
                Ok(c) => capture = Some(c),
                Err(e) => {
                    log::warn!("visualiser capture unavailable: {e}");
                    retry_after = 90; // ~3 s
                    continue;
                }
            }
        }

        let Some(c) = capture.as_mut() else { continue };
        let samples: Vec<f32> = c.ring.lock().iter().copied().collect();
        let bands = c.analyzer.process(&samples);
        if bands != last_sent {
            last_sent = bands;
            let _ = app.emit(events::MEDIA_SPECTRUM, bands);
        }
    }
}

fn open_capture() -> Result<Capture, String> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or("no default output device")?;
    let config = device.default_output_config().map_err(|e| e.to_string())?;
    let channels = config.channels().max(1) as usize;
    let sample_rate = config.sample_rate().0;
    let ring = Arc::new(Mutex::new(VecDeque::with_capacity(Analyzer::fft_size())));
    let broken = Arc::new(AtomicBool::new(false));

    let push = {
        let ring = ring.clone();
        move |mono: &mut dyn Iterator<Item = f32>| {
            let mut r = ring.lock();
            for s in mono {
                if r.len() == Analyzer::fft_size() {
                    r.pop_front();
                }
                r.push_back(s);
            }
        }
    };
    let on_err = {
        let broken = broken.clone();
        move |e: cpal::StreamError| {
            log::debug!("visualiser stream error: {e}");
            broken.store(true, Ordering::Relaxed);
        }
    };

    let stream_config: cpal::StreamConfig = config.clone().into();
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &stream_config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                push(
                    &mut data
                        .chunks(channels)
                        .map(|f| f.iter().sum::<f32>() / channels as f32),
                )
            },
            on_err,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            &stream_config,
            move |data: &[i16], _: &cpal::InputCallbackInfo| {
                push(&mut data.chunks(channels).map(|f| {
                    f.iter().map(|&s| s as f32 / i16::MAX as f32).sum::<f32>() / channels as f32
                }))
            },
            on_err,
            None,
        ),
        other => return Err(format!("unsupported sample format {other:?}")),
    }
    .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;

    Ok(Capture {
        _stream: stream,
        ring,
        broken,
        analyzer: Analyzer::new(sample_rate),
    })
}
