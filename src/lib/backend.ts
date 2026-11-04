import type { Artwork, BatteryState, EventMap, MediaAction, MediaState, Rect, Settings } from "./types";

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
