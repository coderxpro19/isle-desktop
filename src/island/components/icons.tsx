import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = ({ size = 16, ...p }: P) => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor", ...p });

export const PlayIcon = (p: P) => (
  <svg {...base(p)}><path d="M7 4.8v14.4c0 .8.9 1.3 1.6.9l11.3-7.2a1 1 0 0 0 0-1.8L8.6 3.9C7.9 3.5 7 4 7 4.8Z" /></svg>
);
export const PauseIcon = (p: P) => (
  <svg {...base(p)}><rect x="5.5" y="4" width="4.5" height="16" rx="1.4" /><rect x="14" y="4" width="4.5" height="16" rx="1.4" /></svg>
);
export const NextIcon = (p: P) => (
  <svg {...base(p)}><path d="M3 6.2v11.6c0 .8.9 1.2 1.5.8l8.2-5.8a1 1 0 0 0 0-1.6L4.5 5.4C3.9 5 3 5.4 3 6.2Zm9.6 0v11.6c0 .8.9 1.2 1.5.8l8.2-5.8a1 1 0 0 0 0-1.6l-8.2-5.8c-.6-.4-1.5 0-1.5.8Z" /></svg>
);
export const PrevIcon = (p: P) => <NextIcon {...p} style={{ transform: "scaleX(-1)", ...p.style }} />;
export const BoltIcon = (p: P) => (
  <svg {...base(p)}><path d="M13.4 2.3 4.6 13.1a.6.6 0 0 0 .5 1h5.6l-1.3 7.4c-.1.6.6.9 1 .4l8.8-10.8a.6.6 0 0 0-.5-1h-5.6l1.3-7.4c.1-.6-.6-.9-1-.4Z" /></svg>
);
export const NoteIcon = (p: P) => (
  <svg {...base(p)}><path d="M19 3.6v11.9a3.2 3.2 0 1 1-2-3V7.3l-7 1.6v8.6a3.2 3.2 0 1 1-2-3V6.2c0-.5.3-.9.8-1L17.8 3c.6-.1 1.2.3 1.2.9Z" /></svg>
);

/** Battery glyph with live fill level. */
export function BatteryGlyph({ percent, charging, saver, width = 26 }: { percent: number | null; charging: boolean; saver: boolean; width?: number }) {
  const pct = Math.max(0, Math.min(100, percent ?? 100));
  const color = charging ? "var(--color-ok)" : pct <= 20 ? "var(--color-danger)" : saver ? "var(--color-warn)" : "#fff";
  const h = width * 0.48;
  return (
    <svg width={width} height={h} viewBox="0 0 27 13" aria-label={percent === null ? "Battery" : `Battery ${pct}%`}>
      <rect x="0.5" y="0.5" width="23" height="12" rx="3.6" fill="none" stroke="rgba(255,255,255,.42)" />
      <rect x="2" y="2" width={Math.max(1.5, 20 * (pct / 100))} height="9" rx="2.2" fill={color} />
      <path d="M25 4.6v3.8c.8-.3 1.4-1.1 1.4-1.9S25.8 4.9 25 4.6Z" fill="rgba(255,255,255,.42)" />
      {charging && (
        <path d="M12.9 1.6 8.6 7h3l-1.2 4.4L14.8 6h-3l1.1-4.4Z" fill="#000" stroke="#000" strokeWidth=".6" strokeLinejoin="round" opacity=".85" />
      )}
    </svg>
  );
}
