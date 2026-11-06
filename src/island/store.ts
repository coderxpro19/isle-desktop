import { create } from "zustand";
import type { Backend } from "@/lib/backend";
import type { AiMsg, BatteryState, Clip, ControlsState, FileInfo, Hud, MediaState, Notice, NoticeState, PairingPrompt, Settings, StatsTick, UpdateInfo, Weather } from "@/lib/types";
import type { CalEvent } from "@/lib/ics";
import { EMPTY_CLOCK, type ClockState } from "./clock";
import { DEFAULT_SETTINGS } from "@/lib/types";

export type Mode = "compact" | "peek" | "expanded";

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  | { kind: "available"; info: UpdateInfo }
  | { kind: "installing"; info: UpdateInfo; progress: number | null }
  | { kind: "error"; message: string; info?: UpdateInfo };
export type Tab = "home" | "controls" | "assistant" | "clock" | "clipboard" | "notifications" | "shelf" | "weather" | "stats";
export type ShelfItem = FileInfo & { thumb?: string | null };
export type ClockView = "timer" | "stopwatch" | "focus" | "calendar";
/** Sub-page inside the Controls tab. */
export type ControlsView = "main" | "wifi" | "bluetooth" | "tray";

/** How many seconds of stats history the sparklines keep. */
export const STATS_HISTORY = 60;

/** Short-lived, attention-grabbing states (iPhone-style "alerts"). */
export type Transient =
  | { kind: "charging"; percent: number | null; until: number }
  | { kind: "lowBattery"; percent: number; until: number }
  | { kind: "update"; version: string; until: number }
  | { kind: "hud"; hud: Hud; until: number }
  | { kind: "timerDone"; label: string; until: number }
  | { kind: "notification"; notice: Notice; until: number };

export interface IslandState {
  backend: Backend | null;
  settings: Settings;
  battery: BatteryState | null;
  media: MediaState | null;
  /** Wall-clock ms when playback last went from playing → paused. */
  pausedAt: number | null;
  artworks: Record<string, string>;
  /** Accent colour extracted from each artwork, keyed like `artworks`. */
  accents: Record<string, string>;
  mode: Mode;
  hovered: boolean;
  transient: Transient | null;
  /** Shared clock, ticked on second/minute boundaries by `useClockTicker`. */
  now: Date;
  /** Which panel the expanded island shows. */
  tab: Tab;
  /**
   * Keeps the island expanded regardless of hover (slider drags, text input).
   * A counter so overlapping holds don't release each other.
   */
  pins: number;
  controls: ControlsState | null;
  stats: StatsTick[];
  weather: Weather | null;
  weatherError: string | null;
  controlsView: ControlsView;
  btPrompt: PairingPrompt | null;
  update: UpdateState;
  /** Right-click menu open. */
  islandMenu: boolean;
  clock: ClockState;
  clockView: ClockView;
  events: CalEvent[];
  calendarError: string | null;
  notices: NoticeState;
  shelf: ShelfItem[];
  /** Files are being dragged over the island. */
  dropping: boolean;
  clips: Clip[];
  aiMessages: AiMsg[];
  aiBusy: boolean;
  aiError: string | null;
  /** Opened with Alt+Shift+V: stays open until Esc, a paste or focus loss. */
  summoned: boolean;

  setMode(mode: Mode): void;
  setTab(tab: Tab): void;
  pin(): () => void;
  pushStats(t: StatsTick): void;
  updateSettings(f: (s: Settings) => Settings): void;
  setHovered(h: boolean): void;
  applyBattery(b: BatteryState): void;
  applyMedia(m: MediaState | null): void;
}

export const useIsland = create<IslandState>((set, get) => ({
  backend: null,
  settings: DEFAULT_SETTINGS,
  battery: null,
  media: null,
  pausedAt: null,
  artworks: {},
  accents: {},
  mode: "compact",
  hovered: false,
  transient: null,
  now: new Date(),
  tab: "controls",
  pins: 0,
  controls: null,
  stats: [],
  weather: null,
  weatherError: null,
  controlsView: "main",
  btPrompt: null,
  update: { kind: "idle" },
  islandMenu: false,
  notices: { access: "unknown", items: [] },
  shelf: [],
  dropping: false,
  clips: [],
  aiMessages: [],
  aiBusy: false,
  aiError: null,
  summoned: false,
  clock: EMPTY_CLOCK,
  clockView: "timer",
  events: [],
  calendarError: null,

  // Collapsing resets to the home tab, like iOS widgets do.
  setMode: (mode) =>
    set(
      mode === "compact"
        ? { mode, controlsView: "main", islandMenu: false, ...(get().settings.island.rememberPanel ? {} : { tab: "controls" as Tab }) }
        : { mode },
    ),
  setTab: (tab) => set({ tab, controlsView: "main" }),
  pin() {
    set((s) => ({ pins: s.pins + 1 }));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      set((s) => ({ pins: Math.max(0, s.pins - 1) }));
    };
  },
  pushStats: (t) => set((s) => ({ stats: [...s.stats.slice(-(STATS_HISTORY - 1)), t] })),
  updateSettings(f) {
    const next = f(get().settings);
    set({ settings: next });
    void get().backend?.setSettings(next);
  },
  setHovered: (hovered) => set({ hovered }),

  applyBattery(next) {
    const prev = get().battery;
    const { chargingActivity, focusMode } = get().settings.island;
    let transient = get().transient;
    if (prev && next.hasBattery && chargingActivity && !focusMode) {
      if (!prev.charging && next.charging) {
        transient = { kind: "charging", percent: next.percent, until: Date.now() + 3200 };
      } else if (!next.charging && next.percent !== null && prev.percent !== null) {
        const crossed = [20, 10, 5].find((t) => prev.percent! > t && next.percent! <= t);
        if (crossed !== undefined) transient = { kind: "lowBattery", percent: next.percent, until: Date.now() + 4000 };
      }
    }
    set({ battery: next, transient });
  },

  applyMedia(next) {
    const prev = get().media;
    let pausedAt = get().pausedAt;
    if (next?.playing) pausedAt = null;
    else if (next && (prev?.playing || pausedAt === null)) pausedAt = Date.now();
    set({ media: next, pausedAt });
  },
}));

/** How long a paused track keeps its live activity before the island goes back to idle. */
export const PAUSED_LINGER_MS = 3 * 60_000;
