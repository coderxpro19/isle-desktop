import { useState, type ReactNode } from "react";
import type { CalEvent } from "@/lib/ics";
import { useTicker } from "../hooks";
import { useIsland, type ClockView } from "../store";
import {
  EMPTY_CLOCK,
  addToTimer,
  elapsed,
  fmtClock,
  fmtCountdown,
  lap,
  left,
  nextPhase,
  pauseTimer,
  resumeTimer,
  startPomodoro,
  startTimer,
  toggleStopwatch,
  type ClockState,
} from "../clock";
import { useAccent } from "./Contents";

const VIEWS: { id: ClockView; label: string }[] = [
  { id: "timer", label: "Timer" },
  { id: "stopwatch", label: "Stopwatch" },
  { id: "focus", label: "Focus" },
  { id: "calendar", label: "Calendar" },
];
const PRESETS = [1, 3, 5, 10, 15, 25, 45, 60];

const setClock = (f: (c: ClockState) => ClockState) => useIsland.setState((s) => ({ clock: f(s.clock) }));

export function ClockPanel() {
  const view = useIsland((s) => s.clockView);
  return (
    <div className="flex h-full flex-col px-4 pb-3" onClick={(e) => e.stopPropagation()}>
      <div className="mx-auto mb-2.5 flex rounded-full bg-white/8 p-0.5 text-[11.5px] font-medium">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => useIsland.setState({ clockView: v.id })}
            className={`rounded-full px-3 py-1 transition-colors ${view === v.id ? "bg-white/16 text-white" : "text-white/50 hover:text-white/80"}`}
          >
            {v.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {view === "timer" && <TimerView />}
        {view === "stopwatch" && <StopwatchView />}
        {view === "focus" && <FocusView />}
        {view === "calendar" && <CalendarView />}
      </div>
    </div>
  );
}

/* ───────────── shared ───────────── */

function Ring({ progress, size = 132, children }: { progress: number; size?: number; children: ReactNode }) {
  const accent = useAccent();
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth={6} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={accent}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(0, Math.min(1, progress)))}
          style={{ transition: "stroke-dashoffset .25s linear" }}
        />
      </svg>
      <div className="relative text-center">{children}</div>
    </div>
  );
}

