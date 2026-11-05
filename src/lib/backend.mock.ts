import type { Backend } from "./backend";
import type { Artwork, BatteryState, BtDevice, ControlsState, DockApp, LauncherApp, WifiNetwork, EventMap, MediaState, Rect, Settings, StatsTick, Weather, Clip, FileDrop, Notice, NoticeState } from "./types";
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
  notify(n?: Partial<Notice>): void;
  drop(paths: string[]): void;
  openClipboard(): void;
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

  // ── dock ──
  const tile = (bg: string, fg: string, glyph: string) =>
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${fg}"/></linearGradient></defs><rect x="6" y="6" width="84" height="84" rx="22" fill="url(#g)"/><text x="48" y="62" text-anchor="middle" font-family="Segoe UI,sans-serif" font-size="40" font-weight="700" fill="white">${glyph}</text></svg>`)}`;
  const ICONS: Record<string, string> = {
    explorer: tile("#ffd25c", "#f0a91b", "▤"),
    chrome: tile("#4f8ef7", "#2c6ad8", "◉"),
    settings: tile("#8a8f9c", "#5b606b", "⚙"),
    code: tile("#3aa0f0", "#1673c9", "⟨⟩"),
    spotify: tile("#2fdc6e", "#17a34a", "♫"),
    cursor: tile("#3a3a3a", "#111111", "▲"),
    figma: tile("#ff7262", "#a259ff", "F"),
  };
  let dockApps: DockApp[] = [
    { key: "explorer", name: "File Explorer", pinned: true, running: true, active: false, exe: null, windows: [{ hwnd: 11, title: "Downloads", minimized: false }] },
    { key: "chrome", name: "Google Chrome", pinned: true, running: true, active: true, exe: null, windows: [{ hwnd: 21, title: "Isle — GitHub", minimized: false }, { hwnd: 22, title: "Open-Meteo docs", minimized: false }] },
    { key: "settings", name: "Settings", pinned: true, running: false, active: false, exe: null, windows: [] },
    { key: "code", name: "Visual Studio Code", pinned: false, running: true, active: false, exe: null, windows: [{ hwnd: 31, title: "isle-desktop — Island.tsx", minimized: false }] },
    { key: "spotify", name: "Spotify", pinned: false, running: true, active: false, exe: null, windows: [{ hwnd: 41, title: "Spotify Premium", minimized: true }] },
  ];
  const emitDock = () => emit("dock://apps", dockApps);
  const LAUNCHER: LauncherApp[] = [
    "Calculator", "Camera", "Cursor", "Figma", "File Explorer", "Google Chrome", "Mail", "Microsoft Store", "Notepad",
    "Paint", "Photos", "Settings", "Snipping Tool", "Spotify", "Terminal", "Visual Studio Code", "WhatsApp", "Xbox",
  ].map((name) => ({ id: name.toLowerCase().replace(/\s+/g, "-"), name, pinKey: name.toLowerCase() }));
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

  const svgImg = (a: string, b: string) =>
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="150"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="240" height="150" fill="url(#g)"/><circle cx="170" cy="55" r="26" fill="#ffd25a"/></svg>`)}`;
  const ago = (m: number) => Date.now() - m * 60_000;
  let clips: Clip[] = [
    { id: 6, kind: "text", text: "https://github.com/coderxpro19/isle-desktop/releases", files: [], preview: null, width: 0, height: 0, pinned: false, atMs: ago(1), app: "chrome" },
    { id: 5, kind: "image", text: null, files: [], preview: svgImg("#ff7a59", "#7b3fe4"), width: 1920, height: 1200, pinned: false, atMs: ago(6), app: "SnippingTool" },
    { id: 4, kind: "text", text: "Meet at the Lekki office by 6pm — bring the brand board and the new samples.", files: [], preview: null, width: 0, height: 0, pinned: false, atMs: ago(14), app: "WhatsApp" },
    { id: 3, kind: "files", text: null, files: ["C:\\Users\\you\\Desktop\\Isle pitch deck.pdf", "C:\\Users\\you\\Pictures\\lagos-sunset.jpg"], preview: null, width: 0, height: 0, pinned: false, atMs: ago(40), app: "explorer" },
    { id: 2, kind: "text", text: "npm run app:dev", files: [], preview: null, width: 0, height: 0, pinned: true, atMs: ago(300), app: "Code" },
    { id: 1, kind: "text", text: "coderxpro19@gmail.com", files: [], preview: null, width: 0, height: 0, pinned: true, atMs: ago(2000), app: null },
  ];
  const emitClips = () => emit("clip://changed", clips);
  let notices: NoticeState = { access: "allowed", items: [] };
  let noticeId = 1;
  const dropCbs = new Set<(e: FileDrop) => void>();
  const sampleNotices: Partial<Notice>[] = [
    { app: "WhatsApp", title: "Tolu", body: "Are we still on for 6? 🙌" },
    { app: "Outlook", title: "Design review moved", body: "Now Thursday 3:00 PM · Room 4" },
    { app: "Slack", title: "#isle-dev", body: "Ada: the new shelf is so good" },
  ];
  const appIcon = (app: string) =>
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="${app === "WhatsApp" ? "#25d366" : app === "Outlook" ? "#0a64d6" : "#611f69"}"/><text x="16" y="21.5" text-anchor="middle" font-family="Segoe UI" font-size="15" font-weight="700" fill="white">${app[0]}</text></svg>`,
    )}`;

  window.__isleMock = {
    notify(n) {
      const base = sampleNotices[(noticeId - 1) % sampleNotices.length]!;
      const app = n?.app ?? base.app ?? "App";
      const notice: Notice = { id: noticeId++, app, appId: app, title: "", body: "", icon: appIcon(app), atMs: Date.now(), ...base, ...n };
      notices = { ...notices, items: [notice, ...notices.items] };
      emit("notify://new", notice);
      emit("notify://changed", notices);
    },
    openClipboard() {
      emit("clip://open", null);
    },
    drop(paths) {
      dropCbs.forEach((cb) => cb({ type: "drop", paths }));
    },
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
    label: new URLSearchParams(location.search).get("view") ?? "dev",
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
    dockApps: async () => dockApps,
    async dockIcon(key) {
      const k = key.replace(/^app:/, "").split("-")[0]!;
      return ICONS[k] ?? ICONS[Object.keys(ICONS).find((i) => k.includes(i)) ?? ""] ?? tile("#6b7280", "#374151", k.slice(0, 1).toUpperCase());
    },
    async dockLaunch(key) {
      await sleep(900);
      dockApps = dockApps.map((a) =>
        a.key === key ? { ...a, running: true, active: true, windows: [...a.windows, { hwnd: Math.round(Math.random() * 1e6), title: a.name, minimized: false }] } : { ...a, active: false },
      );
      emitDock();
    },
    async dockWindow(hwnd, action) {
      dockApps = dockApps
        .map((a) => {
          const has = a.windows.some((w) => w.hwnd === hwnd);
          if (action === "close") {
            const windows = a.windows.filter((w) => w.hwnd !== hwnd);
            return { ...a, windows, running: windows.length > 0, active: has ? false : a.active };
          }
          const windows = a.windows.map((w) => (w.hwnd === hwnd ? { ...w, minimized: action === "minimize" } : w));
          return { ...a, windows, active: action === "activate" ? has : has ? false : a.active };
        })
        .filter((a) => a.pinned || a.running);
      emitDock();
    },
    async dockPin(key, name, pinned) {
      const existing = dockApps.find((a) => a.key === key);
      if (existing) dockApps = dockApps.map((a) => (a.key === key ? { ...a, pinned } : a)).filter((a) => a.pinned || a.running);
      else if (pinned) dockApps = [...dockApps, { key, name, pinned: true, running: false, active: false, exe: null, windows: [] }];
      dockApps = [...dockApps.filter((a) => a.pinned), ...dockApps.filter((a) => !a.pinned)];
      emitDock();
    },
    async dockPreviews() {},
    dockPlaces: async () => ({ recycleBinItems: 12 }),
    async dockOpenPlace(place) {
      console.info(`[mock] open ${place}`);
    },
    async dockEmptyRecycleBin() {},
    launcherApps: async () => LAUNCHER,
    async launcherLaunch(id) {
      console.info(`[mock] launch ${id}`);
    },
    async launcherToggle(show) {
      emit("launcher://opened", null);
      window.dispatchEvent(new CustomEvent("isle-mock-launcher", { detail: show ?? "toggle" }));
    },
    async power(action) {
      console.info(`[mock] power ${action}`);
    },
    trayIcons: async () =>
      [
        ["nordvpn", "NordVPN — Connected", "#4687ff", "N"],
        ["whatsapp", "WhatsApp", "#25d366", "W"],
        ["security", "Windows Security", "#2b88d8", "✓"],
        ["onedrive", "OneDrive — Up to date", "#0a64d6", "☁"],
        ["isle", "Isle", "#2a2f5c", "◖"],
        ["discord", "Discord", "#5865f2", "D"],
        ["steam", "Steam", "#1b2838", "S"],
        ["nvidia", "NVIDIA Settings", "#76b900", "N"],
      ].map(([id, tip, color, g]) => ({
        id: id!,
        tip: tip!,
        icon: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="${color}"/><text x="16" y="21.5" text-anchor="middle" font-family="Segoe UI" font-size="15" font-weight="700" fill="white">${g}</text></svg>`)}`,
      })),
    async openIsleSettings(section) {
      window.open(`/?view=settings&section=${section ?? "general"}`, "_blank");
    },
    async settingsImport(json) {
      const parsed = JSON.parse(json) as Partial<Settings>;
      if (!parsed || typeof parsed !== "object" || !("island" in parsed)) throw new Error("That isn't an Isle settings file.");
      settings = { ...structuredClone(DEFAULT_SETTINGS), ...parsed } as Settings;
      emit("settings://changed", settings);
      return settings;
    },
    async settingsExport() {
      return "C:\\Users\\you\\Downloads\\Isle settings.json";
    },
    async appVersion() {
      return "0.10.0-dev";
    },
    async clipList() {
      return clips;
    },
    async clipPin(id, pinned) {
      clips = clips.map((c) => (c.id === id ? { ...c, pinned } : c));
      emitClips();
    },
    async clipDelete(id) {
      clips = clips.filter((c) => (id === null ? c.pinned : c.id !== id));
      emitClips();
    },
    async clipCopy(id) {
      const c = clips.find((x) => x.id === id);
      if (c) clips = [{ ...c, atMs: Date.now() }, ...clips.filter((x) => x.id !== id)];
      emitClips();
    },
    async notifyState() {
      return notices;
    },
    async notifyDismiss(id) {
      notices = { ...notices, items: id === null ? [] : notices.items.filter((n) => n.id !== id) };
      emit("notify://changed", notices);
    },
    async notifyOpen() {},
    async notifySettings() {},
    async shelfInfo(paths) {
      return paths.map((path) => {
        const name = path.split(/[\\/]/).pop() ?? path;
        return { path, name, exists: true, isDir: !name.includes("."), size: 1024 * (name.length * 37) };
      });
    },
    async shelfThumb() {
      return null;
    },
    async shelfOpen() {},
    async shelfReveal() {},
    async shelfDrag() {},
    onFileDrop(cb) {
      dropCbs.add(cb);
      return () => dropCbs.delete(cb);
    },
    async calendarFetch(urls) {
      const pad = (n: number) => String(n).padStart(2, "0");
      const at = (dayOffset: number, h: number, m = 0) => {
        const d = new Date();
        d.setDate(d.getDate() + dayOffset);
        return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(h)}${pad(m)}00`;
      };
      const soon = new Date(Date.now() + 8 * 60_000);
      const ev = (uid: string, s: string, e: string, title: string, extra = "") =>
        `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART:${s}\r\nDTEND:${e}\r\nSUMMARY:${title}\r\n${extra}END:VEVENT`;
      const ics = [
        "BEGIN:VCALENDAR",
        ev("1", at(0, soon.getHours(), soon.getMinutes()), at(0, soon.getHours() + 1, soon.getMinutes()), "Design review", "LOCATION:Google Meet\r\n"),
        ev("2", at(0, 17, 30), at(0, 18, 0), "Gym"),
        ev("3", at(1, 10), at(1, 11), "Blanoir shoot planning"),
        ev("4", at(3, 14), at(3, 15), "Call with Tunde"),
        "BEGIN:VEVENT\r\nUID:5\r\nDTSTART;VALUE=DATE:" + at(5, 0).slice(0, 8) + "\r\nSUMMARY:Holiday\r\nEND:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n");
      return urls.map((url) => ({ url, ics, error: null }));
    },
    async trayClick(id, button) {
      console.info(`[mock] tray ${button} on ${id}`);
    },
    async quit() {
      console.info("[mock] quit");
    },
    async reload() {
      location.reload();
    },
    async checkUpdate() {
      await sleep(400);
      return new URLSearchParams(location.search).get("update") ? { version: "0.4.0", notes: "Faster island, new dock." } : null;
    },
    async installUpdate(onProgress) {
      for (let i = 1; i <= 20; i++) {
        await sleep(120);
        onProgress(i / 20);
      }
      console.info("[mock] would restart into the new version");
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
