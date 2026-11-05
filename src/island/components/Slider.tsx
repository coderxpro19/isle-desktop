import { useEffect, useRef, useState, type ReactNode } from "react";
import { useIsland } from "../store";

interface Props {
  label: string;
  /** 0–1 */
  value: number;
  disabled?: boolean;
  icon: ReactNode;
  /** Called while dragging (throttled) and on release. */
  onChange(v: number): void;
  onIconClick?(): void;
  trailing?: ReactNode;
}

const SEND_EVERY_MS = 40;

/**
 * Chunky control-centre slider. Shows its own value while dragging so it
 * never fights backend echoes, and pins the island open for the drag.
 */
export function Slider({ label, value, disabled, icon, onChange, onIconClick, trailing }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const lastSent = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unpin = useRef<(() => void) | null>(null);
  const shown = drag ?? value;

  useEffect(() => () => {
    unpin.current?.();
    if (pending.current) clearTimeout(pending.current);
  }, []);

  const at = (x: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (x - r.left) / r.width));
  };
  const send = (v: number, force = false) => {
    if (pending.current) clearTimeout(pending.current);
    const wait = SEND_EVERY_MS - (Date.now() - lastSent.current);
    if (force || wait <= 0) {
      lastSent.current = Date.now();
      onChange(v);
    } else {
      pending.current = setTimeout(() => send(v, true), wait);
    }
  };

  return (
    <div className={`flex items-center gap-2 ${disabled ? "opacity-35" : ""}`}>
      <div
        ref={track}
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(shown * 100)}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        className="relative h-[30px] flex-1 cursor-pointer overflow-hidden rounded-full bg-white/12 outline-none"
        onPointerDown={(e) => {
          if (disabled) return;
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          unpin.current = useIsland.getState().pin();
          const v = at(e.clientX);
          setDrag(v);
          send(v);
        }}
        onPointerMove={(e) => {
          if (drag === null) return;
          const v = at(e.clientX);
          setDrag(v);
          send(v);
        }}
        onPointerUp={(e) => {
          if (drag === null) return;
          send(at(e.clientX), true);
          setDrag(null);
          unpin.current?.();
          unpin.current = null;
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (disabled) return;
          const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 0.05 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -0.05 : 0;
          if (step) {
            e.preventDefault();
            send(Math.min(1, Math.max(0, value + step)), true);
          }
        }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-white"
          style={{ width: `max(30px, ${shown * 100}%)`, transition: drag === null ? "width 160ms ease-out" : "none" }}
        />
        <button
          type="button"
          aria-label={`${label} icon`}
          className="absolute top-0 left-0 grid h-[30px] w-[30px] place-items-center text-black/80"
          onPointerDown={(e) => onIconClick && e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onIconClick?.();
          }}
          tabIndex={-1}
        >
          {icon}
        </button>
      </div>
      <span className="w-8 text-right text-[11px] font-semibold tabular-nums text-white/55">{Math.round(shown * 100)}</span>
      {trailing}
    </div>
  );
}
