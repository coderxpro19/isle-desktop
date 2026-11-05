import { describe, expect, it } from "vitest";
import { addToTimer, elapsed, fmtClock, fmtCountdown, lap, left, nextPhase, pauseTimer, resumeTimer, startPomodoro, startTimer, toggleStopwatch } from "./clock";
import { EMPTY_CLOCK } from "./clock";

describe("timer", () => {
  it("counts down, pauses and resumes", () => {
    let t = startTimer(60_000, 0);
    expect(left(t, 10_000)).toBe(50_000);
    t = pauseTimer(t, 10_000);
    expect(left(t, 99_000)).toBe(50_000);
    t = resumeTimer(t, 100_000);
    expect(left(t, 120_000)).toBe(30_000);
    t = addToTimer(t, 60_000);
    expect(left(t, 120_000)).toBe(90_000);
    expect(left(t, 1e9)).toBe(0);
  });
  it("formats", () => {
    expect(fmtClock(65_000)).toBe("1:05");
    expect(fmtClock(3_723_400, true)).toBe("1:02:03.4");
    expect(fmtCountdown(400)).toBe("0:01");
    expect(fmtCountdown(0)).toBe("0:00");
  });
});

describe("stopwatch", () => {
  it("accumulates across runs and laps", () => {
    let s = toggleStopwatch(EMPTY_CLOCK.stopwatch, 1000);
    expect(elapsed(s, 3000)).toBe(2000);
    s = toggleStopwatch(s, 3000);
    expect(elapsed(s, 9000)).toBe(2000);
    s = toggleStopwatch(s, 10_000);
    s = lap(s, 11_000);
    expect(s.laps).toEqual([3000]);
  });
});

describe("pomodoro", () => {
  it("alternates focus/break with a long break every 4th", () => {
    let p = startPomodoro(0, 25, 5);
    for (let i = 1; i <= 4; i++) {
      p = nextPhase(p, 0);
      expect(p.phase).toBe("break");
      expect(p.remaining).toBe(i === 4 ? 15 * 60_000 : 5 * 60_000);
      p = nextPhase(p, 0);
      expect(p.phase).toBe("focus");
    }
    expect(p.round).toBe(4);
  });
});
