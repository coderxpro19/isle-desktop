import { useRef, useState } from "react";
import type { TrayButton, TrayIcon } from "@/lib/types";
import { useDock } from "./store";

/** Tray icons shown inline; the rest go in the overflow popup. */
export const TRAY_INLINE = 5;
export const TRAY_CELL = 26;

/** Width the tray group needs on the bar. */
export function trayWidth(count: number): number {
  if (count === 0) return 0;
  return Math.min(count, TRAY_INLINE) * TRAY_CELL + (count > TRAY_INLINE ? TRAY_CELL : 0) + 8;
}

/** Other apps' tray icons (NordVPN, WhatsApp, Windows Security…), hosted by Isle. */
export function TrayGroup({ iconSize }: { iconSize: number }) {
  const icons = useDock((s) => s.tray);
  const [overflow, setOverflow] = useState(false);
  if (icons.length === 0) return null;
  const inline = icons.slice(0, TRAY_INLINE);
  const extra = icons.slice(TRAY_INLINE);

  return (
    <div className="relative flex items-center px-1" style={{ height: iconSize }}>
      {extra.length > 0 && (
        <button
          type="button"
          aria-label="Show hidden tray icons"
          onClick={() => setOverflow(!overflow)}
          className="grid place-items-center rounded-md text-white/60 hover:bg-white/10 hover:text-white"
          style={{ width: TRAY_CELL, height: TRAY_CELL }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: overflow ? "rotate(180deg)" : undefined }}>
            <path d="m6 15 6-6 6 6" />
          </svg>
        </button>
      )}
      {inline.map((i) => (
        <TrayButtonEl key={i.id} icon={i} />
      ))}
      {overflow && extra.length > 0 && (
        <div
          data-dock-popup
          className="absolute bottom-full left-0 mb-4 grid gap-1 rounded-xl border border-white/10 bg-[rgba(24,24,28,0.96)] p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.5)]"
          style={{ gridTemplateColumns: `repeat(${Math.min(5, extra.length)}, ${TRAY_CELL}px)` }}
          onPointerLeave={() => setOverflow(false)}
        >
          {extra.map((i) => (
            <TrayButtonEl key={i.id} icon={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function TrayButtonEl({ icon }: { icon: TrayIcon }) {
  const backend = useDock((s) => s.backend);
  const el = useRef<HTMLButtonElement>(null);
  const send = (button: TrayButton) => {
    const b = el.current?.getBoundingClientRect();
    const root = el.current?.closest("[data-dock-root]")?.getBoundingClientRect();
    if (!b || !root || !backend) return;
    void backend.trayClick(icon.id, button, b.left - root.left + b.width / 2, b.top - root.top + b.height / 2);
  };
  return (
    <button
      ref={el}
      type="button"
      title={icon.tip}
      aria-label={icon.tip || "Tray icon"}
      onClick={() => send("left")}
      onDoubleClick={() => send("double")}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        send("right");
      }}
      className="grid place-items-center rounded-md hover:bg-white/10 active:scale-90"
      style={{ width: TRAY_CELL, height: TRAY_CELL }}
    >
      {icon.icon && <img src={icon.icon} alt="" className="h-[18px] w-[18px] object-contain" draggable={false} />}
    </button>
  );
}
