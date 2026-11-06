import type { ReactNode } from "react";
import { useIsland } from "../store";
import { ChevronIcon } from "./icons";

/** Header for a Controls sub-page: back · title · trailing (switch, refresh…). */
export function SubHeader({ title, trailing }: { title: string; trailing?: ReactNode }) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-1.5">
      <button
        type="button"
        aria-label="Back"
        onClick={(e) => {
          e.stopPropagation();
          useIsland.setState({ controlsView: "main" });
        }}
        className="grid h-7 w-7 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
      >
        <ChevronIcon size={15} style={{ transform: "scaleX(-1)" }} />
      </button>
      <span className="flex-1 text-[13.5px] font-semibold text-white">{title}</span>
      {trailing}
    </div>
  );
}

export function Switch({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange(on: boolean): void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? "bg-white" : "bg-white/20"}`}
    >
      <span
        className="absolute top-[2px] left-[2px] h-[18px] w-[18px] rounded-full bg-white shadow transition-transform"
        style={{ transform: on ? "translateX(16px)" : "none" }}
      />
    </button>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin text-white/60" aria-label="Loading">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="42 100" strokeLinecap="round" />
    </svg>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pt-1.5 pb-0.5 text-[10.5px] font-semibold tracking-wide text-white/35 uppercase">{children}</div>;
}

export function Row(props: { icon: ReactNode; title: string; sub?: ReactNode; trailing?: ReactNode; active?: boolean; onClick?(): void; children?: ReactNode }) {
  return (
    <div className={`rounded-xl ${props.active ? "bg-white/8" : ""}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          props.onClick?.();
        }}
        className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-white/8"
      >
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${props.active ? "bg-[#2f7bff] text-white" : "bg-white/10 text-white/80"}`}>
          {props.icon}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[12.5px] font-medium text-white">{props.title}</span>
          {props.sub && <span className="block truncate text-[11px] text-white/45">{props.sub}</span>}
        </span>
        {props.trailing}
      </button>
      {props.children}
    </div>
  );
}

/** Keeps the island pinned open while a text field has focus. */
export function pinWhileFocused() {
  let unpin: (() => void) | null = null;
  return {
    onFocus: () => {
      unpin ??= useIsland.getState().pin();
    },
    onBlur: () => {
      unpin?.();
      unpin = null;
    },
  };
}
