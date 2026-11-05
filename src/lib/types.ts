// Mirrors the serde types in src-tauri/src. Keep in sync.

export interface BatteryState {
  hasBattery: boolean;
  percent: number | null;
  charging: boolean;
  onAc: boolean;
  saver: boolean;
  minutesLeft: number | null;
}

export interface MediaState {
  appId: string;
  appName: string;
  title: string;
  artist: string;
  album: string;
  playing: boolean;
  canPlayPause: boolean;
  canNext: boolean;
  canPrevious: boolean;
  canSeek: boolean;
  positionMs: number;
  durationMs: number;
  sampledAtMs: number;
  trackKey: string;
}

export interface Artwork {
  key: string;
  dataUrl: string;
}

export type MediaAction =
  | { type: "playPause" }
  | { type: "next" }
  | { type: "previous" }
  | { type: "seek"; positionMs: number };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Settings {
  version: number;
  island: {
    topOffset: number;
    showSeconds: boolean;
    clock24h: boolean;
    batteryPercent: boolean;
    expandOnHover: boolean;
    visualizer: boolean;
    chargingActivity: boolean;
    hideInFullscreen: boolean;
    focusMode: boolean;
  };
  appearance: {
    accent: string;
    cornerRadius: number;
    reduceMotion: boolean;
  };
  weather: WeatherSettings;
  dock: DockSettings;
}

export type DockMode = "fixed" | "autoHide" | "smart";

export interface PinnedApp {
  key: string;
  name: string;
}

export interface DockSettings {
  enabled: boolean;
  replaceTaskbar: boolean;
  mode: DockMode;
  magnification: boolean;
  iconSize: number;
  pinned: PinnedApp[] | null;
}

export interface WeatherLocation {
  name: string;
  latitude: number;
  longitude: number;
}

export interface WeatherSettings {
  location: WeatherLocation | null;
  fahrenheit: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  island: {
    topOffset: 6,
    showSeconds: false,
    clock24h: false,
    batteryPercent: true,
    expandOnHover: false,
    visualizer: true,
    chargingActivity: true,
    hideInFullscreen: true,
    focusMode: false,
  },
  appearance: { accent: "artwork", cornerRadius: 22, reduceMotion: false },
  weather: { location: null, fahrenheit: false },
  dock: { enabled: true, replaceTaskbar: true, mode: "fixed", magnification: true, iconSize: 40, pinned: null },
};

export interface DockWindow {
  hwnd: number;
  title: string;
  minimized: boolean;
}

export interface DockApp {
  key: string;
  name: string;
  pinned: boolean;
  running: boolean;
  active: boolean;
  /** Exe path for icon fallback. */
  exe: string | null;
  windows: DockWindow[];
}

export interface TrayIcon {
  id: string;
  tip: string;
  /** PNG data URL. */
  icon: string | null;
}

export type TrayButton = "left" | "right" | "double";

export interface LauncherApp {
  id: string;
  name: string;
  pinKey: string | null;
}

export type WindowAction = "activate" | "minimize" | "close";
export type PowerAction = "lock" | "sleep" | "signOut" | "restart" | "shutdown";
export type Place = "downloads" | "documents" | "recycle" | "this-pc";

export interface PreviewSlot {
  hwnd: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ControlsState {
  volume: { level: number; muted: boolean; device: string } | null;
  brightness: { level: number; source: "internal" | "external" } | null;
  wifi: { on: boolean } | null;
  bluetooth: { on: boolean } | null;
  network: { kind: "wifi" | "ethernet" | "cellular" | "none"; name: string | null; signal: number | null; online: boolean };
}

export type ControlAction =
  | { type: "setVolume"; level: number }
  | { type: "setMute"; muted: boolean }
  | { type: "setBrightness"; level: number }
  | { type: "setWifi"; on: boolean }
  | { type: "setBluetooth"; on: boolean };

export interface StatsTick {
  cpu: number;
  cores: number;
  memUsed: number;
  memTotal: number;
  gpu: number | null;
  netRx: number;
  netTx: number;
  disks: { mount: string; used: number; total: number }[];
  uptimeSecs: number;
}

export type SettingsPage =
  | "sound" | "display" | "wifi" | "network" | "bluetooth" | "focus" | "notifications" | "battery" | "location" | "taskmgr";

export interface Weather {
  fetchedAt: number;
  temp: number;
  feelsLike: number;
  code: number;
  isDay: boolean;
  high: number;
  low: number;
  precipChance: number | null;
  hourly: { time: string; temp: number; code: number; isDay: boolean }[];
}

export interface WifiNetwork {
  ssid: string;
  /** 0–4 */
  signal: number;
  secured: boolean;
  saved: boolean;
  connected: boolean;
}

export type WifiConnectResult =
  | { status: "connected" }
  | { status: "needsPassword" }
  | { status: "wrongPassword" }
  | { status: "failed"; message: string };

export interface BtDevice {
  id: string;
  name: string;
  kind: "audio" | "input" | "phone" | "computer" | "wearable" | "other";
  paired: boolean;
  connected: boolean;
  canConnect: boolean;
}

export type BtAction = "connect" | "disconnect" | "pair" | "forget";

export interface PairingPrompt {
  id: string;
  kind: "confirmPin" | "displayPin";
  pin: string;
}

export interface UpdateInfo {
  version: string;
  notes: string | null;
}

/** Spectrum frame: 12 bands, 0-255. */
export type Spectrum = number[];

export interface EventMap {
  "battery://changed": BatteryState;
  "media://changed": MediaState | null;
  "media://artwork": Artwork;
  "media://spectrum": Spectrum;
  "island://hover": boolean;
  "settings://changed": Settings;
  "controls://changed": ControlsState;
  "stats://tick": StatsTick;
  "bt://changed": null;
  "bt://pairing": PairingPrompt | null;
  "updater://check": null;
  "dock://apps": DockApp[];
  "dock://overlap": boolean;
  "tray://icons": TrayIcon[];
  "launcher://opened": null;
}
