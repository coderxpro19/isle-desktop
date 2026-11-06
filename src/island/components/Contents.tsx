import type { ReactNode } from "react";
import { formatClock, formatDate, formatMinutes } from "@/lib/format";
import type { BatteryState, MediaState } from "@/lib/types";
import type { ActivityKind } from "../activities";
import { usePlaybackPosition } from "../hooks";
import { useIsland } from "../store";
import { describe } from "@/lib/weather";
import type { Tab } from "../store";
import { ClockPanel } from "./ClockPanel";
import { ClipboardPanel } from "./ClipboardPanel";
import { AssistantPanel } from "./AssistantPanel";
import { ControlsPanel } from "./ControlsPanel";
import { NotificationsPanel } from "./NotificationsPanel";
import { ShelfPanel } from "./ShelfPanel";
import { LIVE_KINDS, LiveContent } from "./Live";
import { BatteryGlyph, BoltIcon, MoonIcon, NextIcon, NoteIcon, PauseIcon, PlayIcon, PrevIcon, WeatherGlyph } from "./icons";
import { StatsPanel } from "./StatsPanel";
import { UpdateBanner, UpdateDot } from "./UpdateBanner";
import { WeatherPanel } from "./WeatherPanel";
import { Marquee } from "./Marquee";
import { SeekBar } from "./SeekBar";
import { Visualizer } from "./Visualizer";

const FALLBACK_ACCENT = "hsl(214 90% 70%)";
const WIDE_BANDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

export function useAccent(): string {
  return useIsland((s) => {
    const a = s.settings.appearance.accent;
    if (a !== "artwork") return a;
    return (s.media && s.accents[s.media.trackKey]) || FALLBACK_ACCENT;
  });
}

function Artwork({ size, radius, className = "" }: { size: number; radius: number; className?: string }) {
  const url = useIsland((s) => (s.media ? s.artworks[s.media.trackKey] : undefined));
  return (
    <div
      className={`shrink-0 overflow-hidden bg-white/10 ${className}`}
      style={{ width: size, height: size, borderRadius: radius }}
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : (
        <div className="grid h-full w-full place-items-center text-white/50">
          <NoteIcon size={size * 0.5} />
        </div>
      )}
    </div>
  );
}

function Clock({ className = "", period = false }: { className?: string; period?: boolean }) {
  const { clock24h, showSeconds } = useIsland((s) => s.settings.island);
  const now = useIsland((s) => s.now);
  return <span className={`tabular-nums ${className}`}>{formatClock(now, clock24h, showSeconds, period)}</span>;
}

function Battery({ showPercent }: { showPercent: boolean }) {
  const b = useIsland((s) => s.battery);
  if (!b?.hasBattery) return null;
  return (
    <span className="flex items-center gap-1.5">
      {showPercent && b.percent !== null && (
        <span className={`text-[12px] font-semibold tabular-nums ${b.charging ? "text-ok" : "text-white/85"}`}>{b.percent}%</span>
      )}
      <BatteryGlyph percent={b.percent} charging={b.charging} saver={b.saver} />
    </span>
  );
}

/* ───────────────────────────── compact ───────────────────────────── */

