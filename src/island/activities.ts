import type { IslandState, Mode, Transient } from "./store";
import { PAUSED_LINGER_MS } from "./store";

/**
 * Live activities. The highest-priority one owns the pill; the rest render as
 * bubbles beside it (like two activities on an iPhone). Later phases add
 * timers, downloads, calls, etc. by extending `ActivityKind` and `derive`.
 */
export type ActivityKind = "music" | "charging" | "lowBattery";

export interface Activity {
  id: string;
  kind: ActivityKind;
  priority: number;
}

export function deriveActivities(s: Pick<IslandState, "media" | "pausedAt" | "transient">, now: number): Activity[] {
  const out: Activity[] = [];
  const t: Transient | null = s.transient && s.transient.until > now ? s.transient : null;
  if (t) out.push({ id: t.kind, kind: t.kind, priority: 100 });
  if (s.media && (s.media.playing || (s.pausedAt !== null && now - s.pausedAt < PAUSED_LINGER_MS))) {
    out.push({ id: "music", kind: "music", priority: s.media.playing ? 50 : 40 });
  }
  return out.sort((a, b) => b.priority - a.priority);
}

export interface Size {
  w: number;
  h: number;
  r: number;
}

/** Target pill geometry for a given state. Hit-testing uses these targets too. */
export function pillSize(mode: Mode, primary: ActivityKind | null, radius: number): Size {
  if (primary === "charging" || primary === "lowBattery") {
    // Transients are wide and short in compact, or take over the peek.
    return mode === "expanded" ? expanded(primary, radius) : { w: 320, h: 36, r: 18 };
  }
  switch (mode) {
    case "compact":
      return primary === "music" ? { w: 232, h: 34, r: 17 } : { w: 196, h: 34, r: 17 };
    case "peek":
      return primary === "music" ? { w: 372, h: 58, r: 29 } : { w: 300, h: 46, r: 23 };
    case "expanded":
      return expanded(primary, radius);
  }
}

function expanded(primary: ActivityKind | null, radius: number): Size {
  return primary === "music" ? { w: 440, h: 212, r: radius + 14 } : { w: 400, h: 156, r: radius + 10 };
}

export const BUBBLE = 34;
export const BUBBLE_GAP = 8;
export const PILL_TOP = 6;
