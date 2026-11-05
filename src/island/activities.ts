import type { IslandState, Mode, Tab, Transient } from "./store";
import { PAUSED_LINGER_MS } from "./store";

/**
 * Live activities. The highest-priority one owns the pill; the rest render as
 * bubbles beside it (like two activities on an iPhone). Later phases add
 * timers, downloads, calls, etc. by extending `ActivityKind` and `derive`.
 */
export type ActivityKind = "music" | "charging" | "lowBattery" | "update";

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
export function pillSize(mode: Mode, primary: ActivityKind | null, radius: number, tab: Tab = "home"): Size {
  if (primary === "charging" || primary === "lowBattery" || primary === "update") {
    // Transients are wide and short in compact, or take over the peek.
    return mode === "expanded" ? expanded(primary, radius, tab) : { w: 320, h: 36, r: 18 };
  }
  switch (mode) {
    case "compact":
      return primary === "music" ? { w: 232, h: 34, r: 17 } : { w: 196, h: 34, r: 17 };
    case "peek":
      return primary === "music" ? { w: 372, h: 58, r: 29 } : { w: 300, h: 46, r: 23 };
    case "expanded":
      return expanded(primary, radius, tab);
  }
}

/** Height of the tab bar at the top of the expanded island. */
export const TAB_BAR_H = 34;

function expanded(primary: ActivityKind | null, radius: number, tab: Tab): Size {
  const r = radius + 14;
  switch (tab) {
    case "controls":
      return { w: 440, h: TAB_BAR_H + 228, r };
    case "weather":
      return { w: 440, h: TAB_BAR_H + 204, r };
    case "stats":
      return { w: 440, h: TAB_BAR_H + 236, r };
    case "home":
      return primary === "music" ? { w: 440, h: TAB_BAR_H + 206, r } : { w: 420, h: TAB_BAR_H + 160, r };
  }
}

export const BUBBLE = 34;
export const BUBBLE_GAP = 8;
export const PILL_TOP = 6;
