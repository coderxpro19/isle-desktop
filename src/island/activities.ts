import type { CalEvent } from "@/lib/ics";
import type { IslandState, Mode, Tab, Transient } from "./store";
import { PAUSED_LINGER_MS } from "./store";

/**
 * Live activities. The highest-priority one owns the pill; the rest render as
 * bubbles beside it (like two activities on an iPhone). Later phases add
 * timers, downloads, calls, etc. by extending `ActivityKind` and `derive`.
 */
export type ActivityKind =
  | "music"
  | "charging"
  | "lowBattery"
  | "update"
  | "hud"
  | "timerDone"
  | "timer"
  | "pomodoro"
  | "stopwatch"
  | "event"
  | "notification";

/** Transient alerts: short, wide, and they take the pill. */
export const TRANSIENT_KINDS: ActivityKind[] = ["charging", "lowBattery", "update", "hud", "timerDone", "notification"];
/** Activities whose detail lives on the Clock tab. */
export const CLOCK_KINDS: ActivityKind[] = ["timer", "pomodoro", "stopwatch", "event", "timerDone"];

/** An event is "now" from 10 min before it starts until 5 min after. */
export function upcomingEvent(events: CalEvent[], now: number): CalEvent | null {
  return events.find((e) => !e.allDay && e.start - now <= 10 * 60_000 && now - e.start <= 5 * 60_000) ?? null;
}

export interface Activity {
  id: string;
  kind: ActivityKind;
  priority: number;
}

export function deriveActivities(
  s: Pick<IslandState, "media" | "pausedAt" | "transient"> & Partial<Pick<IslandState, "clock" | "events">>,
  now: number,
): Activity[] {
  const out: Activity[] = [];
  const t: Transient | null = s.transient && s.transient.until > now ? s.transient : null;
  if (t) out.push({ id: t.kind, kind: t.kind, priority: t.kind === "hud" ? 110 : 100 });
  if (s.clock?.timer) out.push({ id: "timer", kind: "timer", priority: 60 });
  if (s.clock?.pomodoro) out.push({ id: "pomodoro", kind: "pomodoro", priority: 58 });
  if (s.events && upcomingEvent(s.events, now)) out.push({ id: "event", kind: "event", priority: 55 });
  if (s.clock?.stopwatch.startedAt != null) out.push({ id: "stopwatch", kind: "stopwatch", priority: 45 });
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
  if (primary && TRANSIENT_KINDS.includes(primary)) {
    // Transients are wide and short in compact, or take over the peek.
    if (mode === "expanded") return expanded(primary, radius, tab);
    if (primary === "notification") return { w: 380, h: 56, r: 28 };
    return primary === "hud" ? { w: 300, h: 36, r: 18 } : { w: 320, h: 36, r: 18 };
  }
  const live = primary === "timer" || primary === "pomodoro" || primary === "stopwatch" || primary === "event";
  switch (mode) {
    case "compact":
      return primary === "music" || live ? { w: 232, h: 34, r: 17 } : { w: 196, h: 34, r: 17 };
    case "peek":
      return primary === "music" ? { w: 372, h: 58, r: 29 } : live ? { w: 340, h: 52, r: 26 } : { w: 300, h: 46, r: 23 };
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
    case "clock":
      return { w: 460, h: TAB_BAR_H + 250, r };
    case "notifications":
      return { w: 440, h: TAB_BAR_H + 262, r };
    case "clipboard":
      return { w: 460, h: TAB_BAR_H + 290, r };
    case "shelf":
      return { w: 460, h: TAB_BAR_H + 218, r };
    case "home":
      return primary === "music" ? { w: 440, h: TAB_BAR_H + 206, r } : { w: 420, h: TAB_BAR_H + 160, r };
  }
}

export const BUBBLE = 34;
export const BUBBLE_GAP = 8;
export const PILL_TOP = 6;
