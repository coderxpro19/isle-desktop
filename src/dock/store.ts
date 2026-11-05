import { create } from "zustand";
import type { Backend } from "@/lib/backend";
import type { DockApp, Settings } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";

export interface Popup {
  key: string;
  /** Centre x of the icon it belongs to (px, dock-window coordinates). */
  x: number;
}

export interface DockState {
  backend: Backend | null;
  settings: Settings;
  apps: DockApp[];
  icons: Record<string, string | null>;
  /** Cursor is over the dock (reported by the native hit tester). */
  hovered: boolean;
  /** A window reaches into the dock area (smart mode). */
  overlap: boolean;
  menu: Popup | null;
  preview: Popup | null;
  /** Apps we've launched and are waiting to see a window for → bounce. */
  launching: Record<string, number>;
  recycleItems: number;

  loadIcon(key: string): void;
}

export const useDock = create<DockState>((set, get) => ({
  backend: null,
  settings: DEFAULT_SETTINGS,
  apps: [],
  icons: {},
  hovered: false,
  overlap: false,
  menu: null,
  preview: null,
  launching: {},
  recycleItems: 0,

  loadIcon(key) {
    const { icons, backend } = get();
    if (key in icons || !backend) return;
    set((s) => ({ icons: { ...s.icons, [key]: null } }));
    void backend.dockIcon(key).then((url) => set((s) => ({ icons: { ...s.icons, [key]: url } })));
  },
}));

/** Magnification curve: scale for an icon whose centre is `d` px from the cursor. */
export function magnify(d: number, iconSize: number, max = 1.55): number {
  const sigma = iconSize * 1.15;
  return 1 + (max - 1) * Math.exp(-(d * d) / (2 * sigma * sigma));
}

/** Dock visibility rule for the three modes. */
export function dockVisible(mode: Settings["dock"]["mode"], s: { hovered: boolean; overlap: boolean; popupOpen: boolean }): boolean {
  if (s.hovered || s.popupOpen) return true;
  if (mode === "fixed") return true;
  if (mode === "smart") return !s.overlap;
  return false;
}
