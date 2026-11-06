import type { ReactNode } from "react";
import { formatBytes, formatClock, formatRate } from "@/lib/format";
import type { WidgetId } from "@/lib/types";
import { describe } from "@/lib/weather";
import { PAGES, stepPage } from "../activities";
import { useIsland } from "../store";
import { ArrowLeftIcon, ArrowRightIcon, BatteryGlyph, ChipIcon, DiskIcon, GaugeIcon, MemoryIcon, NetIcon, WeatherGlyph } from "./icons";

/** The status row of the open island: widgets either side of ‹ time ›. */
export function Header() {
  const left = useIsland((s) => s.settings.island.widgetsLeft);
  const right = useIsland((s) => s.settings.island.widgetsRight);
  const tab = useIsland((s) => s.tab);
  const now = useIsland((s) => s.now);
  const { clock24h, showSeconds } = useIsland((s) => s.settings.island);
  const prev = PAGES.find((p) => p.id === stepPage(tab, -1))!;
  const next = PAGES.find((p) => p.id === stepPage(tab, 1))!;
  const go = (dir: 1 | -1) => useIsland.setState((s) => ({ tab: stepPage(s.tab, dir), controlsView: "main" }));

  return (
    <div className="grid h-full grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 text-[12px] font-semibold text-white/90" onClick={(e) => e.stopPropagation()}>
      <div className="flex min-w-0 items-center gap-3">
        {left.map((w) => (
          <Widget key={w} id={w} />
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <Arrow label={`Previous: ${prev.label}`} onClick={() => go(-1)}>
          <ArrowLeftIcon size={12} />
        </Arrow>
        <span className="min-w-[44px] text-center text-[14px] font-bold tracking-tight tabular-nums" title={PAGES.find((p) => p.id === tab)?.label}>
          {formatClock(now, clock24h, showSeconds)}
        </span>
        <Arrow label={`Next: ${next.label}`} onClick={() => go(1)}>
          <ArrowRightIcon size={12} />
        </Arrow>
      </div>
      <div className="flex min-w-0 items-center justify-end gap-3">
        {right.map((w) => (
          <Widget key={w} id={w} />
        ))}
      </div>
    </div>
  );
}

function Arrow({ label, onClick, children }: { label: string; onClick(): void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="grid h-6 w-5 place-items-center rounded-md text-white/45 transition hover:bg-white/10 hover:text-white">
      {children}
    </button>
  );
}

const pct = (v: number) => `${Math.round(v)}%`;

export function Widget({ id }: { id: WidgetId }) {
  const stats = useIsland((s) => s.stats.at(-1) ?? null);
  const battery = useIsland((s) => s.battery);
  const weather = useIsland((s) => s.weather);
  const place = useIsland((s) => s.settings.weather.location?.name);
  const fahrenheit = useIsland((s) => s.settings.weather.fahrenheit);

  switch (id) {
    case "weather": {
      if (!weather) return null;
      const d = describe(weather.code);
      return (
        <Item tip={`${d.label}${place ? ` — ${place}` : ""}`} onClick={() => useIsland.setState({ tab: "weather" })}>
          <WeatherGlyph kind={d.kind} day={weather.isDay} size={14} />
          {Math.round(weather.temp)}°{fahrenheit ? "F" : "C"}
        </Item>
      );
    }
    case "cpu":
      return (
        <Item tip="CPU Usage" onClick={() => useIsland.setState({ tab: "stats" })}>
          <ChipIcon size={13} className="text-white/70" />
          {stats ? pct(stats.cpu) : "–"}
        </Item>
      );
    case "ram":
      return (
        <Item tip={stats ? `RAM Usage — ${formatBytes(stats.memUsed)} of ${formatBytes(stats.memTotal)}` : "RAM Usage"} onClick={() => useIsland.setState({ tab: "stats" })}>
          <MemoryIcon size={13} className="text-white/70" />
          {stats ? pct((stats.memUsed / Math.max(1, stats.memTotal)) * 100) : "–"}
        </Item>
      );
    case "gpu":
      return stats?.gpu == null ? null : (
        <Item tip="GPU Usage" onClick={() => useIsland.setState({ tab: "stats" })}>
          <GaugeIcon size={13} className="text-white/70" />
          {pct(stats.gpu)}
        </Item>
      );
    case "disk": {
      const d = stats?.disks[0];
      return !d ? null : (
        <Item tip={`Disk ${d.mount} — ${formatBytes(d.total - d.used)} free`} onClick={() => useIsland.setState({ tab: "stats" })}>
          <DiskIcon size={13} className="text-white/70" />
          {pct((d.used / Math.max(1, d.total)) * 100)}
        </Item>
      );
    }
    case "net":
      return !stats ? null : (
        <Item tip={`Network — ↓ ${formatRate(stats.netRx)}  ↑ ${formatRate(stats.netTx)}`} onClick={() => useIsland.setState({ tab: "stats" })}>
          <NetIcon size={13} className="text-white/70" />
          {formatRate(stats.netRx)}
        </Item>
      );
    case "battery": {
      if (!battery?.hasBattery) return null;
      const full = battery.percent === 100 && battery.onAc;
      const tip = battery.charging ? `Charging (${battery.percent}%)` : full ? "Fully charged (100%)" : `${battery.percent}%${battery.minutesLeft ? ` — about ${Math.round(battery.minutesLeft / 60)}h ${battery.minutesLeft % 60}m left` : ""}`;
      return (
        <Item tip={tip}>
          <BatteryGlyph percent={battery.percent} charging={battery.charging || full} saver={battery.saver} width={20} />
          {battery.percent ?? "–"}%
        </Item>
      );
    }
  }
}

function Item({ tip, children, onClick }: { tip: string; children: ReactNode; onClick?(): void }) {
  return (
    <span title={tip} onClick={onClick} className={`flex shrink-0 items-center gap-1 whitespace-nowrap tabular-nums ${onClick ? "cursor-pointer hover:text-white" : ""}`}>
      {children}
    </span>
  );
}

export const WIDGETS: { id: WidgetId; label: string }[] = [
  { id: "weather", label: "Weather" },
  { id: "cpu", label: "CPU" },
  { id: "ram", label: "RAM" },
  { id: "battery", label: "Battery" },
  { id: "gpu", label: "GPU" },
  { id: "disk", label: "Disk" },
  { id: "net", label: "Network" },
];
