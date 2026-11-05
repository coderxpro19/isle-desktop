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

/* ── stroke icons (24px grid, 1.8 stroke) ── */
const stroke = ({ size = 16, ...p }: P) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...p,
});

export const HomeIcon = (p: P) => (
  <svg {...stroke(p)}><path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-8.5Z" /></svg>
);
export const SlidersIcon = (p: P) => (
  <svg {...stroke(p)}><path d="M5 6h9M18 6h1M5 12h3M12 12h7M5 18h11M20 18h-1" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>
);
export const ChartIcon = (p: P) => (
  <svg {...stroke(p)}><path d="M4 19h16M7 15l3.5-4 3 2.5L19 7" /></svg>
);
export const SunIcon = (p: P) => (
  <svg {...stroke(p)}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" /></svg>
);
export const MoonIcon = (p: P) => (
  <svg {...base(p)}><path d="M20.3 14.6A8.6 8.6 0 0 1 9.4 3.7a.6.6 0 0 0-.8-.7 9.4 9.4 0 1 0 12.4 12.4.6.6 0 0 0-.7-.8Z" /></svg>
);
export const SpeakerIcon = ({ muted, level = 1, ...p }: P & { muted?: boolean; level?: number }) => (
  <svg {...stroke(p)}>
    <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" stroke="none" />
    {muted ? (
      <path d="m16 9.5 5 5M21 9.5l-5 5" />
    ) : (
      <>
        {level > 0.02 && <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" />}
        {level > 0.5 && <path d="M18 7a7 7 0 0 1 0 10" />}
      </>
    )}
  </svg>
);
export const WifiIcon = ({ bars = 5, off, ...p }: P & { bars?: number; off?: boolean }) => {
  const dim = (n: number) => (off || bars < n ? 0.28 : 1);
  return (
    <svg {...stroke(p)}>
      <path d="M2.5 9a14 14 0 0 1 19 0" opacity={dim(5)} />
      <path d="M5.5 12.3a9.6 9.6 0 0 1 13 0" opacity={dim(3)} />
      <path d="M8.6 15.5a5 5 0 0 1 6.8 0" opacity={dim(2)} />
      <circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none" opacity={dim(1)} />
      {off && <path d="m4 4 16 16" />}
    </svg>
  );
};
export const EthernetIcon = (p: P) => (
  <svg {...stroke(p)}><rect x="4" y="4" width="16" height="12" rx="2" /><path d="M8 20h8M12 16v4M8 8v3M12 8v3M16 8v3" /></svg>
);
export const BluetoothIcon = (p: P) => (
  <svg {...stroke(p)}><path d="m7 7.5 10 9-5 4.5V3l5 4.5-10 9" /></svg>
);
export const ChevronIcon = (p: P) => (
  <svg {...stroke(p)}><path d="m9 6 6 6-6 6" /></svg>
);
export const PinIcon = (p: P) => (
  <svg {...stroke(p)}><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z" /><circle cx="12" cy="10" r="2.3" /></svg>
);
export const SearchIcon = (p: P) => (
  <svg {...stroke(p)}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>
);
export const GaugeIcon = (p: P) => (
  <svg {...stroke(p)}><path d="M4.5 17a8.5 8.5 0 1 1 15 0" /><path d="m12 13 3.5-4" /></svg>
);

/** Filled, coloured weather glyphs. */
export function WeatherGlyph({ kind, day = true, size = 24 }: { kind: import("@/lib/weather").WeatherKind; day?: boolean; size?: number }) {
  const sun = <circle cx="9.5" cy="9.5" r="4.6" fill="#FFC53D" />;
  const moon = <path d="M14 13.6A5.6 5.6 0 0 1 7.2 4.7a5.6 5.6 0 1 0 6.8 8.9Z" fill="#C9D3FF" />;
  const cloud = (fill: string) => (
    <path d="M7.6 20h9.2a4.2 4.2 0 0 0 .5-8.4 5.4 5.4 0 0 0-10.3 1.5A3.5 3.5 0 0 0 7.6 20Z" fill={fill} />
  );
  const drops = (n: number, color = "#5AB8FF") =>
    Array.from({ length: n }, (_, i) => <path key={i} d={`M${8.5 + i * 3.5} 21.4l-1 2`} stroke={color} strokeWidth="1.8" strokeLinecap="round" />);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {kind === "clear" && (day ? <circle cx="12" cy="12" r="6" fill="#FFC53D" /> : <path d="M17 16.4A7.2 7.2 0 0 1 8.4 4.9a7.2 7.2 0 1 0 8.6 11.5Z" fill="#C9D3FF" />)}
      {kind === "partly" && (
        <>
          {day ? sun : moon}
          {cloud("#E8ECF4")}
        </>
      )}
      {kind === "cloudy" && cloud("#C7CEDA")}
      {kind === "fog" && <path d="M4 9h16M6 13h12M4 17h16" stroke="#C7CEDA" strokeWidth="2" strokeLinecap="round" />}
      {kind === "drizzle" && (
        <g transform="translate(0 -3)">
          {cloud("#C7CEDA")}
          {drops(2)}
        </g>
      )}
      {kind === "rain" && (
        <g transform="translate(0 -3)">
          {cloud("#AEB8C8")}
          {drops(3)}
        </g>
      )}
      {kind === "snow" && (
        <g transform="translate(0 -3)">
          {cloud("#DDE3EC")}
          {drops(3, "#FFFFFF")}
        </g>
      )}
      {kind === "storm" && (
        <g transform="translate(0 -3)">
          {cloud("#8F9AAD")}
          <path d="m12.5 19-2 3.4h2.4L11.6 26" stroke="#FFC53D" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
    </svg>
  );
}
export const TimerIcon = (p: P) => (
  <svg {...stroke(p)}><circle cx="12" cy="13.5" r="7.5" /><path d="M12 9.5v4l2.5 2M9.5 2.5h5" /></svg>
);
export const CalendarIcon = (p: P) => (
  <svg {...stroke(p)}><rect x="4" y="5" width="16" height="15" rx="2.5" /><path d="M4 10h16M8.5 3v4M15.5 3v4" /></svg>
);
export const FlagIcon = (p: P) => (
  <svg {...stroke(p)}><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></svg>
);
