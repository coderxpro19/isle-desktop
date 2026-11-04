import { create } from "zustand";
import type { Backend } from "@/lib/backend";
import type { BatteryState, MediaState, Settings } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";

export type Mode = "compact" | "peek" | "expanded";

/** Short-lived, attention-grabbing states (iPhone-style "alerts"). */
export type Transient =
  | { kind: "charging"; percent: number | null; until: number }
  | { kind: "lowBattery"; percent: number; until: number };

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

  setMode(mode: Mode): void;
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

  setMode: (mode) => set({ mode }),
  setHovered: (hovered) => set({ hovered }),

  applyBattery(next) {
    const prev = get().battery;
    const { chargingActivity } = get().settings.island;
    let transient = get().transient;
    if (prev && next.hasBattery && chargingActivity) {
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
