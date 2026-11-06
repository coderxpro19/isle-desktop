import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { getBackend, type Backend } from "@/lib/backend";
import { DEFAULT_SETTINGS, type Rect, type Settings } from "@/lib/types";
import { SpeakerIcon, SunIcon } from "@/island/components/icons";

/** Window size (logical px); mirrors edges.rs. */
export const EDGE_W = 76;
export const EDGE_H = 320;
const PILL_W = 40;
const PILL_H = 190;
const PILL_Y = (EDGE_H - PILL_H) / 2;
const STRIP = 3;
const SHOW_MS = 1600;

export type Side = "left" | "right";

/** Where the edge pill sits, and the hover strip that reveals it. */
export function edgeRects(side: Side, visible: boolean, hoverEnabled: boolean): Rect[] {
  if (visible) return [{ x: side === "left" ? 0 : EDGE_W - PILL_W - 10, y: PILL_Y, w: PILL_W + 10, h: PILL_H }];
  if (!hoverEnabled) return [];
  return [{ x: side === "left" ? 0 : EDGE_W - STRIP, y: PILL_Y, w: STRIP, h: PILL_H }];
}

/** Volume (left edge) or brightness (right edge) overlay that slides in from the screen edge. */
export function Edge({ side }: { side: Side }) {
  const kind = side === "left" ? "volume" : "brightness";
  const [backend, setBackend] = useState<Backend | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [level, setLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [shownUntil, setShownUntil] = useState(0);
  const [hover, setHover] = useState(false);
  const [drag, setDrag] = useState(false);
  const [, tick] = useState(0);
  const pill = useRef<HTMLDivElement>(null);

  const enabled = kind === "volume" ? settings.island.volumeHud : settings.overlays.brightnessHud;
  const hoverEnabled = enabled && (kind === "volume" ? settings.overlays.volumeEdge : settings.overlays.brightnessEdge);
  const visible = enabled && (hover || drag || shownUntil > Date.now());

  useEffect(() => {
    let offs: (() => void)[] = [];
    void getBackend().then(async (b) => {
      setBackend(b);
      setSettings(await b.getSettings());
      offs = [
        b.on("settings://changed", setSettings),
        b.on("hud://show", (h) => {
          if (h.kind !== kind) return;
          setLevel(h.kind === "volume" ? h.level : h.level);
          if (h.kind === "volume") setMuted(h.muted);
          setShownUntil(Date.now() + SHOW_MS);
        }),
      ];
      requestAnimationFrame(() => requestAnimationFrame(() => void b.ready()));
    });
    return () => offs.forEach((o) => o());
  }, [kind]);

  // Re-render when a timed show expires.
  useEffect(() => {
    if (shownUntil <= Date.now()) return;
    const t = setTimeout(() => tick((n) => n + 1), shownUntil - Date.now() + 20);
    return () => clearTimeout(t);
  }, [shownUntil]);

  // Report the interactive area to the native hit tester.
  const last = useRef("");
  useEffect(() => {
    if (!backend) return;
    const json = JSON.stringify(edgeRects(side, visible, hoverEnabled));
    if (json !== last.current) {
      last.current = json;
      void backend.setHitRects(JSON.parse(json));
    }
  }, [backend, side, visible, hoverEnabled]);

  const refresh = () =>
    backend?.controlsState().then((c) => {
      if (kind === "volume" && c.volume) {
        setLevel(c.volume.level);
        setMuted(c.volume.muted);
      } else if (kind === "brightness" && c.brightness) setLevel(c.brightness.level / 100);
    }, () => {});

  const apply = (v: number) => {
    const x = Math.max(0, Math.min(1, v));
    setLevel(x);
    if (kind === "volume") {
      if (muted && x > 0) void backend?.controlsSet({ type: "setMute", muted: false });
      setMuted(false);
      void backend?.controlsSet({ type: "setVolume", level: x });
    } else void backend?.controlsSet({ type: "setBrightness", level: Math.round(x * 100) });
  };
  const fromY = (y: number) => {
    const r = pill.current!.getBoundingClientRect();
    return 1 - (y - r.top - 14) / (r.height - 50);
  };

  const shown = kind === "volume" && muted ? 0 : level;
  const left = side === "left";

  return (
    <div
      className="relative h-full w-full select-none"
      onPointerEnter={() => {
        if (!hoverEnabled && !visible) return;
        setHover(true);
        void refresh();
      }}
      onPointerLeave={() => setTimeout(() => setHover(false), 0)}
    >
      <AnimatePresence>
        {visible && (
          <motion.div
            ref={pill}
            key="pill"
            className="absolute flex touch-none flex-col items-center justify-between bg-[#0b0b0d] py-3 shadow-[0_8px_30px_rgba(0,0,0,.45)] ring-1 ring-white/10"
            style={{
              top: PILL_Y,
              width: PILL_W,
              height: PILL_H,
              [left ? "left" : "right"]: 0,
              borderRadius: left ? "0 16px 16px 0" : "16px 0 0 16px",
            }}
            initial={{ x: left ? -PILL_W - 4 : PILL_W + 4 }}
            animate={{ x: 0 }}
            exit={{ x: left ? -PILL_W - 4 : PILL_W + 4 }}
            transition={{ type: "spring", visualDuration: 0.3, bounce: 0.2 }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setDrag(true);
              apply(fromY(e.clientY));
            }}
            onPointerMove={(e) => drag && apply(fromY(e.clientY))}
            onPointerUp={() => {
              setDrag(false);
              setShownUntil(Date.now() + 900);
            }}
            onWheel={(e) => apply(level - Math.sign(e.deltaY) * 0.04)}
          >
            <div className="relative w-[10px] flex-1 overflow-hidden rounded-full bg-white/15">
              <motion.div
                className="absolute inset-x-0 bottom-0 rounded-full bg-white"
                animate={{ height: `${shown * 100}%` }}
                transition={drag ? { duration: 0 } : { type: "spring", visualDuration: 0.2, bounce: 0 }}
              />
            </div>
            <span className="mt-2.5 text-white/85">
              {kind === "volume" ? <SpeakerIcon size={14} muted={muted} level={level} /> : <SunIcon size={14} />}
            </span>
            <span className="mt-1 text-[9.5px] font-semibold text-white/55 tabular-nums">{Math.round(shown * 100)}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Rounded top corners of the screen. */
export function Corners() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    let off: (() => void) | undefined;
    void getBackend().then(async (b) => {
      setOn((await b.getSettings()).appearance.screenCorners);
      off = b.on("settings://changed", (s) => setOn(s.appearance.screenCorners));
      requestAnimationFrame(() => requestAnimationFrame(() => void b.ready()));
    });
    return () => off?.();
  }, []);
  if (!on) return null;
  const R = 12;
  const corner = (at: string): React.CSSProperties => ({
    position: "absolute",
    top: 0,
    width: R,
    height: R,
    background: `radial-gradient(circle at ${at}, transparent ${R - 0.5}px, #000 ${R}px)`,
  });
  return (
    <div className="pointer-events-none relative h-full w-full">
      <span style={{ ...corner("100% 100%"), left: 0 }} />
      <span style={{ ...corner("0 100%"), right: 0 }} />
    </div>
  );
}
