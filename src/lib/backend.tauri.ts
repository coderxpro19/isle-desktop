import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Backend } from "./backend";
import type { EventMap } from "./types";
import { fetchWeather, geocode } from "./weather";

/** Events addressed to one island window rather than broadcast. */
const WINDOW_SCOPED = new Set<keyof EventMap>(["island://hover"]);

export function createTauriBackend(): Backend {
  const win = getCurrentWebviewWindow();
  return {
    kind: "tauri",
    batteryState: () => invoke("battery_state"),
    mediaState: () => invoke("media_state"),
    mediaArtwork: () => invoke("media_artwork"),
    mediaControl: (action) => invoke("media_control", { action }),
    setVisualizer: (active) => invoke("visualizer_set_active", { active }),
    setHitRects: (rects) => invoke("island_set_hit_rects", { rects }),
    ready: () => invoke("island_ready"),
    getSettings: () => invoke("settings_get"),
    setSettings: (settings) => invoke("settings_set", { settings }),
    controlsState: () => invoke("controls_state"),
    controlsSet: (action) => invoke("controls_set", { action }),
    setControlsActive: (active) => invoke("controls_set_active", { active }),
    setStatsActive: (active) => invoke("stats_set_active", { active }),
    openSettings: (page) => invoke("open_settings", { page }),
    locationCurrent: () => invoke("location_current"),
    weather: fetchWeather,
    geocode,
    on(event, cb) {
      // `listen` is async; return a sync unsubscribe that works even if called early.
      let dispose: (() => void) | null = null;
      let cancelled = false;
      const source = WINDOW_SCOPED.has(event) ? win.listen.bind(win) : listen;
      void source<EventMap[typeof event]>(event, (e) => cb(e.payload)).then((un) => {
        if (cancelled) un();
        else dispose = un;
      });
      return () => {
        cancelled = true;
        dispose?.();
      };
    },
  };
}
