//! Every event name the backend emits. Mirrored in `src/lib/ipc.ts`.

pub const BATTERY_CHANGED: &str = "battery://changed";
pub const MEDIA_CHANGED: &str = "media://changed";
pub const MEDIA_ARTWORK: &str = "media://artwork";
pub const MEDIA_SPECTRUM: &str = "media://spectrum";
pub const ISLAND_HOVER: &str = "island://hover";
pub const SETTINGS_CHANGED: &str = "settings://changed";
