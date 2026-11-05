import { useLayoutEffect, useRef } from "react";
import type { PreviewSlot } from "@/lib/types";
import { useDock, type Popup } from "./store";

const CARD_W = 220;
const THUMB_H = 124;

/**
 * Live window previews above a dock icon. The UI draws the card frames; the
 * native side paints DWM thumbnails into the `[data-thumb]` boxes.
 */
export function Previews({ popup, canvasW, bottom }: { popup: Popup; canvasW: number; bottom: number }) {
  const app = useDock((s) => s.apps.find((a) => a.key === popup.key));
  const backend = useDock((s) => s.backend);
  const icon = useDock((s) => s.icons[popup.key]);
  const box = useRef<HTMLDivElement>(null);
  const wins = app?.windows.slice(0, 5) ?? [];
  const width = wins.length * (CARD_W + 8) + 8;
  const left = Math.min(Math.max(8, popup.x - width / 2), canvasW - width - 8);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !backend) return;
    const root = el.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const slots: PreviewSlot[] = [];
    el.querySelectorAll<HTMLElement>("[data-thumb]").forEach((t) => {
      const r = t.getBoundingClientRect();
      slots.push({ hwnd: Number(t.dataset.thumb), x: r.left - root.left, y: r.top - root.top, w: r.width, h: r.height });
    });
    void backend.dockPreviews(slots);
  });
  useLayoutEffect(() => () => void useDock.getState().backend?.dockPreviews([]), []);

  if (!app || wins.length === 0) return null;
  return (
    <div
      ref={box}
      data-dock-popup
      className="absolute flex gap-2 rounded-2xl border border-white/10 bg-[rgba(20,20,24,0.92)] p-2 shadow-[0_12px_40px_rgba(0,0,0,0.5)] backdrop-blur-2xl"
      style={{ left, bottom, width }}
      onPointerLeave={() => useDock.setState({ preview: null })}
    >
      {wins.map((w) => (
        <div
          key={w.hwnd}
          role="button"
          tabIndex={0}
          onClick={() => {
            void backend?.dockWindow(w.hwnd, "activate");
            useDock.setState({ preview: null });
          }}
          className="group flex cursor-pointer flex-col overflow-hidden rounded-xl bg-white/5 hover:bg-white/10"
          style={{ width: CARD_W }}
        >
          <div className="flex h-[26px] items-center gap-1.5 px-2">
            {icon && <img src={icon} alt="" className="h-4 w-4" />}
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-white/85">{w.title}</span>
            <button
              type="button"
              aria-label={`Close ${w.title}`}
              onClick={(e) => {
                e.stopPropagation();
                void backend?.dockWindow(w.hwnd, "close");
              }}
              className="grid h-5 w-5 place-items-center rounded-md text-white/50 opacity-0 group-hover:opacity-100 hover:bg-[#e5484d] hover:text-white"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.6">
                <path d="M2 2l6 6M8 2 2 8" />
              </svg>
            </button>
          </div>
          {/* Native thumbnail is drawn over this box; the fallback shows when there's none (minimised). */}
          <div data-thumb={w.hwnd} className="relative mx-2 mb-2 grid place-items-center rounded-lg bg-black/40" style={{ height: THUMB_H }}>
            {icon && <img src={icon} alt="" className="h-10 w-10 opacity-40" />}
            {w.minimized && <span className="absolute bottom-1.5 text-[10px] text-white/40">Minimised</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
