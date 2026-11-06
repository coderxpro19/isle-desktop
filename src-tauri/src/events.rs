//! Every event name the backend emits. Mirrored in `src/lib/ipc.ts`.

pub const BATTERY_CHANGED: &str = "battery://changed";
pub const MEDIA_CHANGED: &str = "media://changed";
pub const MEDIA_ARTWORK: &str = "media://artwork";
pub const MEDIA_SPECTRUM: &str = "media://spectrum";
pub const ISLAND_HOVER: &str = "island://hover";
pub const SETTINGS_CHANGED: &str = "settings://changed";
pub const CONTROLS_CHANGED: &str = "controls://changed";
pub const STATS_TICK: &str = "stats://tick";
#[cfg_attr(not(windows), allow(dead_code))]
pub const BT_CHANGED: &str = "bt://changed";
#[cfg_attr(not(windows), allow(dead_code))]
pub const BT_PAIRING: &str = "bt://pairing";
/// Tray → UI: user asked to check for updates now.
pub const UPDATER_CHECK: &str = "updater://check";
pub const DOCK_APPS: &str = "dock://apps";
pub const DOCK_OVERLAP: &str = "dock://overlap";
pub const LAUNCHER_OPENED: &str = "launcher://opened";
pub const TRAY_ICONS: &str = "tray://icons";
/// Volume / brightness HUD (`controls::Hud`).
#[cfg_attr(not(windows), allow(dead_code))]
pub const HUD: &str = "hud://show";
/// Win+N pressed: open the dock's N-th pinned app (payload: 0-based slot).
#[cfg_attr(not(windows), allow(dead_code))]
pub const DOCK_HOTKEY: &str = "dock://hotkey";
/// Alt+Shift+Space: open the AI assistant.
#[cfg_attr(not(windows), allow(dead_code))]
pub const AI_OPEN: &str = "ai://open";
/// Clipboard history changed (payload: `Vec<clipboard::Clip>`).
pub const CLIP_CHANGED: &str = "clip://changed";
/// Alt+Shift+V: open clipboard history.
#[cfg_attr(not(windows), allow(dead_code))]
pub const CLIP_OPEN: &str = "clip://open";
/// A new Windows notification arrived (payload: `notify::Notice`).
#[cfg_attr(not(windows), allow(dead_code))]
pub const NOTIFY_NEW: &str = "notify://new";
/// The notification list or access changed (payload: `notify::NoticeState`).
#[cfg_attr(not(windows), allow(dead_code))]
pub const NOTIFY_CHANGED: &str = "notify://changed";
