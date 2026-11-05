import { useEffect, useRef, useState } from "react";
import { getBackend } from "@/lib/backend";
import { extractAccent } from "@/lib/color";
import { spectrumBus } from "@/lib/spectrum";
import { WEATHER_TTL_MS } from "@/lib/weather";
import { parseIcs } from "@/lib/ics";
import { chime, nextPhase } from "./clock";
import type { MediaState } from "@/lib/types";
import { useIsland } from "./store";

/** Connect the store to the native side: initial snapshot + live events. */
export function useBackendSync() {
  useEffect(() => {
    let disposed = false;
    const offs: (() => void)[] = [];

    void getBackend().then(async (backend) => {
      if (disposed) return;
      const st = useIsland.getState();
      useIsland.setState({ backend });

      const addArtwork = (key: string, dataUrl: string) => {
        useIsland.setState((s) => ({ artworks: { ...prune(s.artworks, key), [key]: dataUrl } }));
        void extractAccent(dataUrl).then((accent) => {
          if (accent) useIsland.setState((s) => ({ accents: { ...prune(s.accents, key), [key]: accent } }));
        });
      };

      offs.push(
        backend.on("battery://changed", st.applyBattery),
        backend.on("media://changed", st.applyMedia),
        backend.on("media://artwork", (a) => addArtwork(a.key, a.dataUrl)),
        backend.on("media://spectrum", spectrumBus.push),
        backend.on("settings://changed", (settings) => useIsland.setState({ settings })),
        // The native hit tester sees the cursor even while the window is
        // click-through, so it's authoritative for entering/leaving the island.
        backend.on("island://hover", (inside) => useIsland.getState().setHovered(inside)),
        backend.on("controls://changed", (controls) => useIsland.setState({ controls })),
        backend.on("stats://tick", (t) => useIsland.getState().pushStats(t)),
        backend.on("bt://pairing", (btPrompt) => useIsland.setState({ btPrompt })),
        backend.on("hud://show", (hud) => {
          if (!useIsland.getState().settings.island.volumeHud && hud.kind === "volume") return;
          useIsland.setState({ transient: { kind: "hud", hud, until: Date.now() + 1600 } });
        }),
      );

      const [settings, battery, media, art, controls] = await Promise.all([
        backend.getSettings(),
        backend.batteryState(),
        backend.mediaState(),
        backend.mediaArtwork(),
        backend.controlsState(),
      ]);
      if (disposed) return;
      useIsland.setState({ settings, controls });
      st.applyBattery(battery);
      st.applyMedia(media);
      if (art) addArtwork(art.key, art.dataUrl);
    });

    return () => {
      disposed = true;
      offs.forEach((f) => f());
    };
  }, []);
}

/** Keep at most a few artworks in memory. */
function prune<T>(rec: Record<string, T>, keep: string): Record<string, T> {
  const keys = Object.keys(rec);
  if (keys.length < 4) return rec;
  return Object.fromEntries(keys.slice(-3).filter((k) => k !== keep).map((k) => [k, rec[k]!]));
}

/** One timer for the whole island: updates `now` exactly on second/minute boundaries. */
export function useClockTicker() {
  const seconds = useIsland((s) => s.settings.island.showSeconds);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      const d = new Date();
      useIsland.setState({ now: d });
      const ms = seconds ? 1000 - d.getMilliseconds() : 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds());
      t = setTimeout(tick, ms + 5);
    };
    tick();
    return () => clearTimeout(t);
  }, [seconds]);
}

/** Smoothly extrapolated playback position. Only ticks while `active`. */
export function usePlaybackPosition(media: MediaState | null, active: boolean): number {
  const compute = () =>
    media ? Math.min(media.durationMs || Infinity, media.positionMs + (media.playing ? Date.now() - media.sampledAtMs : 0)) : 0;
  const [pos, setPos] = useState(compute);
  const ref = useRef(compute);
  ref.current = compute;
  useEffect(() => {
    setPos(ref.current());
    if (!active || !media?.playing) return;
    const id = setInterval(() => setPos(ref.current()), 250);
    return () => clearInterval(id);
  }, [media, active]);
  return pos;
}

