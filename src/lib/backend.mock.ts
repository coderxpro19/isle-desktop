import type { Backend } from "./backend";
import type { Artwork, BatteryState, EventMap, MediaState, Rect, Settings } from "./types";
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
    on(event, cb) {
      const set = listeners.get(event) ?? new Set();
      listeners.set(event, set);
      set.add(cb as Listener);
      return () => set.delete(cb as Listener);
    },
  };
}
