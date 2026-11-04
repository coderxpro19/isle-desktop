import { useEffect, useRef, useState } from "react";
import { getBackend } from "@/lib/backend";
import { extractAccent } from "@/lib/color";
import { spectrumBus } from "@/lib/spectrum";
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
      );

      const [settings, battery, media, art] = await Promise.all([
        backend.getSettings(),
        backend.batteryState(),
        backend.mediaState(),
        backend.mediaArtwork(),
      ]);
      if (disposed) return;
      useIsland.setState({ settings });
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
  const hovered = useIsland((s) => s.hovered);
  const mode = useIsland((s) => s.mode);
  const expandOnHover = useIsland((s) => s.settings.island.expandOnHover);
  useEffect(() => {
    const set = useIsland.getState().setMode;
    if (hovered && mode === "compact") {
      const t = setTimeout(() => set(expandOnHover ? "expanded" : "peek"), 140);
      return () => clearTimeout(t);
    }
    if (!hovered && mode !== "compact") {
      const t = setTimeout(() => set("compact"), mode === "expanded" ? 650 : 180);
      return () => clearTimeout(t);
    }
  }, [hovered, mode, expandOnHover]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && useIsland.getState().setMode("compact");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
