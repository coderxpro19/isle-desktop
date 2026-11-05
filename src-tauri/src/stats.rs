//! System stats: CPU, memory, GPU, network throughput, disks.
//!
//! Sampled once a second, and only while the UI is showing them
//! (`stats_set_active`); otherwise the thread sleeps on its channel.

use serde::Serialize;
use std::sync::mpsc;
use std::time::{Duration, Instant};
use sysinfo::{CpuRefreshKind, Disks, MemoryRefreshKind, Networks, RefreshKind, System};
use tauri::{AppHandle, Emitter, State};

use crate::events;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatsTick {
    /// 0–100
    pub cpu: f32,
    pub cores: usize,
    pub mem_used: u64,
    pub mem_total: u64,
    /// 0–100, `None` when no GPU counter is available.
    pub gpu: Option<f32>,
    /// Bytes per second.
    pub net_rx: u64,
    pub net_tx: u64,
    pub disks: Vec<DiskInfo>,
    pub uptime_secs: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub mount: String,
    pub used: u64,
    pub total: u64,
}

pub struct StatsService {
    tx: mpsc::Sender<bool>,
}

impl StatsService {
    pub fn spawn(app: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel::<bool>();
        std::thread::Builder::new()
            .name("isle-stats".into())
            .spawn(move || run(app, rx))
            .expect("spawn stats thread");
        Self { tx }
    }
}

#[tauri::command]
pub fn stats_set_active(svc: State<'_, StatsService>, active: bool) {
    let _ = svc.tx.send(active);
}

fn run(app: AppHandle, rx: mpsc::Receiver<bool>) {
    let mut sys: Option<System> = None;
    let (Ok(mut nets), Ok(mut disks)) = (Networks::new(), Disks::new()) else {
        log::warn!("system stats unavailable");
        return;
    };
    let mut gpu = gpu::Gpu::open();
    let mut last_disk_refresh: Option<Instant> = None;
    let mut last_net: Option<(Instant, u64, u64)> = None;
    let mut active = false;

    loop {
        let msg = if active {
            rx.recv_timeout(Duration::from_secs(1))
                .map_err(|e| matches!(e, mpsc::RecvTimeoutError::Disconnected))
        } else {
            rx.recv().map_err(|_| true)
        };
        match msg {
            Ok(a) => {
                active = a;
                if !active {
                    // Free sysinfo's buffers while hidden.
                    sys = None;
                    last_net = None;
                    continue;
                }
            }
            Err(true) => return,
            Err(false) => {}
        }

        if sys.is_none() {
            let kinds = RefreshKind::nothing()
                .with_cpu(CpuRefreshKind::nothing().with_usage())
                .with_memory(MemoryRefreshKind::nothing().with_ram());
            match System::new_with_specifics(kinds) {
                // CPU usage needs two samples; this is the first.
                Ok(s) => sys = Some(s),
                Err(e) => {
                    log::warn!("sysinfo: {e}");
                    continue;
                }
            }
            nets.refresh(true);
        }
        let Some(s) = sys.as_mut() else { continue };
        s.refresh_cpu_usage();
        s.refresh_memory_specifics(MemoryRefreshKind::nothing().with_ram());

        nets.refresh(true);
        let (rx_total, tx_total) = nets
            .into_iter()
            .filter(|(name, _)| !is_virtual_adapter(&name.to_string_lossy()))
            .fold((0u64, 0u64), |(r, t), (_, d)| {
                (r + d.total_received(), t + d.total_transmitted())
            });
        let now = Instant::now();
        let (net_rx, net_tx) = match last_net {
            Some((then, r0, t0)) => rate(then, now, r0, rx_total, t0, tx_total),
            None => (0, 0),
        };
        last_net = Some((now, rx_total, tx_total));

        if last_disk_refresh.is_none_or(|t| t.elapsed() > Duration::from_secs(30)) {
            disks.refresh(true);
            last_disk_refresh = Some(Instant::now());
        }

        let tick = StatsTick {
            cpu: s.global_cpu_usage().clamp(0.0, 100.0),
            cores: s.cpus().len(),
            mem_used: s.used_memory(),
            mem_total: s.total_memory(),
            gpu: gpu.sample(),
            net_rx,
            net_tx,
            disks: disk_list(&disks),
            uptime_secs: System::uptime().unwrap_or(0),
        };
        let _ = app.emit(events::STATS_TICK, &tick);
    }
}

fn disk_list(disks: &Disks) -> Vec<DiskInfo> {
    let mut seen = std::collections::HashSet::new();
    disks
        .iter()
        .filter(|d| d.total_space() > 1 << 30)
        .filter(|d| seen.insert(d.mount_point().to_string_lossy().to_string()))
        .take(4)
        .map(|d| DiskInfo {
            mount: d
                .mount_point()
                .to_string_lossy()
                .trim_end_matches(['\\', '/'])
                .to_string(),
            used: d.total_space().saturating_sub(d.available_space()),
            total: d.total_space(),
        })
        .collect()
}

