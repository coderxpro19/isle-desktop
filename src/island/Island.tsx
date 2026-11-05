import { AnimatePresence, motion, type Transition } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import type { Rect } from "@/lib/types";
import { BUBBLE, BUBBLE_GAP, CLOCK_KINDS, PILL_TOP, TAB_BAR_H, deriveActivities, pillSize, type Activity } from "./activities";
import { CompactContent, ExpandedContent, PeekContent, useAccent } from "./components/Contents";
import { BoltIcon, NoteIcon } from "./components/icons";
import { TabBar } from "./components/TabBar";
import { LiveBubbleIcon } from "./components/Live";
import { IslandMenu, MENU_H, MENU_W } from "./components/IslandMenu";
import { UPDATE_BANNER_H, useShowUpdateBanner } from "./components/UpdateBanner";
import {
  useBackendSync,
  useCalendar,
  useClipboard,
  useClockAlarms,
  useClockTicker,
  useNotifications,
  useHoverIntent,
  usePanelDemand,
  useTransientExpiry,
  useUpdater,
  useVisualizerDemand,
  useWeather,
} from "./hooks";
import { useIsland } from "./store";
import { useShelf } from "./shelf";
import { openNotice } from "./components/NotificationsPanel";

/** Width/height of the transparent island window (logical px). Mirrors island.rs. */
export const CANVAS_W = 680;
export const CANVAS_H = 440;

export function Island() {
  useBackendSync();
  useClockTicker();
  useHoverIntent();
  useTransientExpiry();
  useVisualizerDemand();
  usePanelDemand();
  useWeather();
  useUpdater();
  useClockAlarms();
  useCalendar();
  useNotifications();
  useClipboard();
  useShelf();

  const mode = useIsland((s) => s.mode);
  const media = useIsland((s) => s.media);
  const pausedAt = useIsland((s) => s.pausedAt);
  const transient = useIsland((s) => s.transient);
  const clock = useIsland((s) => s.clock);
  const events = useIsland((s) => s.events);
  const now = useIsland((s) => s.now);
  const backend = useIsland((s) => s.backend);
  const tab = useIsland((s) => s.tab);
  const { cornerRadius, reduceMotion } = useIsland((s) => s.settings.appearance);
  const { setHovered, setMode } = useIsland.getState();

  const activities = useMemo(
    () => deriveActivities({ media, pausedAt, transient, clock, events }, Date.now()),
    // `now` re-evaluates lingering paused activities / upcoming events every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [media, pausedAt, transient, clock, events, now],
  );
  const primary = activities[0]?.kind ?? null;
  const bubbles = activities.slice(1, 3);
  const controlsView = useIsland((s) => s.controlsView);
  const base = pillSize(mode, primary, cornerRadius, tab);
  // Wi-Fi / Bluetooth lists get extra room.
  const banner = useShowUpdateBanner();
  const size =
    mode === "expanded" && tab === "controls" && controlsView !== "main"
      ? { ...base, h: TAB_BAR_H + 316 }
      : mode === "expanded" && tab === "home" && banner
        ? { ...base, h: base.h + UPDATE_BANNER_H }
        : base;

  const spring: Transition = reduceMotion
    ? { duration: 0 }
    : { type: "spring", visualDuration: 0.42, bounce: mode === "compact" ? 0.18 : 0.3 };

  const menuOpen = useIsland((s) => s.islandMenu);
  // Below the pill; clamp so it fits in the canvas when the island is expanded.
  const menuTop = Math.min(PILL_TOP + size.h + 8, CANVAS_H - MENU_H - 4);

  // Report interactive regions (at their *target* geometry) to the native hit tester.
  const lastRects = useRef("");
  useEffect(() => {
    if (!backend) return;
    const pillX = (CANVAS_W - size.w) / 2;
    const rects: Rect[] = [{ x: pillX, y: PILL_TOP, w: size.w, h: size.h }];
    bubbles.forEach((_, i) =>
      rects.push({ x: pillX + size.w + BUBBLE_GAP + i * (BUBBLE + BUBBLE_GAP), y: PILL_TOP, w: BUBBLE, h: BUBBLE }),
    );
    if (menuOpen) rects.push({ x: (CANVAS_W - MENU_W) / 2, y: menuTop, w: MENU_W, h: MENU_H });
    const json = JSON.stringify(rects);
    if (json !== lastRects.current) {
      lastRects.current = json;
      void backend.setHitRects(rects);
    }
  }, [backend, size.w, size.h, bubbles, menuOpen, menuTop]);

  // Show the native window only once something has painted.
  useEffect(() => {
    if (!backend) return;
    requestAnimationFrame(() => requestAnimationFrame(() => void backend.ready()));
  }, [backend]);

  const expanded = mode === "expanded";
  const contentKey = expanded ? `expanded:${tab}:${tab === "home" ? (primary ?? "idle") : ""}` : `${mode}:${primary ?? "idle"}`;
  const contentTop = expanded ? TAB_BAR_H : 0;

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
        onContextMenu={(e) => {
          e.preventDefault();
          useIsland.setState({ islandMenu: !useIsland.getState().islandMenu });
        }}
        onClick={() => {
          if (useIsland.getState().islandMenu) return useIsland.setState({ islandMenu: false });
          if (mode === "expanded") return;
          // An update alert hands over to the banner on the Home tab.
          const tk = useIsland.getState().transient?.kind;
          if (tk === "update") useIsland.setState({ transient: null, tab: "home" });
          else if (tk === "hud") useIsland.setState({ transient: null });
          else if (tk === "notification") {
            const t = useIsland.getState().transient;
            if (t?.kind === "notification") return openNotice(t.notice);
          }
          else if (primary && CLOCK_KINDS.includes(primary)) openClockFor(primary);
          setMode("expanded");
        }}
      >
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="tabs"
              className="absolute inset-x-0 top-0 z-10"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6, transition: { duration: 0.1 } }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.22, delay: 0.06 }}
            >
              <TabBar />
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={contentKey}
            className="absolute left-1/2"
            style={{ top: contentTop, width: size.w, height: size.h - contentTop, x: "-50%" }}
            initial={{ opacity: 0, scale: 0.94, filter: "blur(6px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.94, filter: "blur(6px)" }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {expanded ? (
              <ExpandedContent primary={primary} tab={tab} />
            ) : mode === "peek" ? (
              <PeekContent primary={primary} />
            ) : (
              <CompactContent primary={primary} />
            )}
          </motion.div>
        </AnimatePresence>
      </motion.div>

      {menuOpen && <IslandMenu top={menuTop} />}

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
        if (CLOCK_KINDS.includes(activity.kind)) openClockFor(activity.kind);
        setMode("expanded");
      }}
    >
      {activity.kind === "music" ? (
        artwork ? (
          <img src={artwork} alt="" className="h-[26px] w-[26px] rounded-full object-cover" draggable={false} />
        ) : (
          <NoteIcon size={15} style={{ color: accent }} />
        )
      ) : activity.kind === "charging" || activity.kind === "lowBattery" ? (
        <BoltIcon size={15} className={activity.kind === "charging" ? "text-ok" : "text-danger"} />
      ) : (
        <LiveBubbleIcon kind={activity.kind} />
      )}
    </motion.button>
  );
}

function openClockFor(kind: Activity["kind"]) {
  const clockView = kind === "event" ? "calendar" : kind === "pomodoro" ? "focus" : kind === "stopwatch" ? "stopwatch" : "timer";
  useIsland.setState({ tab: "clock", clockView, transient: kind === "timerDone" ? null : useIsland.getState().transient });
}