function Btn({ children, onClick, primary, wide }: { children: ReactNode; onClick: () => void; primary?: boolean; wide?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 rounded-full px-3.5 text-[12px] font-semibold transition-colors ${wide ? "min-w-[88px]" : ""} ${
        primary ? "bg-white text-black hover:bg-white/85" : "bg-white/10 text-white/85 hover:bg-white/18"
      }`}
    >
      {children}
    </button>
  );
}

/* ───────────── timer ───────────── */

function TimerView() {
  const t = useIsland((s) => s.clock.timer);
  const now = useTicker(!!t?.endsAt);
  const [custom, setCustom] = useState("");

  if (!t) {
    const startMin = (m: number) => m > 0 && setClock((c) => ({ ...c, timer: startTimer(m * 60_000, Date.now(), `${m} min timer`) }));
    return (
      <div className="flex h-full flex-col justify-center gap-3">
        <div className="grid grid-cols-4 gap-2">
          {PRESETS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => startMin(m)}
              className="h-11 rounded-2xl bg-white/8 text-[13px] font-semibold text-white/90 transition-colors hover:bg-white/16"
            >
              {m < 60 ? `${m} min` : "1 hr"}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            startMin(Math.min(24 * 60, Math.round(parseFloat(custom) || 0)));
            setCustom("");
          }}
        >
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="Custom minutes"
            inputMode="numeric"
            className="h-8 min-w-0 flex-1 rounded-full bg-white/8 px-3.5 text-[12px] text-white outline-none placeholder:text-white/35 focus:bg-white/12"
          />
          <button type="submit" className="h-8 rounded-full bg-white px-3.5 text-[12px] font-semibold text-black hover:bg-white/85">
            Start
          </button>
        </form>
      </div>
    );
  }

  const ms = left(t, now);
  return (
    <div className="flex h-full items-center justify-center gap-7">
      <Ring progress={ms / t.duration}>
        <div className="text-[30px] font-semibold tabular-nums leading-none text-white">{fmtCountdown(ms)}</div>
        <div className="mt-1.5 text-[11px] text-white/50">{t.endsAt ? "remaining" : "paused"}</div>
      </Ring>
      <div className="flex flex-col gap-2">
        <Btn primary wide onClick={() => setClock((c) => ({ ...c, timer: c.timer && (c.timer.endsAt ? pauseTimer(c.timer, Date.now()) : resumeTimer(c.timer, Date.now())) }))}>
          {t.endsAt ? "Pause" : "Resume"}
        </Btn>
        <Btn wide onClick={() => setClock((c) => ({ ...c, timer: c.timer && addToTimer(c.timer, 60_000) }))}>
          +1 min
        </Btn>
        <Btn wide onClick={() => setClock((c) => ({ ...c, timer: null }))}>
          Cancel
        </Btn>
      </div>
    </div>
  );
}

/* ───────────── stopwatch ───────────── */

function StopwatchView() {
  const sw = useIsland((s) => s.clock.stopwatch);
  const running = sw.startedAt !== null;
  const now = useTicker(running, 50);
  const total = elapsed(sw, now);
  return (
    <div className="flex h-full gap-5">
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <div className="text-[40px] font-semibold tabular-nums leading-none text-white">{fmtClock(total, true)}</div>
        <div className="flex gap-2">
          <Btn primary wide onClick={() => setClock((c) => ({ ...c, stopwatch: toggleStopwatch(c.stopwatch, Date.now()) }))}>
            {running ? "Stop" : total ? "Resume" : "Start"}
          </Btn>
          {running ? (
            <Btn wide onClick={() => setClock((c) => ({ ...c, stopwatch: lap(c.stopwatch, Date.now()) }))}>
              Lap
            </Btn>
          ) : (
            total > 0 && (
              <Btn wide onClick={() => setClock((c) => ({ ...c, stopwatch: EMPTY_CLOCK.stopwatch }))}>
                Reset
              </Btn>
            )
          )}
        </div>
      </div>
      {sw.laps.length > 0 && (
        <ol className="isle-scroll w-[132px] overflow-y-auto text-[12px] tabular-nums">
          {sw.laps.map((t, i) => {
            const prev = sw.laps[i + 1] ?? 0;
            return (
              <li key={sw.laps.length - i} className="flex justify-between border-b border-white/6 py-1.5 text-white/75">
                <span className="text-white/40">Lap {sw.laps.length - i}</span>
                <span>{fmtClock(t - prev, true)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/* ───────────── focus (Pomodoro) ───────────── */

function FocusView() {
  const p = useIsland((s) => s.clock.pomodoro);
  const now = useTicker(!!p?.endsAt);

  if (!p) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <div className="text-[13px] text-white/60">Work in focused blocks with short breaks.</div>
        <div className="flex gap-2">
          {[
            [25, 5],
            [50, 10],
            [90, 15],
          ].map(([f, b]) => (
            <button
              key={f}
              type="button"
              onClick={() => setClock((c) => ({ ...c, pomodoro: startPomodoro(Date.now(), f, b) }))}
              className="rounded-2xl bg-white/8 px-4 py-2.5 text-left transition-colors hover:bg-white/16"
            >
              <div className="text-[14px] font-semibold text-white">{f} min</div>
              <div className="text-[11px] text-white/45">{b} min breaks</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const ms = left(p, now);
  const total = (p.phase === "focus" ? p.focusMin : p.round % 4 === 0 ? p.breakMin * 3 : p.breakMin) * 60_000;
  return (
    <div className="flex h-full items-center justify-center gap-7">
      <Ring progress={ms / total}>
        <div className={`text-[11px] font-semibold uppercase tracking-wider ${p.phase === "focus" ? "text-[#ff8a7a]" : "text-ok"}`}>
          {p.phase === "focus" ? "Focus" : "Break"}
        </div>
        <div className="mt-1 text-[28px] font-semibold tabular-nums leading-none text-white">{fmtCountdown(ms)}</div>
        <div className="mt-1.5 text-[11px] text-white/45">{p.round} done</div>
      </Ring>
      <div className="flex flex-col gap-2">
        <Btn
          primary
          wide
          onClick={() =>
            setClock((c) => {
              const q = c.pomodoro;
              if (!q) return c;
              const t = Date.now();
              return { ...c, pomodoro: q.endsAt ? { ...q, endsAt: null, remaining: left(q, t) } : { ...q, endsAt: t + q.remaining } };
            })
          }
        >
          {p.endsAt ? "Pause" : "Resume"}
        </Btn>
        <Btn wide onClick={() => setClock((c) => ({ ...c, pomodoro: c.pomodoro && nextPhase(c.pomodoro, Date.now()) }))}>
          Skip
        </Btn>
        <Btn wide onClick={() => setClock((c) => ({ ...c, pomodoro: null }))}>
          End
        </Btn>
      </div>
    </div>
  );
}

/* ───────────── calendar ───────────── */

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const fmtTime = (t: number, h24: boolean) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: !h24 });

export function eventWhen(e: CalEvent, now: number, h24: boolean): string {
  if (e.allDay) return "All day";
  if (e.start <= now) return e.end > now ? `Now · until ${fmtTime(e.end, h24)}` : fmtTime(e.start, h24);
  const mins = Math.round((e.start - now) / 60_000);
  if (mins < 60) return `in ${Math.max(1, mins)} min`;
  return fmtTime(e.start, h24);
}

function CalendarView() {
  const events = useIsland((s) => s.events);
  const feeds = useIsland((s) => s.settings.calendar.feeds);
  const error = useIsland((s) => s.calendarError);
  const h24 = useIsland((s) => s.settings.island.clock24h);
  const nowTick = useIsland((s) => s.now).getTime();
  const [selected, setSelected] = useState(() => new Date());
  const [adding, setAdding] = useState(false);

  const today = new Date(nowTick);
  const month = new Date(selected.getFullYear(), selected.getMonth(), 1);
  const lead = (month.getDay() + 6) % 7; // Monday first
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, i) => i - lead + 1);
  const hasEvents = (d: number) => {
    const s = new Date(month.getFullYear(), month.getMonth(), d).getTime();
    return events.some((e) => e.start < s + 86400_000 && e.end > s);
  };
  const dayStart = new Date(selected.getFullYear(), selected.getMonth(), selected.getDate()).getTime();
  const isToday = sameDay(selected, today);
  const list = events
    .filter((e) => e.start < dayStart + 86400_000 && e.end > (isToday ? nowTick : dayStart))
    .slice(0, 8);

  if (adding || !feeds.length) return <FeedEditor onDone={() => setAdding(false)} canClose={feeds.length > 0} />;

  return (
    <div className="flex h-full gap-4">
      <div className="w-[176px] shrink-0">
        <div className="mb-1 flex items-center justify-between text-[12px] font-semibold text-white/85">
          <button type="button" className="px-1.5 text-white/45 hover:text-white" onClick={() => setSelected(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">
            ‹
          </button>
          {month.toLocaleDateString([], { month: "long", year: "numeric" })}
          <button type="button" className="px-1.5 text-white/45 hover:text-white" onClick={() => setSelected(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">
            ›
          </button>
        </div>
        <div className="grid grid-cols-7 text-center text-[10.5px] tabular-nums">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <div key={i} className="py-0.5 text-white/35">
              {d}
            </div>
          ))}
          {cells.map((d, i) => {
            if (d < 1 || d > days) return <div key={i} />;
            const date = new Date(month.getFullYear(), month.getMonth(), d);
            const sel = sameDay(date, selected);
            const tdy = sameDay(date, today);
            return (
              <button
                key={i}
                type="button"
                onClick={() => setSelected(date)}
                className={`relative mx-auto grid h-[22px] w-[22px] place-items-center rounded-full ${
                  sel ? "bg-white text-black" : tdy ? "text-[#ff6b5e] font-bold" : "text-white/80 hover:bg-white/10"
                }`}
              >
                {d}
                {hasEvents(d) && !sel && <span className="absolute bottom-[1px] h-[3px] w-[3px] rounded-full bg-white/55" />}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[12px] font-semibold text-white/85">
            {isToday ? "Up next today" : selected.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })}
          </span>
          <button type="button" onClick={() => setAdding(true)} className="text-[11px] text-white/45 hover:text-white">
            Calendars
          </button>
        </div>
        <div className="isle-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto">
          {list.length === 0 && <div className="pt-6 text-center text-[12px] text-white/40">{error ?? "Nothing scheduled"}</div>}
          {list.map((e) => (
            <EventRow key={e.id} e={e} now={nowTick} h24={h24} />
          ))}
        </div>
      </div>
    </div>
  );
}

function EventRow({ e, now, h24 }: { e: CalEvent; now: number; h24: boolean }) {
  const color = useIsland((s) => s.settings.calendar.feeds.find((f) => f.url === e.feed)?.color) ?? "#5aa2ff";
  return (
    <div className="flex gap-2.5 rounded-xl bg-white/6 px-2.5 py-1.5">
      <span className="w-[3px] shrink-0 rounded-full" style={{ background: color }} />
      <div className="min-w-0">
        <div className="truncate text-[12.5px] font-medium text-white">{e.title}</div>
        <div className="truncate text-[11px] text-white/50">
          {eventWhen(e, now, h24)}
          {e.location ? ` · ${e.location}` : ""}
        </div>
      </div>
    </div>
  );
}

const COLORS = ["#5aa2ff", "#ff6b5e", "#4cd97b", "#ffb340", "#a597ff", "#ff7ac6"];

function FeedEditor({ onDone, canClose }: { onDone: () => void; canClose: boolean }) {
  const feeds = useIsland((s) => s.settings.calendar.feeds);
  const updateSettings = useIsland((s) => s.updateSettings);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const valid = /^(https?|webcal):\/\/\S+$/i.test(url.trim());
  const save = (next: typeof feeds) => updateSettings((s) => ({ ...s, calendar: { ...s.calendar, feeds: next } }));

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-white/85">Calendars</span>
        {canClose && (
          <button type="button" onClick={onDone} className="text-[11px] text-white/45 hover:text-white">
            Done
          </button>
        )}
      </div>
      <div className="isle-scroll min-h-0 flex-1 space-y-1 overflow-y-auto">
        {feeds.length === 0 && (
          <div className="text-[11.5px] leading-snug text-white/50">
            Paste a calendar's iCal link. Google Calendar: Settings → your calendar → “Secret address in iCal format”. Outlook: Settings → Shared calendars →
            Publish → ICS.
          </div>
        )}
        {feeds.map((f) => (
          <div key={f.url} className="flex items-center gap-2 rounded-xl bg-white/6 px-2.5 py-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: f.color }} />
            <span className="min-w-0 flex-1 truncate text-[12px] text-white/85">{f.name}</span>
            <button type="button" onClick={() => save(feeds.filter((x) => x.url !== f.url))} className="text-[11px] text-white/40 hover:text-danger">
              Remove
            </button>
          </div>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid || feeds.some((f) => f.url === url.trim())) return;
          save([...feeds, { url: url.trim(), name: name.trim() || `Calendar ${feeds.length + 1}`, color: COLORS[feeds.length % COLORS.length]! }]);
          setUrl("");
          setName("");
          onDone();
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="h-8 w-[90px] rounded-full bg-white/8 px-3 text-[12px] text-white outline-none placeholder:text-white/35 focus:bg-white/12" />
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… .ics link" className="h-8 min-w-0 flex-1 rounded-full bg-white/8 px-3 text-[12px] text-white outline-none placeholder:text-white/35 focus:bg-white/12" />
        <button type="submit" disabled={!valid} className="h-8 rounded-full bg-white px-3.5 text-[12px] font-semibold text-black disabled:opacity-30">
          Add
        </button>
      </form>
    </div>
  );
}
