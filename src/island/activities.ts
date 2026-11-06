import type { CalEvent } from "@/lib/ics";
import type { NotchStyle } from "@/lib/types";
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
export function pillSize(
  mode: Mode,
  primary: ActivityKind | null,
  radius: number,
  tab: Tab = "controls",
  style: NotchStyle = "floating",
  compactMode = true,
): Size {
  const notch = style === "notch";
  if (primary && TRANSIENT_KINDS.includes(primary)) {
    // Transients are wide and short in compact, or take over the peek.
    if (mode === "expanded") return expanded(primary, radius, tab, notch);
    if (primary === "notification") return { w: 380, h: 56, r: notch ? 22 : 28 };
    return primary === "hud" ? { w: 300, h: 36, r: 18 } : { w: 320, h: 36, r: notch ? 16 : 18 };
  }
  const live = primary === "timer" || primary === "pomodoro" || primary === "stopwatch" || primary === "event";
  const music = primary === "music" && (compactMode || !notch);
  switch (mode) {
    case "compact":
      if (notch) return music || live ? { w: 236, h: 30, r: 12 } : { w: 118, h: 30, r: 12 };
      return music || live ? { w: 232, h: 34, r: 17 } : { w: 196, h: 34, r: 17 };
    case "peek":
      if (primary === "music") return { w: 372, h: 60, r: notch ? 22 : 30 };
      if (live) return { w: 340, h: 50, r: notch ? 20 : 25 };
      return notch ? { w: 260, h: 38, r: 16 } : { w: 300, h: 46, r: 23 };
    case "expanded":
      return expanded(primary, radius, tab, notch);
  }
}

/** Height of the status header at the top of the open island. */
export const HEADER_H = 36;
/** @deprecated kept for older components */
export const TAB_BAR_H = HEADER_H;

function expanded(primary: ActivityKind | null, radius: number, tab: Tab, notch: boolean): Size {
  const r = notch ? radius : radius + 14;
  switch (tab) {
    case "controls":
      return { w: 400, h: HEADER_H + 214, r };
    case "weather":
      return { w: 440, h: HEADER_H + 204, r };
    case "stats":
      return { w: 440, h: HEADER_H + 236, r };
    case "clock":
      return { w: 460, h: HEADER_H + 250, r };
    case "notifications":
      return { w: 440, h: HEADER_H + 262, r };
    case "clipboard":
      return { w: 460, h: HEADER_H + 290, r };
    case "assistant":
      return { w: 480, h: HEADER_H + 300, r };
    case "shelf":
      return { w: 460, h: HEADER_H + 218, r };
    case "home":
      return primary === "music" ? { w: 440, h: HEADER_H + 206, r } : { w: 420, h: HEADER_H + 160, r };
  }
}

/** The order the ‹ › arrows walk through. */
export const PAGES: { id: Tab; label: string }[] = [
  { id: "controls", label: "Control Centre" },
  { id: "assistant", label: "Assistant" },
  { id: "home", label: "Now Playing" },
  { id: "clock", label: "Calendar & Timer" },
  { id: "notifications", label: "Notifications" },
  { id: "clipboard", label: "Clipboard" },
  { id: "shelf", label: "Shelf" },
  { id: "weather", label: "Weather" },
  { id: "stats", label: "System" },
];

export function stepPage(tab: Tab, dir: 1 | -1): Tab {
  const i = Math.max(0, PAGES.findIndex((p) => p.id === tab));
  return PAGES[(i + dir + PAGES.length) % PAGES.length]!.id;
}

export function pillTop(style: NotchStyle): number {
  return style === "notch" ? 0 : 6;
}

export const BUBBLE = 34;
export const BUBBLE_GAP = 8;
/** @deprecated use pillTop(style) */
export const PILL_TOP = 6;