/** Ask the backend to capture audio only while it'd actually be visible. */
export function useVisualizerDemand() {
  const backend = useIsland((s) => s.backend);
  const enabled = useIsland((s) => s.settings.island.visualizer);
  const playing = useIsland((s) => !!s.media?.playing);
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const on = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  const want = enabled && playing && visible;
  useEffect(() => {
    void backend?.setVisualizer(want);
  }, [backend, want]);
}

/** Clear transient alerts when they expire. */
export function useTransientExpiry() {
  const transient = useIsland((s) => s.transient);
  useEffect(() => {
    if (!transient) return;
    const t = setTimeout(() => useIsland.setState({ transient: null }), Math.max(0, transient.until - Date.now()));
    return () => clearTimeout(t);
  }, [transient]);
}

/**
 * Hover → peek, click → expand, leave → collapse, with small delays so
 * brushing past the island on the way to a tab doesn't trigger it.
 */
export function useHoverIntent() {
  const pinned = useIsland((s) => s.pins > 0 || s.islandMenu);
  const hovered = useIsland((s) => s.hovered) || pinned;
  const mode = useIsland((s) => s.mode);
  const expandOnHover = useIsland((s) => s.settings.island.expandOnHover);
  useEffect(() => {
    const set = useIsland.getState().setMode;
    if (hovered && mode === "compact") {
      const t = setTimeout(() => set(expandOnHover ? "expanded" : "peek"), 140);
      return () => clearTimeout(t);
    }
    // Leaving the island closes its menu (after the same grace period).
    if (!hovered && useIsland.getState().islandMenu) {
      const t = setTimeout(() => useIsland.setState({ islandMenu: false }), 650);
      return () => clearTimeout(t);
    }
    if (!hovered && mode !== "compact") {
      const t = setTimeout(() => set("compact"), mode === "expanded" ? 650 : 180);
      return () => clearTimeout(t);
    }
  }, [hovered, mode, expandOnHover]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (useIsland.getState().islandMenu) useIsland.setState({ islandMenu: false });
      else useIsland.getState().setMode("compact");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Brightness polling and stats sampling run only while their panel is open. */
export function usePanelDemand() {
  const backend = useIsland((s) => s.backend);
  const open = useIsland((s) => (s.mode === "expanded" ? s.tab : null));
  useEffect(() => {
    if (!backend) return;
    void backend.setControlsActive(open === "controls");
    void backend.setStatsActive(open === "stats");
  }, [backend, open]);
}

/** Fetch weather when a weather view is visible and the cached copy is stale. */
export function useWeather() {
  const backend = useIsland((s) => s.backend);
  const { location, fahrenheit } = useIsland((s) => s.settings.weather);
  const visible = useIsland((s) => s.mode === "expanded" && (s.tab === "weather" || (s.tab === "home" && !s.media)));
  const fetchedAt = useIsland((s) => s.weather?.fetchedAt ?? 0);
  const key = location ? `${location.latitude},${location.longitude},${fahrenheit}` : null;
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (!backend || !key || !location || !visible) return;
    const stale = Date.now() - fetchedAt > WEATHER_TTL_MS || lastKey.current !== key;
    if (!stale) return;
    lastKey.current = key;
    let cancelled = false;
    backend
      .weather(location, fahrenheit)
      .then((weather) => !cancelled && useIsland.setState({ weather, weatherError: null }))
      .catch((e: unknown) => !cancelled && useIsland.setState({ weatherError: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [backend, key, location, fahrenheit, visible, fetchedAt]);
}

const UPDATE_EVERY_MS = 6 * 3600_000;

/** Check for updates shortly after start, every few hours, and on demand from the tray. */
export function useUpdater() {
  const backend = useIsland((s) => s.backend);
  useEffect(() => {
    if (!backend) return;
    const run = async (manual: boolean) => {
      const cur = useIsland.getState().update;
      if (cur.kind === "installing") return;
      if (manual) useIsland.setState({ update: { kind: "checking" }, mode: "expanded", tab: "home", hovered: true });
      try {
        const info = await backend.checkUpdate();
        const prev = useIsland.getState().update;
        const isNew = info && !(prev.kind === "available" && prev.info.version === info.version);
        useIsland.setState({ update: info ? { kind: "available", info } : manual ? { kind: "upToDate" } : { kind: "idle" } });
        // Announce a newly found update on the pill for a few seconds.
        if (isNew && !manual && !useIsland.getState().settings.island.focusMode) {
          useIsland.setState({ transient: { kind: "update", version: info.version, until: Date.now() + 6000 } });
        }
        if (!info && manual) setTimeout(() => useIsland.getState().update.kind === "upToDate" && useIsland.setState({ update: { kind: "idle" } }), 4000);
      } catch (e) {
        // Background checks fail quietly (offline etc.); manual ones say why.
        if (manual) useIsland.setState({ update: { kind: "error", message: e instanceof Error ? e.message : String(e) } });
      }
    };
    const first = setTimeout(() => void run(false), 5000);
    const every = setInterval(() => void run(false), UPDATE_EVERY_MS);
    const off = backend.on("updater://check", () => void run(true));
    return () => {
      clearTimeout(first);
      clearInterval(every);
      off();
    };
  }, [backend]);
}

/** Fire timer / Pomodoro completions exactly on time. */
export function useClockAlarms() {
  const clock = useIsland((s) => s.clock);
  useEffect(() => {
    const now = Date.now();
    const waits: ReturnType<typeof setTimeout>[] = [];
    const t = clock.timer;
    if (t?.endsAt) {
      waits.push(
        setTimeout(() => {
          chime();
          useIsland.setState((s) => ({
            clock: { ...s.clock, timer: null },
            transient: { kind: "timerDone", label: t.label, until: Date.now() + 8000 },
          }));
        }, Math.max(0, t.endsAt - now)),
      );
    }
    const p = clock.pomodoro;
    if (p?.endsAt) {
      waits.push(
        setTimeout(() => {
          chime();
          const label = p.phase === "focus" ? "Focus done — take a break" : "Break over — back to focus";
          useIsland.setState((s) => ({
            clock: { ...s.clock, pomodoro: s.clock.pomodoro && nextPhase(s.clock.pomodoro, Date.now()) },
            transient: { kind: "timerDone", label, until: Date.now() + 6000 },
          }));
        }, Math.max(0, p.endsAt - now)),
      );
    }
    return () => waits.forEach(clearTimeout);
  }, [clock.timer, clock.pomodoro]);
}

/** Re-render every `ms` while `active` (countdowns, stopwatch). */
export function useTicker(active: boolean, ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return active ? now : Date.now();
}

const CALENDAR_EVERY_MS = 15 * 60_000;

/** Download + parse calendar feeds on start, every 15 minutes, and when feeds change. */
export function useCalendar() {
  const backend = useIsland((s) => s.backend);
  const feeds = useIsland((s) => s.settings.calendar.feeds);
  const key = feeds.map((f) => f.url).join("|");
  useEffect(() => {
    if (!backend) return;
    if (!feeds.length) {
      useIsland.setState({ events: [], calendarError: null });
      return;
    }
    let cancelled = false;
    const load = async () => {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      const from = day.getTime() - 86400_000;
      const to = day.getTime() + 42 * 86400_000;
      const res = await backend.calendarFetch(feeds.map((f) => f.url)).catch(() => []);
      if (cancelled) return;
      const events = res.flatMap((r) => (r.ics ? parseIcs(r.ics, r.url, from, to) : [])).sort((a, b) => a.start - b.start);
      const failed = res.filter((r) => r.error);
      useIsland.setState({ events, calendarError: failed.length ? `${failed.length} calendar${failed.length > 1 ? "s" : ""} couldn't load: ${failed[0]!.error}` : null });
    };
    void load();
    const id = setInterval(() => void load(), CALENDAR_EVERY_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, key]);
}