/// Bytes/s between two counter samples; counters can reset when adapters change.
fn rate(then: Instant, now: Instant, r0: u64, r1: u64, t0: u64, t1: u64) -> (u64, u64) {
    let secs = now.duration_since(then).as_secs_f64().max(0.001);
    let per = |a: u64, b: u64| {
        if b >= a {
            ((b - a) as f64 / secs) as u64
        } else {
            0
        }
    };
    (per(r0, r1), per(t0, t1))
}

fn is_virtual_adapter(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n == "lo"
        || [
            "loopback",
            "vethernet",
            "hyper-v",
            "virtualbox",
            "vmware",
            "wsl",
        ]
        .iter()
        .any(|v| n.contains(v))
}

#[cfg(windows)]
mod gpu {
    //! GPU utilisation via the "GPU Engine" PDH counters (what Task Manager shows).
    use windows::core::w;
    use windows::Win32::System::Performance::{
        PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData, PdhGetFormattedCounterArrayW,
        PdhOpenQueryW, PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY,
        PDH_MORE_DATA,
    };

    pub struct Gpu {
        query: PDH_HQUERY,
        counter: PDH_HCOUNTER,
        primed: bool,
    }

    impl Gpu {
        pub fn open() -> Option<Self> {
            unsafe {
                let mut query = PDH_HQUERY::default();
                if PdhOpenQueryW(None, 0, &mut query) != 0 {
                    return None;
                }
                let mut counter = PDH_HCOUNTER::default();
                if PdhAddEnglishCounterW(
                    query,
                    w!("\\GPU Engine(*engtype_3D)\\Utilization Percentage"),
                    0,
                    &mut counter,
                ) != 0
                {
                    PdhCloseQuery(query);
                    return None;
                }
                Some(Self {
                    query,
                    counter,
                    primed: false,
                })
            }
        }

        fn read(&mut self) -> Option<f32> {
            unsafe {
                if PdhCollectQueryData(self.query) != 0 {
                    return None;
                }
                if !self.primed {
                    self.primed = true;
                    return None;
                }
                let (mut size, mut count) = (0u32, 0u32);
                let r = PdhGetFormattedCounterArrayW(
                    self.counter,
                    PDH_FMT_DOUBLE,
                    &mut size,
                    &mut count,
                    None,
                );
                if r != PDH_MORE_DATA || size == 0 {
                    return Some(0.0);
                }
                let items =
                    (size as usize).div_ceil(std::mem::size_of::<PDH_FMT_COUNTERVALUE_ITEM_W>());
                let mut buf = vec![PDH_FMT_COUNTERVALUE_ITEM_W::default(); items];
                if PdhGetFormattedCounterArrayW(
                    self.counter,
                    PDH_FMT_DOUBLE,
                    &mut size,
                    &mut count,
                    Some(buf.as_mut_ptr()),
                ) != 0
                {
                    return None;
                }
                // One instance per process × engine; their sum is the 3D engine load.
                let total: f64 = buf[..count as usize]
                    .iter()
                    .map(|i| i.FmtValue.Anonymous.doubleValue)
                    .sum();
                Some(total.clamp(0.0, 100.0) as f32)
            }
        }
    }

    impl Drop for Gpu {
        fn drop(&mut self) {
            unsafe {
                PdhCloseQuery(self.query);
            }
        }
    }

    pub trait Sample {
        fn sample(&mut self) -> Option<f32>;
    }
    impl Sample for Option<Gpu> {
        fn sample(&mut self) -> Option<f32> {
            self.as_mut().and_then(Gpu::read)
        }
    }
}

#[cfg(not(windows))]
mod gpu {
    pub struct Gpu;
    impl Gpu {
        pub fn open() -> Option<Self> {
            None
        }
    }
    pub trait Sample {
        fn sample(&mut self) -> Option<f32>;
    }
    impl Sample for Option<Gpu> {
        fn sample(&mut self) -> Option<f32> {
            None
        }
    }
}

use gpu::Sample as _;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_per_second() {
        let t0 = Instant::now();
        let t1 = t0 + Duration::from_millis(500);
        assert_eq!(rate(t0, t1, 1000, 2000, 0, 500), (2000, 1000));
    }

    #[test]
    fn rate_handles_counter_reset() {
        let t0 = Instant::now();
        let t1 = t0 + Duration::from_secs(1);
        assert_eq!(rate(t0, t1, 5000, 100, 10, 20), (0, 10));
    }

    #[test]
    fn virtual_adapters_filtered() {
        assert!(is_virtual_adapter("vEthernet (WSL)"));
        assert!(is_virtual_adapter("lo"));
        assert!(!is_virtual_adapter("Wi-Fi"));
        assert!(!is_virtual_adapter("Ethernet"));
    }
}
