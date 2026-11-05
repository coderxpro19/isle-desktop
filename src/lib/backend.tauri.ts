import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Backend } from "./backend";
import type { EventMap } from "./types";
import { fetchWeather, geocode } from "./weather";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/** Events addressed to one island window rather than broadcast. */
const WINDOW_SCOPED = new Set<keyof EventMap>(["island://hover"]);

export function createTauriBackend(): Backend {
  const win = getCurrentWebviewWindow();
  let pending: Update | null = null;
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
    wifiScan: () => invoke("wifi_scan"),
    wifiConnect: (ssid, password) => invoke("wifi_connect", { ssid, password: password ?? null }),
    wifiDisconnect: () => invoke("wifi_disconnect"),
    btDevices: () => invoke("bt_devices"),
    btSetDiscovery: (active) => invoke("bt_set_discovery", { active }),
    btAction: (id, action) => invoke("bt_action", { id, action }),
    btPairRespond: (accept) => invoke("bt_pair_respond", { accept }),
    async checkUpdate() {
      pending = await check();
      return pending ? { version: pending.version, notes: pending.body ?? null } : null;
    },
    async installUpdate(onProgress) {
      const update = pending ?? (await check());
      if (!update) return;
      let total = 0;
      let done = 0;
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        else if (e.event === "Progress") {
          done += e.data.chunkLength;
          onProgress(total ? Math.min(1, done / total) : null);
        } else if (e.event === "Finished") onProgress(1);
      });
      // On Windows the installer closes Isle itself; relaunch covers other cases.
      await relaunch();
    },
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
