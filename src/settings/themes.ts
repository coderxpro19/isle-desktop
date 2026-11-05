import type { Settings } from "@/lib/types";

export interface Theme {
  id: string;
  name: string;
  surface: string;
  accent: string;
  /** Preview backdrop only. */
  wall: string;
}

export const THEMES: Theme[] = [
  { id: "midnight", name: "Midnight", surface: "#000000", accent: "artwork", wall: "linear-gradient(135deg,#3b4c9b,#9b3b7a)" },
  { id: "graphite", name: "Graphite", surface: "#1c1c1f", accent: "#8e8e93", wall: "linear-gradient(135deg,#55595f,#2a2c30)" },
  { id: "ocean", name: "Ocean", surface: "#04121f", accent: "#3aa0ff", wall: "linear-gradient(135deg,#0b4f8a,#0a2238)" },
  { id: "forest", name: "Forest", surface: "#06140e", accent: "#35c27a", wall: "linear-gradient(135deg,#1d6b47,#0c2a1c)" },
  { id: "sunset", name: "Sunset", surface: "#1a0b0b", accent: "#ff7a45", wall: "linear-gradient(135deg,#ff8a5c,#7b2a5a)" },
  { id: "lilac", name: "Lilac", surface: "#120d1f", accent: "#a68bff", wall: "linear-gradient(135deg,#7f6bd6,#2b1f4d)" },
];

export const ACCENTS = ["#5aa2ff", "#35c27a", "#ffb340", "#ff6b5e", "#ff7ac6", "#a68bff"];

/** Which preset the current appearance matches, if any. */
export function themeOf(a: Settings["appearance"]): string | null {
  return THEMES.find((t) => t.surface.toLowerCase() === a.surface.toLowerCase() && t.accent === a.accent)?.id ?? null;
}

/** Dock glass colour derived from the island surface (pure black reads better slightly lifted). */
export function dockTint(surface: string): string {
  return surface.toLowerCase() === "#000000" ? "#141418" : surface;
}
