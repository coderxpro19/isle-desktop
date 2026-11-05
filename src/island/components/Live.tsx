import type { ReactNode } from "react";
import type { ActivityKind } from "../activities";
import { upcomingEvent } from "../activities";
import { elapsed, fmtClock, fmtCountdown, left } from "../clock";
import { useTicker } from "../hooks";
import { useIsland } from "../store";
import { eventWhen } from "./ClockPanel";
import { NoticeIcon } from "./NotificationsPanel";
import { useAccent } from "./Contents";
import { BellIcon, CalendarIcon, FlagIcon, SpeakerIcon, SunIcon, TimerIcon } from "./icons";

export const LIVE_KINDS: ActivityKind[] = ["hud", "notification", "timerDone", "timer", "pomodoro", "stopwatch", "event"];

function Row({ children, pad = 14 }: { children: ReactNode; pad?: number }) {
  return (
    <div className="flex h-full items-center justify-between gap-3" style={{ paddingInline: pad }}>
      {children}
    </div>
  );
}

/** Volume / brightness pop-up (replaces the Windows flyout). */
function HudBar() {
  const t = useIsland((s) => s.transient);
  const accent = useAccent();
  if (t?.kind !== "hud") return null;
  const h = t.hud;
  const level = h.kind === "volume" && h.muted ? 0 : h.level;
  return (
    <Row>
      <span className="text-white/90">
        {h.kind === "volume" ? <SpeakerIcon size={17} muted={h.muted} level={h.level} /> : <SunIcon size={17} />}
      </span>
      <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-white/15">
        <div className="h-full rounded-full transition-[width] duration-100" style={{ width: `${level * 100}%`, background: h.kind === "volume" ? accent : "#ffd25a" }} />
      </div>
      <span className="w-[30px] text-right text-[12px] font-semibold tabular-nums text-white/80">{h.kind === "volume" && h.muted ? "Off" : Math.round(level * 100)}</span>
    </Row>
  );
}

/** Live clock-ish activities in compact (big=false) or peek (big=true) size. */
export function LiveContent({ kind, big = false }: { kind: ActivityKind; big?: boolean }) {
  const clock = useIsland((s) => s.clock);
  const events = useIsland((s) => s.events);
  const transient = useIsland((s) => s.transient);
  const h24 = useIsland((s) => s.settings.island.clock24h);
  const running = kind === "stopwatch" || kind === "timer" || kind === "pomodoro" || kind === "event";
  const now = useTicker(running, kind === "stopwatch" ? 100 : 500);
  const accent = useAccent();
  const text = big ? "text-[15px]" : "text-[13px]";
  const sub = big ? "text-[12.5px]" : "text-[12px]";

  if (kind === "hud") return <HudBar />;

  if (kind === "notification" && transient?.kind === "notification") {
    const n = transient.notice;
    return (
      <div className="flex h-full items-center gap-2.5 pr-5 pl-3">
        <NoticeIcon n={n} size={32} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-[12.5px] font-semibold text-white">{n.title || n.app}</span>
            {n.title && <span className="shrink-0 text-[11px] text-white/40">{n.app}</span>}
          </div>
          <div className="truncate text-[12px] text-white/65">{n.body}</div>
        </div>
      </div>
    );
  }

  if (kind === "timerDone" && transient?.kind === "timerDone") {
    return (
      <Row>
        <span className={`flex items-center gap-2 ${text} font-semibold`} style={{ color: accent }}>
          <TimerIcon size={15} />
          Time's up
        </span>
        <span className={`truncate ${sub} font-medium text-white/70`}>{transient.label}</span>
      </Row>
    );
  }

  if (kind === "timer" && clock.timer) {
    const ms = left(clock.timer, now);
    return (
      <Row pad={big ? 18 : 14}>
        <span className={`flex items-center gap-1.5 ${sub} font-medium text-white/60`}>
          <TimerIcon size={14} style={{ color: accent }} />
          {big ? clock.timer.label : clock.timer.endsAt ? "Timer" : "Paused"}
        </span>
        <span className={`${text} font-semibold tabular-nums text-white`} style={{ color: clock.timer.endsAt ? undefined : "rgba(255,255,255,.5)" }}>
          {fmtCountdown(ms)}
        </span>
      </Row>
    );
  }

  if (kind === "pomodoro" && clock.pomodoro) {
    const p = clock.pomodoro;
    const focus = p.phase === "focus";
    return (
      <Row pad={big ? 18 : 14}>
        <span className={`flex items-center gap-1.5 ${sub} font-semibold`} style={{ color: focus ? "#ff8a7a" : "var(--color-ok)" }}>
          <span className="h-2 w-2 rounded-full" style={{ background: "currentColor" }} />
          {focus ? "Focus" : "Break"}
          {big && <span className="font-medium text-white/45"> · round {p.round + (focus ? 1 : 0)}</span>}
        </span>
        <span className={`${text} font-semibold tabular-nums text-white`}>{fmtCountdown(left(p, now))}</span>
      </Row>
    );
  }

  if (kind === "stopwatch") {
    return (
      <Row pad={big ? 18 : 14}>
        <span className={`flex items-center gap-1.5 ${sub} font-medium text-white/60`}>
          <FlagIcon size={14} style={{ color: accent }} />
          Stopwatch
        </span>
        <span className={`${text} font-semibold tabular-nums text-white`}>{fmtClock(elapsed(clock.stopwatch, now), true)}</span>
      </Row>
    );
  }

  if (kind === "event") {
    const e = upcomingEvent(events, now);
    if (!e) return null;
    return (
      <Row pad={big ? 18 : 14}>
        <span className="flex min-w-0 items-center gap-1.5">
          <CalendarIcon size={14} className="shrink-0 text-[#ff6b5e]" />
          <span className={`truncate ${sub} font-semibold text-white`}>{e.title}</span>
        </span>
        <span className={`shrink-0 ${sub} font-medium tabular-nums text-white/60`}>{eventWhen(e, now, h24)}</span>
      </Row>
    );
  }
  return null;
}

/** Small round bubble icon for a secondary live activity. */
export function LiveBubbleIcon({ kind }: { kind: ActivityKind }) {
  const accent = useAccent();
  switch (kind) {
    case "timer":
    case "timerDone":
      return <TimerIcon size={15} style={{ color: accent }} />;
    case "pomodoro":
      return <span className="h-2.5 w-2.5 rounded-full bg-[#ff8a7a]" />;
    case "stopwatch":
      return <FlagIcon size={15} style={{ color: accent }} />;
    case "event":
      return <CalendarIcon size={15} className="text-[#ff6b5e]" />;
    case "hud":
      return <SpeakerIcon size={15} />;
    case "notification":
      return <BellIcon size={15} className="text-white/85" />;
    default:
      return null;
  }
}