export function CompactContent({ primary }: { primary: ActivityKind | null }) {
  const pct = useIsland((s) => s.settings.island.batteryPercent);
  const media = useIsland((s) => s.media);
  const accent = useAccent();
  const transient = useIsland((s) => s.transient);
  const notch = useIsland((s) => s.settings.island.notchStyle === "notch");
  const compactMode = useIsland((s) => s.settings.island.compactMode);

  if (primary && LIVE_KINDS.includes(primary)) return <LiveContent kind={primary} />;

  if (primary === "update" && transient?.kind === "update") {
    return (
      <Row>
        <span className="flex items-center gap-2 text-[13px] font-semibold text-[#7cb5ff]">
          <span className="h-2 w-2 rounded-full bg-[#5aa2ff]" />
          Update available
        </span>
        <span className="text-[12.5px] font-medium text-white/70">Isle {transient.version}</span>
      </Row>
    );
  }

  if (primary === "charging" || primary === "lowBattery") {
    const charging = primary === "charging";
    return (
      <Row>
        <span className={`flex items-center gap-1.5 text-[13px] font-semibold ${charging ? "text-ok" : "text-danger"}`}>
          {charging && <BoltIcon size={14} />}
          {charging ? "Charging" : "Low Battery"}
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`text-[13px] font-semibold tabular-nums ${charging ? "text-ok" : "text-danger"}`}>
            {transient && "percent" in transient ? (transient.percent ?? "–") : "–"}%
          </span>
          <BatteryGlyph percent={transient && "percent" in transient ? transient.percent : null} charging={charging} saver={false} />
        </span>
      </Row>
    );
  }

  if (notch && compactMode && primary === "music" && media) {
    return (
      <div className="flex h-full items-center justify-between px-[10px]">
        <span className="w-[44px]">
          <Visualizer height={12} color={accent} playing={media.playing} />
        </span>
        <span className="flex items-center gap-1.5">
          <UpdateDot />
          <Clock className="text-[13px] font-bold text-white" />
        </span>
        <span className="flex w-[44px] justify-end">
          <Artwork size={20} radius={5} />
        </span>
      </div>
    );
  }

  if (notch) {
    return (
      <div className="flex h-full items-center justify-center gap-1.5">
        <UpdateDot />
        <FocusDot />
        <Clock className="text-[13px] font-bold text-white" />
      </div>
    );
  }

  if (primary === "music" && media) {
    return (
      <Row>
        <Artwork size={22} radius={6} />
        <span className="flex items-center gap-1.5">
          <UpdateDot />
          <Clock className="text-[13px] font-semibold text-white/90" />
        </span>
        <Visualizer height={14} color={accent} playing={media.playing} />
      </Row>
    );
  }

  return (
    <Row>
      <Clock className="text-[13px] font-semibold text-white/95" />
      <span className="flex items-center gap-2">
        <UpdateDot />
        <FocusDot />
        <Battery showPercent={pct} />
      </span>
    </Row>
  );
}

function FocusDot() {
  const on = useIsland((s) => s.settings.island.focusMode);
  return on ? <MoonIcon size={12} className="text-[#a597ff]" aria-label="Focus on" /> : null;
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-between px-[14px]">{children}</div>;
}

/* ───────────────────────────── peek ───────────────────────────── */

