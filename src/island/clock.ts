/** Timers, stopwatch and Pomodoro: plain data + pure helpers (tested). */

export interface TimerState {
  duration: number;
  /** Running when set. */
  endsAt: number | null;
  /** Time left while paused. */
  remaining: number;
  label: string;
}

export interface StopwatchState {
  startedAt: number | null;
  /** Time banked from earlier runs. */
  accumulated: number;
  laps: number[];
}

export interface PomodoroState {
  phase: "focus" | "break";
  endsAt: number | null;
  remaining: number;
  /** Completed focus sessions. */
  round: number;
  focusMin: number;
  breakMin: number;
}

export interface ClockState {
  timer: TimerState | null;
  stopwatch: StopwatchState;
  pomodoro: PomodoroState | null;
}

export const EMPTY_CLOCK: ClockState = { timer: null, stopwatch: { startedAt: null, accumulated: 0, laps: [] }, pomodoro: null };

export const left = (t: { endsAt: number | null; remaining: number }, now: number) => (t.endsAt !== null ? Math.max(0, t.endsAt - now) : t.remaining);
export const elapsed = (s: StopwatchState, now: number) => s.accumulated + (s.startedAt !== null ? now - s.startedAt : 0);

export function startTimer(ms: number, now: number, label = "Timer"): TimerState {
  return { duration: ms, endsAt: now + ms, remaining: ms, label };
}
export function pauseTimer(t: TimerState, now: number): TimerState {
  return t.endsAt === null ? t : { ...t, endsAt: null, remaining: left(t, now) };
}
export function resumeTimer(t: TimerState, now: number): TimerState {
  return t.endsAt !== null ? t : { ...t, endsAt: now + t.remaining };
}
export function addToTimer(t: TimerState, ms: number): TimerState {
  return { ...t, duration: t.duration + ms, remaining: t.remaining + ms, endsAt: t.endsAt !== null ? t.endsAt + ms : null };
}

export function toggleStopwatch(s: StopwatchState, now: number): StopwatchState {
  return s.startedAt !== null ? { ...s, startedAt: null, accumulated: elapsed(s, now) } : { ...s, startedAt: now };
}
export function lap(s: StopwatchState, now: number): StopwatchState {
  return { ...s, laps: [elapsed(s, now), ...s.laps].slice(0, 20) };
}

export function startPomodoro(now: number, focusMin = 25, breakMin = 5): PomodoroState {
  return { phase: "focus", endsAt: now + focusMin * 60_000, remaining: focusMin * 60_000, round: 0, focusMin, breakMin };
}
/** Move to the next phase (on completion or "skip"). A long break every 4th. */
export function nextPhase(p: PomodoroState, now: number): PomodoroState {
  if (p.phase === "focus") {
    const round = p.round + 1;
    const ms = (round % 4 === 0 ? p.breakMin * 3 : p.breakMin) * 60_000;
    return { ...p, phase: "break", round, endsAt: now + ms, remaining: ms };
  }
  const ms = p.focusMin * 60_000;
  return { ...p, phase: "focus", endsAt: now + ms, remaining: ms };
}

/** 4:05, 1:02:03 */
export function fmtClock(ms: number, tenths = false): string {
  const total = Math.max(0, ms);
  const s = Math.floor(total / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  const t = tenths ? `.${Math.floor((total % 1000) / 100)}` : "";
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}${t}` : `${m}:${sec}${t}`;
}

/** Timers count down on screen with ceiling seconds (shows 0:01 until it hits zero). */
export function fmtCountdown(ms: number): string {
  return fmtClock(Math.ceil(ms / 1000) * 1000);
}

/** A soft two-note chime (no audio files needed). */
export function chime() {
  try {
    const ctx = new AudioContext();
    const note = (freq: number, at: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.9);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 1);
    };
    note(880, 0);
    note(1318.5, 0.18);
    note(880, 1.1);
    note(1318.5, 1.28);
    setTimeout(() => void ctx.close(), 3000);
  } catch {
    /* audio unavailable */
  }
}
