import { describe, expect, it } from "vitest";
import { formatClock, formatDuration, formatMinutes } from "./format";
import { deriveActivities, pillSize } from "../island/activities";
import type { MediaState } from "./types";

describe("format", () => {
  it("formats durations", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(187_400)).toBe("3:07");
    expect(formatDuration(3_765_000)).toBe("1:02:45");
  });
  it("formats clock", () => {
    const d = new Date(2026, 10, 4, 21, 5, 9);
    expect(formatClock(d, false, false)).toBe("9:05");
    expect(formatClock(d, true, true)).toBe("21:05:09");
    expect(formatClock(d, false, false, true)).toBe("9:05 pm");
    expect(formatClock(new Date(2026, 0, 1, 0, 0), false, false, true)).toBe("12:00 am");
  });
  it("formats minutes", () => {
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(134)).toBe("2h 14m");
  });
});

const media = (playing: boolean) => ({ playing, trackKey: "k" }) as MediaState;

describe("activities", () => {
  const now = 1_000_000;
  it("nothing → no activities", () => {
    expect(deriveActivities({ media: null, pausedAt: null, transient: null }, now)).toEqual([]);
  });
  it("music while playing", () => {
    expect(deriveActivities({ media: media(true), pausedAt: null, transient: null }, now).map((a) => a.kind)).toEqual(["music"]);
  });
  it("paused music lingers, then disappears", () => {
    expect(deriveActivities({ media: media(false), pausedAt: now - 60_000, transient: null }, now)).toHaveLength(1);
    expect(deriveActivities({ media: media(false), pausedAt: now - 10 * 60_000, transient: null }, now)).toHaveLength(0);
  });
  it("transient takes the pill, music becomes a bubble", () => {
    const acts = deriveActivities(
      { media: media(true), pausedAt: null, transient: { kind: "charging", percent: 50, until: now + 1000 } },
      now,
    );
    expect(acts.map((a) => a.kind)).toEqual(["charging", "music"]);
  });
  it("expired transient is ignored", () => {
    const acts = deriveActivities(
      { media: null, pausedAt: null, transient: { kind: "charging", percent: 50, until: now - 1 } },
      now,
    );
    expect(acts).toEqual([]);
  });
  it("sizes grow compact → peek → expanded", () => {
    const c = pillSize("compact", "music", 22), p = pillSize("peek", "music", 22), e = pillSize("expanded", "music", 22);
    expect(c.w < p.w && p.w < e.w).toBe(true);
    expect(c.h < p.h && p.h < e.h).toBe(true);
  });
});
