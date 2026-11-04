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
  };
  appearance: {
    accent: string;
    cornerRadius: number;
    reduceMotion: boolean;
  };
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
  },
  appearance: { accent: "artwork", cornerRadius: 22, reduceMotion: false },
};

/** Spectrum frame: 12 bands, 0-255. */
export type Spectrum = number[];

export interface EventMap {
  "battery://changed": BatteryState;
  "media://changed": MediaState | null;
  "media://artwork": Artwork;
  "media://spectrum": Spectrum;
  "island://hover": boolean;
  "settings://changed": Settings;
}
