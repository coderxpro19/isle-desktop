import { useRef, useState } from "react";
import { formatDuration } from "@/lib/format";

interface Props {
  positionMs: number;
  durationMs: number;
  canSeek: boolean;
  accent: string;
  onSeek(ms: number): void;
}

/** Scrubber with live drag preview; commits on release. */
export function SeekBar({ positionMs, durationMs, canSeek, accent, onSeek }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? positionMs;
  const frac = durationMs > 0 ? Math.min(1, shown / durationMs) : 0;

  const at = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * durationMs;
  };

  return (
    <div className="flex items-center gap-2.5 text-[10.5px] font-medium tabular-nums text-white/45">
      <span className="w-9 text-right">{formatDuration(shown)}</span>
      <div
        ref={track}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={durationMs}
        aria-valuenow={shown}
        className={`group relative h-4 flex-1 ${canSeek ? "cursor-pointer" : ""}`}
        onPointerDown={(e) => {
          if (!canSeek) return;
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag(at(e.clientX));
        }}
        onPointerMove={(e) => drag !== null && setDrag(at(e.clientX))}
        onPointerUp={(e) => {
          if (drag === null) return;
          e.stopPropagation();
          onSeek(Math.round(at(e.clientX)));
          setDrag(null);
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute inset-x-0 top-1/2 h-[5px] -translate-y-1/2 overflow-hidden rounded-full bg-white/15 transition-[height] group-hover:h-[7px]">
          <div className="h-full rounded-full" style={{ width: `${frac * 100}%`, background: accent }} />
        </div>
      </div>
      <span className="w-9">-{formatDuration(Math.max(0, durationMs - shown))}</span>
    </div>
  );
}
