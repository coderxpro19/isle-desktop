import { formatBytes, formatRate, formatUptime } from "@/lib/format";
import type { StatsTick } from "@/lib/types";
import { STATS_HISTORY, useIsland } from "../store";
import { ChevronIcon } from "./icons";

const COLORS = { cpu: "#5ab8ff", mem: "#b28cff", gpu: "#3ddc97", net: "#ffb547" };

export function StatsPanel() {
  const history = useIsland((s) => s.stats);
  const backend = useIsland((s) => s.backend);
  const last = history[history.length - 1];
  if (!last) return <div className="grid h-full place-items-center text-[12px] text-white/40">Measuring…</div>;

  const mem = (t: StatsTick) => (t.memTotal ? (t.memUsed / t.memTotal) * 100 : 0);
  const peakNet = Math.max(1, ...history.map((t) => t.netRx + t.netTx));

  return (
    <div className="flex h-full flex-col gap-2.5 px-4 pt-1 pb-3.5">
      <div className="grid grid-cols-2 gap-2">
        <Metric label="CPU" value={`${Math.round(last.cpu)}%`} sub={`${last.cores} threads`} color={COLORS.cpu} points={history.map((t) => t.cpu)} max={100} />
        <Metric
          label="Memory"
          value={`${Math.round(mem(last))}%`}
          sub={`${formatBytes(last.memUsed)} of ${formatBytes(last.memTotal)}`}
          color={COLORS.mem}
          points={history.map(mem)}
          max={100}
        />
        <Metric
          label="GPU"
          value={last.gpu === null ? "—" : `${Math.round(last.gpu)}%`}
          sub={last.gpu === null ? "Not available" : "3D engine"}
          color={COLORS.gpu}
          points={history.map((t) => t.gpu ?? 0)}
          max={100}
        />
        <Metric
          label="Network"
          value={`↓ ${formatRate(last.netRx)}`}
          sub={`↑ ${formatRate(last.netTx)}`}
          color={COLORS.net}
          points={history.map((t) => t.netRx + t.netTx)}
          max={peakNet}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        {last.disks.slice(0, 2).map((d) => (
          <div key={d.mount} className="flex items-center gap-2.5 text-[11px]">
            <span className="w-7 font-semibold text-white/75">{d.mount}</span>
            <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-white/12">
              <div className="h-full rounded-full bg-white/70" style={{ width: `${(d.used / d.total) * 100}%` }} />
            </div>
            <span className="w-[108px] text-right text-white/45 tabular-nums">
              {formatBytes(d.total - d.used)} free
            </span>
          </div>
        ))}
      </div>

      <div className="mt-auto flex items-center justify-between text-[11px] text-white/40">
        <span>Up {formatUptime(last.uptimeSecs)}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void backend?.openSettings("taskmgr");
          }}
          className="flex items-center gap-0.5 rounded-md hover:text-white"
        >
          Task Manager <ChevronIcon size={11} />
        </button>
      </div>
    </div>
  );
}

function Metric(props: { label: string; value: string; sub: string; color: string; points: number[]; max: number }) {
  return (
    <div className="relative h-[64px] overflow-hidden rounded-2xl bg-white/8 px-3 py-2">
      <Sparkline points={props.points} max={props.max} color={props.color} />
      <div className="relative flex items-baseline justify-between">
        <span className="text-[10.5px] font-semibold tracking-wide text-white/50 uppercase">{props.label}</span>
        <span className="text-[15px] font-semibold text-white tabular-nums">{props.value}</span>
      </div>
      <div className="relative mt-0.5 truncate text-right text-[10.5px] text-white/45 tabular-nums">{props.sub}</div>
    </div>
  );
}

/** Area sparkline anchored to the right edge, `STATS_HISTORY` samples wide. */
function Sparkline({ points, max, color }: { points: number[]; max: number; color: string }) {
  const W = 200, H = 40;
  if (points.length < 2) return null;
  const step = W / (STATS_HISTORY - 1);
  const offset = W - (points.length - 1) * step;
  const xy = points.map((p, i) => `${(offset + i * step).toFixed(1)},${(H - Math.min(1, p / max) * (H - 2)).toFixed(1)}`);
  return (
    <svg className="absolute inset-x-0 bottom-0 h-[40px] w-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <polygon points={`${offset},${H} ${xy.join(" ")} ${W},${H}`} fill={color} opacity={0.16} />
      <polyline points={xy.join(" ")} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" opacity={0.9} />
    </svg>
  );
}
