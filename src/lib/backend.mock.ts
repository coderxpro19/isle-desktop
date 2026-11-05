import type { Backend } from "./backend";
import type { Artwork, BatteryState, BtDevice, ControlsState, WifiNetwork, EventMap, MediaState, Rect, Settings, StatsTick, Weather } from "./types";
import { DEFAULT_SETTINGS } from "./types";

/** Fake tracks with generated cover art, for designing in a browser. */
const TRACKS = [
  { title: "Midnight Ferry", artist: "Harbor Lights", album: "Low Tide", ms: 214_000, hues: [258, 320] },
  { title: "Glass Garden", artist: "Nova Okafor", album: "Prism", ms: 187_000, hues: [24, 48] },
  { title: "Static Bloom", artist: "The Quiet Hours", album: "Signals", ms: 243_000, hues: [168, 205] },
];

function coverArt(h1: number, h2: number, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="hsl(${h1} 85% 58%)"/><stop offset="1" stop-color="hsl(${h2} 80% 32%)"/></linearGradient></defs>
  <rect width="300" height="300" fill="url(#g)"/>
  <circle cx="210" cy="96" r="58" fill="hsl(${h2} 90% 80% / .35)"/>
  <circle cx="92" cy="210" r="90" fill="hsl(${h1} 90% 90% / .18)"/>
  <text x="24" y="276" font-family="Segoe UI, sans-serif" font-size="30" font-weight="700" fill="white" fill-opacity=".9">${label}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

export interface MockControls {
  setMedia(mode: "playing" | "paused" | "none"): void;
  setBattery(patch: Partial<BatteryState>): void;
  setControls(patch: Partial<ControlsState>): void;
  nextTrack(): void;
}

declare global {
  interface Window {
    __isleMock?: MockControls;
  }
}

export function createMockBackend(): Backend {
  type Listener = (p: unknown) => void;
  const listeners = new Map<string, Set<Listener>>();
  const emit = <K extends keyof EventMap>(event: K, payload: EventMap[K]) =>
    listeners.get(event)?.forEach((l) => l(payload));

  let settings: Settings = structuredClone(DEFAULT_SETTINGS);
  let battery: BatteryState = {
    hasBattery: true,
    percent: 76,
    charging: false,
    onAc: false,
    saver: false,
    minutesLeft: 214,
  };
  let trackIdx = 0;
  let media: MediaState | null = null;
  let artwork: Artwork | null = null;
  let vizActive = false;
  let controls: ControlsState = {
    volume: { level: 0.62, muted: false, device: "Speakers (Realtek Audio)" },
    brightness: { level: 70, source: "internal" },
    wifi: { on: true },
    bluetooth: { on: false },
    network: { kind: "wifi", name: "Home-5G", signal: 4, online: true },
  };
  const setControls = (patch: Partial<ControlsState>) => {
    controls = { ...controls, ...patch };
    emit("controls://changed", controls);
  };

  let wifi: WifiNetwork[] = [
    { ssid: "Home-5G", signal: 4, secured: true, saved: true, connected: true },
    { ssid: "Home-2.4G", signal: 3, secured: true, saved: true, connected: false },
    { ssid: "MTN_4G_Router", signal: 3, secured: true, saved: false, connected: false },
    { ssid: "Cafe Neo Guest", signal: 2, secured: false, saved: false, connected: false },
    { ssid: "DIRECT-HP Printer", signal: 1, secured: true, saved: false, connected: false },
  ];
  let bt: BtDevice[] = [
    { id: "bt1", name: "Galaxy Buds2 Pro", kind: "audio", paired: true, connected: true, canConnect: true },
    { id: "bt2", name: "JBL Flip 6", kind: "audio", paired: true, connected: false, canConnect: true },
    { id: "bt3", name: "MX Master 3S", kind: "input", paired: true, connected: true, canConnect: false },
  ];
  let pairResolve: (() => void) | null = null;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Plausible, gently wandering stats while the stats tab is open.
  let statsActive = false;
  let t = 0;
  setInterval(() => {
    if (!statsActive) return;
    t += 1;
    const wave = (p: number, a: number) => Math.sin(t / p) * a;
    const tick: StatsTick = {
      cpu: Math.max(2, Math.min(98, 18 + wave(5, 9) + Math.random() * 14 + (t % 17 === 0 ? 40 : 0))),
      cores: 12,
      memTotal: 16 * 1024 ** 3,
      memUsed: (9.4 + wave(9, 0.6) + Math.random() * 0.2) * 1024 ** 3,
      gpu: Math.max(0, 9 + wave(4, 6) + Math.random() * 8),
      netRx: Math.max(0, 380_000 + wave(3, 300_000) + Math.random() * 200_000),
      netTx: Math.max(0, 42_000 + wave(4, 30_000) + Math.random() * 20_000),
      disks: [
        { mount: "C:", used: 338 * 1024 ** 3, total: 476 * 1024 ** 3 },
        { mount: "D:", used: 612 * 1024 ** 3, total: 931 * 1024 ** 3 },
      ],
      uptimeSecs: 3 * 3600 + 22 * 60 + t,
    };
    emit("stats://tick", tick);
  }, 1000);

  const position = (m: MediaState) =>
    Math.min(m.durationMs, m.positionMs + (m.playing ? Date.now() - m.sampledAtMs : 0));

  function loadTrack(idx: number, playing: boolean) {
    const t = TRACKS[idx % TRACKS.length]!;
    const key = `mock-${idx % TRACKS.length}`;
    media = {
      appId: "Spotify.exe",
      appName: "Spotify",
      title: t.title,
      artist: t.artist,
      album: t.album,
      playing,
      canPlayPause: true,
      canNext: true,
      canPrevious: true,
      canSeek: true,
      positionMs: 38_000,
      durationMs: t.ms,
      sampledAtMs: Date.now(),
      trackKey: key,
    };
    artwork = { key, dataUrl: coverArt(t.hues[0]!, t.hues[1]!, t.album) };
    emit("media://changed", media);
    setTimeout(() => artwork && emit("media://artwork", artwork), 60);
  }
  loadTrack(0, true);

  // Fake spectrum: a few drifting sines with a beat, only while asked for.
  let phase = 0;
  setInterval(() => {
    if (!vizActive || !media?.playing) return;
    phase += 0.033;
    const beat = Math.max(0, Math.sin(phase * Math.PI * 4)) ** 6;
    emit(
      "media://spectrum",
      Array.from({ length: 12 }, (_, i) => {
        const base = 0.55 - i * 0.025 + 0.25 * Math.sin(phase * (2 + i * 0.7) + i);
        const v = base + beat * (i < 4 ? 0.4 : 0.12) + Math.random() * 0.12;
        return Math.round(Math.max(0, Math.min(1, v)) * 255);
      }),
    );
  }, 33);

  // Auto-advance like a real player.
  setInterval(() => {
    if (media?.playing && position(media) >= media.durationMs) loadTrack(++trackIdx, true);
  }, 1000);

  window.__isleMock = {
    setMedia(mode) {
      if (mode === "none") {
        media = null;
        emit("media://changed", null);
      } else if (!media) loadTrack(trackIdx, mode === "playing");
      else {
        media = { ...media, positionMs: position(media), sampledAtMs: Date.now(), playing: mode === "playing" };
        emit("media://changed", media);
      }
    },
    setControls,
    setBattery(patch) {
      battery = { ...battery, ...patch };
      emit("battery://changed", battery);
    },
    nextTrack() {
      loadTrack(++trackIdx, true);
    },
  };

  return {
    kind: "mock",
    batteryState: async () => battery,
    mediaState: async () => media,
    mediaArtwork: async () => artwork,
    async mediaControl(action) {
      if (!media) return;
      switch (action.type) {
        case "playPause":
          media = { ...media, positionMs: position(media), sampledAtMs: Date.now(), playing: !media.playing };
          emit("media://changed", media);
          break;
        case "next":
          loadTrack(++trackIdx, true);
          break;
        case "previous":
          if (position(media) > 3000) {
            media = { ...media, positionMs: 0, sampledAtMs: Date.now() };
            emit("media://changed", media);
          } else loadTrack(trackIdx = Math.max(0, trackIdx - 1), true);
          break;
        case "seek":
          media = { ...media, positionMs: action.positionMs, sampledAtMs: Date.now() };
          emit("media://changed", media);
          break;
      }
    },
    async setVisualizer(active) {
      vizActive = active;
    },
    async setHitRects(_rects: Rect[]) {},
    async ready() {},
    getSettings: async () => settings,
    async setSettings(s) {
      settings = s;
      emit("settings://changed", s);
    },
    controlsState: async () => controls,
    async controlsSet(a) {
      switch (a.type) {
        case "setVolume":
          setControls({ volume: controls.volume && { ...controls.volume, level: a.level, muted: a.level > 0 ? false : controls.volume.muted } });
          break;
        case "setMute":
          setControls({ volume: controls.volume && { ...controls.volume, muted: a.muted } });
          break;
        case "setBrightness":
          setControls({ brightness: controls.brightness && { ...controls.brightness, level: a.level } });
          break;
        case "setWifi":
          setControls({
            wifi: { on: a.on },
            network: a.on ? { kind: "wifi", name: "Home-5G", signal: 4, online: true } : { kind: "none", name: null, signal: null, online: false },
          });
          break;
        case "setBluetooth":
          setControls({ bluetooth: { on: a.on } });
          break;
      }
    },
    async setControlsActive() {},
    async setStatsActive(active) {
      statsActive = active;
    },
    async openSettings(page) {
      console.info(`[mock] open settings: ${page}`);
    },
    async wifiScan() {
      await sleep(900);
      return wifi;
    },
    async wifiConnect(ssid, password) {
      await sleep(1200);
      const n = wifi.find((w) => w.ssid === ssid);
      if (!n) return { status: "failed", message: `${ssid} is out of range` };
      if (n.secured && !n.saved && !password) return { status: "needsPassword" };
      if (password && password.length < 8) return { status: "wrongPassword" };
      wifi = wifi.map((w) => ({ ...w, connected: w.ssid === ssid, saved: w.saved || w.ssid === ssid }));
      setControls({ network: { kind: "wifi", name: ssid, signal: n.signal + 1, online: true } });
      return { status: "connected" };
    },
    async wifiDisconnect() {
      wifi = wifi.map((w) => ({ ...w, connected: false }));
      setControls({ network: { kind: "none", name: null, signal: null, online: false } });
    },
    async btDevices() {
      return bt;
    },
    async btSetDiscovery(active) {
      if (active && !bt.some((d) => !d.paired)) {
        setTimeout(() => {
          bt = [...bt, { id: "bt9", name: "Oraimo FreePods 4", kind: "other", paired: false, connected: false, canConnect: false }];
          emit("bt://changed", null);
        }, 1500);
      }
    },
    async btAction(id, action) {
      await sleep(700);
      if (action === "pair") {
        emit("bt://pairing", { id, kind: "confirmPin", pin: "482913" });
        await new Promise<void>((r) => (pairResolve = r));
        emit("bt://pairing", null);
      }
      bt = bt
        .filter((d) => !(action === "forget" && d.id === id))
        .map((d) =>
          d.id !== id ? d : { ...d, connected: action === "connect" || action === "pair" ? true : action === "disconnect" ? false : d.connected, paired: true, kind: action === "pair" ? "audio" : d.kind, canConnect: action === "pair" || d.canConnect },
        );
      emit("bt://changed", null);
    },
    async btPairRespond() {
      pairResolve?.();
    },
    locationCurrent: async () => ({ latitude: 6.455, longitude: 3.394 }),
    async weather(_loc, fahrenheit): Promise<Weather> {
      const c = (v: number) => (fahrenheit ? Math.round(v * 1.8 + 32) : v);
      const hour = new Date().getHours();
      return {
        fetchedAt: Date.now(),
        temp: c(29),
        feelsLike: c(33),
        code: 2,
        isDay: true,
        high: c(31),
        low: c(24),
        precipChance: 40,
        hourly: [0, 1, 2, 3, 4, 5].map((i) => ({
          time: `2026-11-05T${String((hour + 1 + i) % 24).padStart(2, "0")}:00`,
          temp: c([30, 31, 30, 28, 27, 26][i]!),
          code: [2, 1, 3, 80, 61, 3][i]!,
          isDay: (hour + 1 + i) % 24 < 18,
        })),
      };
    },
    async geocode(query) {
      return [
        { name: `${query}, Lagos, Nigeria`, latitude: 6.455, longitude: 3.394 },
        { name: `${query}, Ontario, Canada`, latitude: 43.0, longitude: -81.2 },
      ];
    },
    on(event, cb) {
      const set = listeners.get(event) ?? new Set();
      listeners.set(event, set);
      set.add(cb as Listener);
      return () => set.delete(cb as Listener);
    },
  };
}
