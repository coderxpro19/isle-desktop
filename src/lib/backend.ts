import type {
  Artwork, BatteryState, ControlAction, ControlsState, EventMap, MediaAction, MediaState, Rect, Settings, SettingsPage,
  Weather, WeatherLocation, WifiNetwork, WifiConnectResult, BtDevice, BtAction, UpdateInfo,
} from "./types";

/**
 * Everything the UI needs from the native side. Two implementations:
 * the real Tauri one, and a mock used when the UI runs in a plain browser
 * (`npm run dev`) so the island can be designed without building the app.
 */
export interface Backend {
  readonly kind: "tauri" | "mock";
  batteryState(): Promise<BatteryState>;
  mediaState(): Promise<MediaState | null>;
  mediaArtwork(): Promise<Artwork | null>;
  mediaControl(action: MediaAction): Promise<void>;
  setVisualizer(active: boolean): Promise<void>;
  setHitRects(rects: Rect[]): Promise<void>;
  ready(): Promise<void>;
  getSettings(): Promise<Settings>;
  setSettings(s: Settings): Promise<void>;
  controlsState(): Promise<ControlsState>;
  controlsSet(action: ControlAction): Promise<void>;
  /** Tell the backend the controls are visible (enables brightness polling). */
  setControlsActive(active: boolean): Promise<void>;
  /** Stats are only sampled while this is on. */
  setStatsActive(active: boolean): Promise<void>;
  openSettings(page: SettingsPage): Promise<void>;
  /** Device location via Windows location services. */
  locationCurrent(): Promise<{ latitude: number; longitude: number }>;
  weather(loc: WeatherLocation, fahrenheit: boolean): Promise<Weather>;
  geocode(query: string): Promise<WeatherLocation[]>;
  wifiScan(): Promise<WifiNetwork[]>;
  wifiConnect(ssid: string, password?: string): Promise<WifiConnectResult>;
  wifiDisconnect(): Promise<void>;
  btDevices(): Promise<BtDevice[]>;
  /** Look for new devices to pair while the Bluetooth list is open. */
  btSetDiscovery(active: boolean): Promise<void>;
  btAction(id: string, action: BtAction): Promise<void>;
  btPairRespond(accept: boolean): Promise<void>;
  /** Ask the release feed for a newer version. */
  checkUpdate(): Promise<UpdateInfo | null>;
  /** Download + install the update found by `checkUpdate`, then restart Isle. */
  installUpdate(onProgress: (fraction: number | null) => void): Promise<void>;
  on<K extends keyof EventMap>(event: K, cb: (payload: EventMap[K]) => void): () => void;
}

export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let instance: Promise<Backend> | null = null;

export function getBackend(): Promise<Backend> {
  instance ??= isTauri()
    ? import("./backend.tauri").then((m) => m.createTauriBackend())
    : import("./backend.mock").then((m) => m.createMockBackend());
  return instance;
}
