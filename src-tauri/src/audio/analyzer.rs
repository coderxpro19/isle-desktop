//! Turns raw PCM into a handful of smoothed, log-spaced frequency bands.
//! Pure and allocation-free after construction so it's cheap at 30 Hz.

use rustfft::{num_complex::Complex32, Fft, FftPlanner};
use std::sync::Arc;

pub const BANDS: usize = 12;
const FFT_SIZE: usize = 1024;
const MIN_HZ: f32 = 50.0;
const MAX_HZ: f32 = 14_000.0;
const FLOOR_DB: f32 = -64.0;
const ATTACK: f32 = 0.65;
const DECAY: f32 = 0.18;

pub struct Analyzer {
    fft: Arc<dyn Fft<f32>>,
    window: Vec<f32>,
    buf: Vec<Complex32>,
    scratch: Vec<Complex32>,
    /// Inclusive-exclusive FFT bin ranges for each band.
    ranges: [(usize, usize); BANDS],
    smoothed: [f32; BANDS],
}

impl Analyzer {
    pub fn new(sample_rate: u32) -> Self {
        let mut planner = FftPlanner::new();
        let fft = planner.plan_fft_forward(FFT_SIZE);
        let scratch = vec![Complex32::default(); fft.get_inplace_scratch_len()];
        // Hann window.
        let window = (0..FFT_SIZE)
            .map(|i| {
                0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (FFT_SIZE - 1) as f32).cos()
            })
            .collect();
        Self {
            fft,
            window,
            buf: vec![Complex32::default(); FFT_SIZE],
            scratch,
            ranges: band_ranges(sample_rate as f32),
            smoothed: [0.0; BANDS],
        }
    }

    pub const fn fft_size() -> usize {
        FFT_SIZE
    }

    /// `samples` is the most recent mono window (zero-padded if shorter).
    /// Returns band levels 0-255.
    pub fn process(&mut self, samples: &[f32]) -> [u8; BANDS] {
        let n = samples.len().min(FFT_SIZE);
        let offset = FFT_SIZE - n;
        for (i, c) in self.buf.iter_mut().enumerate() {
            let s = if i >= offset {
                samples[samples.len() - FFT_SIZE + i]
            } else {
                0.0
            };
            *c = Complex32::new(s * self.window[i], 0.0);
        }
        self.fft
            .process_with_scratch(&mut self.buf, &mut self.scratch);

        let norm = 2.0 / FFT_SIZE as f32;
        let mut out = [0u8; BANDS];
        for (b, &(lo, hi)) in self.ranges.iter().enumerate() {
            let peak = self.buf[lo..hi]
                .iter()
                .map(|c| c.norm() * norm)
                .fold(0.0f32, f32::max);
            let db = 20.0 * peak.max(1e-9).log10();
            // Gentle tilt so highs (which carry less energy) still move.
            let tilt = 3.0 * (b as f32 / BANDS as f32);
            let level = ((db + tilt - FLOOR_DB) / -FLOOR_DB).clamp(0.0, 1.0);
            let k = if level > self.smoothed[b] {
                ATTACK
            } else {
                DECAY
            };
            self.smoothed[b] += (level - self.smoothed[b]) * k;
            out[b] = (self.smoothed[b] * 255.0).round() as u8;
        }
        out
    }
}

fn band_ranges(sample_rate: f32) -> [(usize, usize); BANDS] {
    let bin_hz = sample_rate / FFT_SIZE as f32;
    let max_bin = FFT_SIZE / 2;
    let mut ranges = [(0, 0); BANDS];
    let ratio = (MAX_HZ / MIN_HZ).powf(1.0 / BANDS as f32);
    let mut prev_hi = 1;
    for (b, r) in ranges.iter_mut().enumerate() {
        let f_lo = MIN_HZ * ratio.powi(b as i32);
        let f_hi = f_lo * ratio;
        let lo = ((f_lo / bin_hz).floor() as usize)
            .max(prev_hi)
            .min(max_bin - 1);
        let hi = ((f_hi / bin_hz).ceil() as usize).max(lo + 1).min(max_bin);
        *r = (lo, hi);
        prev_hi = hi;
    }
    ranges
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(freq: f32, sr: f32) -> Vec<f32> {
        (0..FFT_SIZE)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / sr).sin() * 0.8)
            .collect()
    }

    #[test]
    fn silence_stays_low() {
        let mut a = Analyzer::new(48_000);
        let out = a.process(&vec![0.0; FFT_SIZE]);
        assert!(out.iter().all(|&v| v == 0));
    }

    #[test]
    fn bass_tone_lights_low_band_most() {
        let mut a = Analyzer::new(48_000);
        let s = sine(80.0, 48_000.0);
        let mut out = [0; BANDS];
        for _ in 0..10 {
            out = a.process(&s);
        }
        let max_idx = out.iter().enumerate().max_by_key(|(_, v)| **v).unwrap().0;
        assert!(max_idx <= 1, "expected low band, got {max_idx}: {out:?}");
    }

    #[test]
    fn treble_tone_lights_high_band() {
        let mut a = Analyzer::new(44_100);
        let s = sine(8_000.0, 44_100.0);
        let mut out = [0; BANDS];
        for _ in 0..10 {
            out = a.process(&s);
        }
        let max_idx = out.iter().enumerate().max_by_key(|(_, v)| **v).unwrap().0;
        assert!(
            max_idx >= BANDS - 3,
            "expected high band, got {max_idx}: {out:?}"
        );
    }

    #[test]
    fn ranges_are_monotonic_and_non_empty() {
        for sr in [44_100.0, 48_000.0, 96_000.0] {
            let r = band_ranges(sr);
            for w in r.windows(2) {
                assert!(w[0].1 <= w[1].0 + 1 && w[0].0 < w[1].0);
            }
            assert!(r.iter().all(|(lo, hi)| hi > lo));
        }
    }
}
