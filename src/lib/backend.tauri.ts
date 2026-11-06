import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Backend } from "./backend";
import type { EventMap } from "./types";
import { fetchWeather, geocode } from "./weather";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";

/** Events addressed to one island window rather than broadcast. */
const WINDOW_SCOPED = new Set<keyof EventMap>(["island://hover", "launcher://opened"]);

export function createTauriBackend(): Backend {
  const win = getCurrentWebviewWindow();
  let pending: Update | null = null;
  return {
    kind: "tauri",
    label: win.label,
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
    dockApps: () => invoke("dock_apps"),
    dockIcon: (key, fallback) => invoke("dock_icon", { key, fallback: fallback ?? null }),
    dockLaunch: (key) => invoke("dock_launch", { key }),
    dockWindow: (hwnd, action) => invoke("dock_window", { hwnd, action }),
    dockPin: (key, name, pinned) => invoke("dock_pin", { key, name, pinned }),
    dockPreviews: (slots) => invoke("dock_previews", { slots }),
    dockPlaces: () => invoke("dock_places"),
    dockOpenPlace: (place) => invoke("dock_open_place", { place }),
    dockEmptyRecycleBin: () => invoke("dock_empty_recycle_bin"),
    launcherApps: () => invoke("launcher_apps"),
    launcherLaunch: (id) => invoke("launcher_launch", { id }),
    launcherToggle: (show) => invoke("launcher_toggle", { show: show ?? null }),
    power: (action) => invoke("power", { action }),
    quit: () => invoke("app_quit"),
    trayIcons: () => invoke("tray_icons"),
    calendarFetch: (urls) => invoke("calendar_fetch", { urls }),
    openIsleSettings: (section) => invoke("isle_settings_open", { section: section ?? null }),
    settingsImport: (json) => invoke("settings_import", { json }),
    settingsExport: () => invoke("settings_export"),
    appVersion: () => getVersion(),
    aiAsk: (id, provider, model, baseUrl, messages) => invoke("ai_ask", { id, provider, model: model || null, baseUrl: baseUrl || null, messages }),
    aiCancel: (id) => invoke("ai_cancel", { id }),
    aiKeys: () => invoke("ai_keys"),
    aiSetKey: (provider, key) => invoke("ai_set_key", { provider, key }),
    aiKeyPage: (provider) => invoke("ai_key_page", { provider }),
    aiPaste: (text) => invoke("ai_paste", { text }),
    clipList: () => invoke("clip_list"),
    clipPin: (id, pinned) => invoke("clip_pin", { id, pinned }),
    clipDelete: (id) => invoke("clip_delete", { id }),
    clipCopy: (id, paste) => invoke("clip_copy", { id, paste }),
    notifyState: () => invoke("notify_state"),
    notifyDismiss: (id) => invoke("notify_dismiss", { id }),
    notifyOpen: (appId) => invoke("notify_open", { appId }),
    notifySettings: () => invoke("notify_settings"),
    shelfInfo: (paths) => invoke("shelf_info", { paths }),
    shelfThumb: (path) => invoke("shelf_thumb", { path }),
    shelfOpen: (path) => invoke("shelf_open", { path }),
    shelfReveal: (path) => invoke("shelf_reveal", { path }),
    shelfDrag: (paths) => invoke("shelf_drag", { paths }),
    onFileDrop(cb) {
      let off: (() => void) | null = null;
      let dead = false;
      void win
        .onDragDropEvent((e) => {
          const p = e.payload;
          if (p.type === "leave") cb({ type: "leave" });
          else if (p.type === "drop") cb({ type: "drop", paths: p.paths });
          else cb({ type: p.type, paths: p.type === "enter" ? p.paths : [] });
        })
        .then((u) => (dead ? u() : (off = u)));
      return () => {
        dead = true;
        off?.();
      };
    },
    trayClick: (id, button, x, y) => invoke("tray_click", { id, button, x, y }),
    reload: () => invoke("app_reload"),
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
