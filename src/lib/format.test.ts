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

import { formatBytes, formatUptime } from "./format";
import { describe as describeWeather, parseForecast } from "./weather";

describe("bytes", () => {
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(16 * 1024 ** 3)).toBe("16.0 GB");
    expect(formatBytes(476 * 1024 ** 3)).toBe("476 GB");
  });
  it("formats uptime", () => {
    expect(formatUptime(59)).toBe("0m");
    expect(formatUptime(3 * 3600 + 5 * 60)).toBe("3h 5m");
    expect(formatUptime(2 * 86400 + 7200)).toBe("2d 2h");
  });
});

describe("weather", () => {
  it("maps WMO codes", () => {
    expect(describeWeather(0).kind).toBe("clear");
    expect(describeWeather(2).kind).toBe("partly");
    expect(describeWeather(63).kind).toBe("rain");
    expect(describeWeather(81).label).toBe("Showers");
    expect(describeWeather(75).kind).toBe("snow");
    expect(describeWeather(95).kind).toBe("storm");
  });
  it("parses the forecast and starts hourly after now", () => {
    const hours = Array.from({ length: 48 }, (_, i) => `2026-11-0${5 + Math.floor(i / 24)}T${String(i % 24).padStart(2, "0")}:00`);
    const w = parseForecast(
      {
        current: { time: "2026-11-05T14:15", temperature_2m: 29.4, apparent_temperature: 33, weather_code: 2, is_day: 1 },
        hourly: { time: hours, temperature_2m: hours.map((_, i) => i), weather_code: hours.map(() => 1), is_day: hours.map(() => 1) },
        daily: { temperature_2m_max: [31, 30], temperature_2m_min: [24, 23], precipitation_probability_max: [40, 10] },
      },
      123,
    );
    expect(w.hourly[0]!.time).toBe("2026-11-05T15:00");
    expect(w.hourly).toHaveLength(6);
    expect(w).toMatchObject({ temp: 29.4, high: 31, low: 24, precipChance: 40, isDay: true, fetchedAt: 123 });
  });
});
