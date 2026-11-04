import { AnimatePresence, motion, type Transition } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import type { Rect } from "@/lib/types";
import { BUBBLE, BUBBLE_GAP, PILL_TOP, deriveActivities, pillSize, type Activity } from "./activities";
import { CompactContent, ExpandedContent, PeekContent, useAccent } from "./components/Contents";
import { BoltIcon, NoteIcon } from "./components/icons";
import {
  useBackendSync,
  useClockTicker,
  useHoverIntent,
  useTransientExpiry,
  useVisualizerDemand,
} from "./hooks";
import { useIsland } from "./store";

/** Width/height of the transparent island window (logical px). Mirrors island.rs. */
export const CANVAS_W = 680;
export const CANVAS_H = 440;

export function Island() {
  useBackendSync();
  useClockTicker();
  useHoverIntent();
  useTransientExpiry();
  useVisualizerDemand();

  const mode = useIsland((s) => s.mode);
  const media = useIsland((s) => s.media);
  const pausedAt = useIsland((s) => s.pausedAt);
  const transient = useIsland((s) => s.transient);
  const now = useIsland((s) => s.now);
  const backend = useIsland((s) => s.backend);
  const { cornerRadius, reduceMotion } = useIsland((s) => s.settings.appearance);
  const { setHovered, setMode } = useIsland.getState();

  const activities = useMemo(
    () => deriveActivities({ media, pausedAt, transient }, Date.now()),
    // `now` re-evaluates lingering paused activities every minute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [media, pausedAt, transient, now],
  );
  const primary = activities[0]?.kind ?? null;
  const bubbles = activities.slice(1, 3);
  const size = pillSize(mode, primary, cornerRadius);

  const spring: Transition = reduceMotion
    ? { duration: 0 }
    : { type: "spring", visualDuration: 0.42, bounce: mode === "compact" ? 0.18 : 0.3 };

  // Report interactive regions (at their *target* geometry) to the native hit tester.
  const lastRects = useRef("");
  useEffect(() => {
    if (!backend) return;
    const pillX = (CANVAS_W - size.w) / 2;
    const rects: Rect[] = [{ x: pillX, y: PILL_TOP, w: size.w, h: size.h }];
    bubbles.forEach((_, i) =>
      rects.push({ x: pillX + size.w + BUBBLE_GAP + i * (BUBBLE + BUBBLE_GAP), y: PILL_TOP, w: BUBBLE, h: BUBBLE }),
    );
    const json = JSON.stringify(rects);
    if (json !== lastRects.current) {
      lastRects.current = json;
      void backend.setHitRects(rects);
    }
  }, [backend, size.w, size.h, bubbles]);

  // Show the native window only once something has painted.
  useEffect(() => {
    if (!backend) return;
    requestAnimationFrame(() => requestAnimationFrame(() => void backend.ready()));
  }, [backend]);

  const contentKey = `${mode}:${primary ?? "idle"}`;
  const Content = mode === "expanded" ? ExpandedContent : mode === "peek" ? PeekContent : CompactContent;

  return (
    <div className="relative select-none" style={{ width: CANVAS_W, height: CANVAS_H }}>
      <motion.div
        className="isle-pill absolute left-1/2 cursor-default overflow-hidden bg-black"
        style={{ top: PILL_TOP, x: "-50%" }}
        initial={false}
        animate={{
          width: size.w,
          height: size.h,
          borderRadius: size.r,
          boxShadow:
            mode === "expanded"
              ? "0 18px 50px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.07)"
              : "0 4px 14px rgba(0,0,0,.28), 0 0 0 1px rgba(255,255,255,.06)",
        }}
        transition={spring}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onClick={() => setMode(mode === "expanded" ? "peek" : "expanded")}
      >
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={contentKey}
            className="absolute top-0 left-1/2"
            style={{ width: size.w, height: size.h, x: "-50%" }}
            initial={{ opacity: 0, scale: 0.94, filter: "blur(6px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.94, filter: "blur(6px)" }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <Content primary={primary} />
          </motion.div>
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>
        {bubbles.map((a, i) => (
          <Bubble key={a.id} activity={a} index={i} pillW={size.w} spring={spring} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function Bubble({ activity, index, pillW, spring }: { activity: Activity; index: number; pillW: number; spring: Transition }) {
  const artwork = useIsland((s) => (s.media ? s.artworks[s.media.trackKey] : undefined));
  const accent = useAccent();
  const left = CANVAS_W / 2 + pillW / 2 + BUBBLE_GAP + index * (BUBBLE + BUBBLE_GAP);
  const { setHovered, setMode } = useIsland.getState();

  return (
    <motion.button
      type="button"
      aria-label={activity.kind}
      className="absolute grid place-items-center overflow-hidden rounded-full bg-black shadow-[0_4px_14px_rgba(0,0,0,.28),0_0_0_1px_rgba(255,255,255,.06)]"
      style={{ top: PILL_TOP, width: BUBBLE, height: BUBBLE }}
      initial={{ left: left - BUBBLE, scale: 0.4, opacity: 0 }}
      animate={{ left, scale: 1, opacity: 1 }}
      exit={{ left: left - BUBBLE, scale: 0.4, opacity: 0 }}
      transition={spring}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onClick={() => {
        // Promote this activity: dismiss whatever transient is covering it.
        useIsland.setState({ transient: null });
        setMode("expanded");
      }}
    >
      {activity.kind === "music" ? (
        artwork ? (
          <img src={artwork} alt="" className="h-[26px] w-[26px] rounded-full object-cover" draggable={false} />
        ) : (
          <NoteIcon size={15} style={{ color: accent }} />
        )
      ) : (
        <BoltIcon size={15} className={activity.kind === "charging" ? "text-ok" : "text-danger"} />
      )}
    </motion.button>
  );
}
