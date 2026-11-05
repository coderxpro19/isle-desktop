import type {
  Artwork, BatteryState, ControlAction, ControlsState, EventMap, MediaAction, MediaState, Rect, Settings, SettingsPage,
  Weather, WeatherLocation, WifiNetwork, WifiConnectResult, BtDevice, BtAction, UpdateInfo,
  DockApp, LauncherApp, Place, PowerAction, PreviewSlot, WindowAction, TrayIcon, TrayButton, Clip, FileDrop, FileInfo, NoticeState } from "./types";

/**
 * Everything the UI needs from the native side. Two implementations:
 * the real Tauri one, and a mock used when the UI runs in a plain browser
 * (`npm run dev`) so the island can be designed without building the app.
 */
export interface Backend {
  readonly kind: "tauri" | "mock";
  /** Which window this UI is running in: "island-0", "dock-0", "launcher". */
  readonly label: string;
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
  dockApps(): Promise<DockApp[]>;
  dockIcon(key: string, fallback?: string | null): Promise<string | null>;
  dockLaunch(key: string): Promise<void>;
  dockWindow(hwnd: number, action: WindowAction): Promise<void>;
  dockPin(key: string, name: string, pinned: boolean): Promise<void>;
  dockPreviews(slots: PreviewSlot[]): Promise<void>;
  dockPlaces(): Promise<{ recycleBinItems: number }>;
  dockOpenPlace(place: Place): Promise<void>;
  dockEmptyRecycleBin(): Promise<void>;
  launcherApps(): Promise<LauncherApp[]>;
  launcherLaunch(id: string): Promise<void>;
  launcherToggle(show?: boolean): Promise<void>;
  power(action: PowerAction): Promise<void>;
  quit(): Promise<void>;
  trayIcons(): Promise<TrayIcon[]>;
  /** Download ICS feeds (natively: calendar servers don't allow browser fetches). */
  clipList(): Promise<Clip[]>;
  clipPin(id: number, pinned: boolean): Promise<void>;
  /** Delete one clip, or everything unpinned with null. */
  clipDelete(id: number | null): Promise<void>;
  /** Put a clip on the clipboard; `paste` also pastes it into the app opened from. */
  clipCopy(id: number, paste: boolean): Promise<void>;
  notifyState(): Promise<NoticeState>;
  /** Remove one notification from the Action Center (or all with null). */
  notifyDismiss(id: number | null): Promise<void>;
  notifyOpen(appId: string): Promise<void>;
  /** Windows privacy page for notification access. */
  notifySettings(): Promise<void>;
  shelfInfo(paths: string[]): Promise<FileInfo[]>;
  shelfThumb(path: string): Promise<string | null>;
  shelfOpen(path: string): Promise<void>;
  shelfReveal(path: string): Promise<void>;
  /** Native drag of files out of the island; call while the mouse button is down. */
  shelfDrag(paths: string[]): Promise<void>;
  /** Files dragged over / dropped on this window. */
  onFileDrop(cb: (e: FileDrop) => void): () => void;
  calendarFetch(urls: string[]): Promise<{ url: string; ics: string | null; error: string | null }[]>;
  /** x/y: icon centre in dock-window px. */
  trayClick(id: string, button: TrayButton, x: number, y: number): Promise<void>;
  reload(): Promise<void>;
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