export function PeekContent({ primary }: { primary: ActivityKind | null }) {
  const media = useIsland((s) => s.media);
  const now = useIsland((s) => s.now);
  const accent = useAccent();

  if (primary && LIVE_KINDS.includes(primary)) return <LiveContent kind={primary} big />;

  if (primary === "music" && media) {
    return (
      <div className="flex h-full items-center gap-3 px-[10px]">
        <Artwork size={40} radius={10} />
        <div className="min-w-0 flex-1 leading-tight">
          <Marquee className="text-[13px] font-semibold text-white">{media.title || "Unknown title"}</Marquee>
          <Marquee className="text-[12px] text-white/55">{media.artist || media.appName}</Marquee>
        </div>
        <div className="pr-2">
          <Visualizer height={18} barWidth={3} color={accent} playing={media.playing} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-between px-[18px]">
      <span className="text-[12px] font-medium text-white/55">{formatDate(now)}</span>
      <Clock className="text-[17px] font-semibold text-white" />
      <Battery showPercent />
    </div>
  );
}

/* ───────────────────────────── expanded ───────────────────────────── */

export function ExpandedContent({ primary, tab }: { primary: ActivityKind | null; tab: Tab }) {
  switch (tab) {
    case "controls":
      return <ControlsPanel />;
    case "weather":
      return <WeatherPanel />;
    case "stats":
      return <StatsPanel />;
    case "clock":
      return <ClockPanel />;
    case "clipboard":
      return <ClipboardPanel />;
    case "assistant":
      return <AssistantPanel />;
    case "notifications":
      return <NotificationsPanel />;
    case "shelf":
      return <ShelfPanel />;
    case "home":
      return (
        <div className="flex h-full flex-col">
          <UpdateBanner />
          <div className="min-h-0 flex-1">{primary === "music" ? <MusicPanel /> : <OverviewPanel />}</div>
        </div>
      );
  }
}

function OverviewPanel() {
  const now = useIsland((s) => s.now);
  const b = useIsland((s) => s.battery);
  return (
    <div className="flex h-full flex-col justify-between px-5 pt-1 pb-4">
      <div className="flex items-start justify-between">
        <div>
          <Clock className="block text-[40px] leading-none font-semibold tracking-tight text-white" period />
          <div className="mt-1.5 text-[13px] font-medium text-white/55">
            {now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
          </div>
        </div>
        {b?.hasBattery && <BatteryCard b={b} />}
      </div>
      <div className="flex items-center justify-between text-[12px] text-white/40">
        <span className="flex items-center gap-2">
          <NoteIcon size={13} />
          Nothing playing
        </span>
        <WeatherMini />
      </div>
    </div>
  );
}

function WeatherMini() {
  const w = useIsland((s) => s.weather);
  const hasLoc = useIsland((s) => !!s.settings.weather.location);
  const setTab = useIsland((s) => s.setTab);
  if (!hasLoc || !w) {
    return (
      <button type="button" className="rounded-md hover:text-white" onClick={(e) => (e.stopPropagation(), setTab("weather"))}>
        {hasLoc ? "…" : "Set up weather"}
      </button>
    );
  }
  const d = describe(w.code);
  return (
    <button type="button" className="flex items-center gap-1.5 text-white/75 hover:text-white" onClick={(e) => (e.stopPropagation(), setTab("weather"))}>
      <WeatherGlyph kind={d.kind} day={w.isDay} size={18} />
      <span className="font-semibold tabular-nums">{Math.round(w.temp)}°</span>
      <span className="text-white/45">{d.label}</span>
    </button>
  );
}

function BatteryCard({ b }: { b: BatteryState }) {
  const status = b.charging
    ? "Charging"
    : b.onAc
      ? "Plugged in"
      : b.minutesLeft !== null
        ? `${formatMinutes(b.minutesLeft)} left`
        : "On battery";
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <span className={`text-[20px] font-semibold tabular-nums ${b.charging ? "text-ok" : "text-white"}`}>{b.percent ?? "–"}%</span>
        <BatteryGlyph percent={b.percent} charging={b.charging} saver={b.saver} width={34} />
      </div>
      <span className="text-[11.5px] font-medium text-white/50">
        {status}
        {b.saver && " · Saver"}
      </span>
    </div>
  );
}

function MusicPanel() {
  const media = useIsland((s) => s.media) as MediaState;
  const backend = useIsland((s) => s.backend);
  const accent = useAccent();
  const position = usePlaybackPosition(media, true);
  const control = (a: Parameters<NonNullable<typeof backend>["mediaControl"]>[0]) => void backend?.mediaControl(a);

  return (
    <div className="flex h-full flex-col justify-between px-5 pt-1 pb-4">
      <div className="flex items-center gap-4">
        <Artwork size={66} radius={14} className="shadow-[0_6px_20px_rgba(0,0,0,.45)]" />
        <div className="min-w-0 flex-1 leading-snug">
          <Marquee className="text-[15px] font-semibold text-white">{media.title || "Unknown title"}</Marquee>
          <Marquee className="text-[13px] text-white/60">{[media.artist, media.album].filter(Boolean).join(" — ") || "—"}</Marquee>
          <div className="mt-1 text-[11px] font-medium text-white/35">{media.appName}</div>
        </div>
        <div className="self-start pt-1">
          <Visualizer bands={WIDE_BANDS} height={26} barWidth={2.5} gap={2} color={accent} playing={media.playing} />
        </div>
      </div>

      {media.durationMs > 0 ? (
        <SeekBar
          positionMs={position}
          durationMs={media.durationMs}
          canSeek={media.canSeek}
          accent={accent}
          onSeek={(ms) => control({ type: "seek", positionMs: ms })}
        />
      ) : (
        <div className="h-4" />
      )}

      <div className="flex items-center justify-center gap-7 text-white">
        <ControlButton label="Previous" disabled={!media.canPrevious} onClick={() => control({ type: "previous" })}>
          <PrevIcon size={22} />
        </ControlButton>
        <ControlButton label={media.playing ? "Pause" : "Play"} disabled={!media.canPlayPause} big onClick={() => control({ type: "playPause" })}>
          {media.playing ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
        </ControlButton>
        <ControlButton label="Next" disabled={!media.canNext} onClick={() => control({ type: "next" })}>
          <NextIcon size={22} />
        </ControlButton>
      </div>
    </div>
  );
}

function ControlButton(props: { label: string; disabled?: boolean; big?: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick();
      }}
      className={`grid place-items-center rounded-full transition duration-150 hover:bg-white/10 active:scale-90 disabled:opacity-30 disabled:hover:bg-transparent ${
        props.big ? "h-11 w-11" : "h-9 w-9"
      }`}
    >
      {props.children}
    </button>
  );
}
