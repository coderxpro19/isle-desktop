import { dockTint } from "@/settings/themes";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getBackend } from "@/lib/backend";
import type { DockApp, Rect } from "@/lib/types";
import { DockMenu } from "./DockMenu";
import { Previews } from "./Previews";
import { TrayGroup, trayWidth } from "./Tray";
import { dockVisible, magnify, useDock } from "./store";

const PAD = 5; // horizontal padding around each icon
const SEP = 14; // separator slot width
const BAR_PAD_Y = 8;
const BOTTOM = 8;

/** Items along the bar, in order. */
type Item =
  | { kind: "start" }
  | { kind: "app"; app: DockApp }
  | { kind: "sep" }
  | { kind: "tray" }
  | { kind: "place"; place: "downloads" | "recycle" };

export function Dock() {
  useDockSync();
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 340 });
  useLayoutEffect(() => {
    const el = root.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const apps = useDock((s) => s.apps);
  const trayCount = useDock((s) => s.tray.length);
  const { iconSize, magnification, mode } = useDock((s) => s.settings.dock);
  const surface = useDock((s) => s.settings.appearance.surface);
  const iconOnly = useDock((s) => s.settings.dock.iconOnly);
  const hovered = useDock((s) => s.hovered);
  const overlap = useDock((s) => s.overlap);
  const menu = useDock((s) => s.menu);
  const preview = useDock((s) => s.preview);
  const visible = dockVisible(mode, { hovered, overlap, popupOpen: !!menu || !!preview });

  const items: Item[] = useMemo(() => {
    const pinned = apps.filter((a) => a.pinned);
    const running = apps.filter((a) => !a.pinned);
    return [
      { kind: "start" },
      { kind: "sep" },
      ...pinned.map((app) => ({ kind: "app" as const, app })),
      ...(running.length ? [{ kind: "sep" as const }, ...running.map((app) => ({ kind: "app" as const, app }))] : []),
      { kind: "sep" },
      ...(trayCount ? [{ kind: "tray" as const }, { kind: "sep" as const }] : []),
      { kind: "place", place: "downloads" },
      { kind: "place", place: "recycle" },
    ];
  }, [apps, trayCount]);

  // Base layout (no magnification) — distances are measured against it so the
  // effect never feeds back on itself.
  const slot = iconSize + PAD * 2;
  const baseWidths = items.map((it) => (it.kind === "sep" ? SEP : it.kind === "tray" ? trayWidth(trayCount) : slot));
  const baseTotal = baseWidths.reduce((a, b) => a + b, 0) + 16;
  const baseLeft = (size.w - baseTotal) / 2 + 8;
  const baseCentres = baseWidths.map((_, i) => baseLeft + baseWidths.slice(0, i).reduce((a, b) => a + b, 0) + baseWidths[i]! / 2);

  const [pointerX, setPointerX] = useState<number | null>(null);
  const raf = useRef(0);
  const onMove = (e: React.PointerEvent) => {
    const x = e.clientX - (root.current?.getBoundingClientRect().left ?? 0);
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => setPointerX(x));
  };
  const scales = items.map((it, i) =>
    it.kind === "sep" || it.kind === "tray" || pointerX === null || !magnification || menu ? 1 : magnify(Math.abs(baseCentres[i]! - pointerX), iconSize),
  );

  const barH = iconSize + BAR_PAD_Y * 2;
  const bar = useRef<HTMLDivElement>(null);
  useHitRects(root, bar, { visible, extraAbove: magnification && hovered ? iconSize * 0.6 : 0 }, [items.length, scales.join(","), menu, preview, size.w]);

  return (
    <div ref={root} style={{ ["--isle-dock" as string]: dockTint(surface) }} data-dock-root className="relative h-full w-full select-none" onContextMenu={(e) => e.preventDefault()}>
      {preview && <Previews popup={preview} canvasW={size.w} bottom={barH + BOTTOM + 14} />}
      {menu && <DockMenu popup={menu} canvasW={size.w} bottom={barH + BOTTOM + 14} />}
      <div
        ref={bar}
        data-dock-bar
        className={`absolute left-1/2 flex items-end rounded-[20px] px-2 ${
          iconOnly
            ? "border border-transparent [filter:drop-shadow(0_2px_6px_rgba(0,0,0,.35))]"
            : "border border-white/10 bg-[color-mix(in_srgb,var(--isle-dock,#141418)_78%,transparent)] shadow-[0_10px_40px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
        }`}
        style={{
          bottom: BOTTOM,
          height: barH,
          transform: `translateX(-50%) translateY(${visible ? 0 : barH + BOTTOM + 6}px)`,
          transition: "transform 260ms cubic-bezier(.2,.8,.2,1)",
        }}
        onPointerMove={onMove}
        onPointerEnter={() => useDock.getState().backend?.kind === "mock" && useDock.setState({ hovered: true })}
        onPointerLeave={() => {
          setPointerX(null);
          if (useDock.getState().backend?.kind === "mock") useDock.setState({ hovered: false });
        }}
      >
        {items.map((it, i) => {
          const scale = scales[i]!;
          if (it.kind === "tray")
            return (
              <div key="tray" className="flex shrink-0 items-end" style={{ width: baseWidths[i], paddingBottom: BAR_PAD_Y }}>
                <TrayGroup iconSize={iconSize} />
              </div>
            );
          if (it.kind === "sep") return <div key={`sep${i}`} className="mx-[6px] mb-[14px] h-[60%] w-px self-end bg-white/15" style={{ height: iconSize * 0.7 }} />;
          return (
            <Slot key={it.kind === "app" ? it.app.key : it.kind === "place" ? it.place : "start"} width={slot * scale - (scale - 1) * PAD * 2}>
              {it.kind === "start" && <StartButton size={iconSize * scale} />}
              {it.kind === "app" && <AppIcon app={it.app} size={iconSize * scale} centreX={baseCentres[i]!} />}
              {it.kind === "place" && <PlaceIcon place={it.place} size={iconSize * scale} centreX={baseCentres[i]!} />}
            </Slot>
          );
        })}
      </div>
    </div>
  );
}

function Slot({ width, children }: { width: number; children: ReactNode }) {
  return (
    <div className="relative flex shrink-0 justify-center" style={{ width, height: "100%", paddingBottom: BAR_PAD_Y }}>
      <div className="absolute flex flex-col items-center" style={{ bottom: BAR_PAD_Y }}>{children}</div>
    </div>
  );
}

/* ───────────────────────────── items ───────────────────────────── */

function Tooltip({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute bottom-full mb-3 rounded-lg bg-[rgba(20,20,24,0.92)] px-2.5 py-1 text-[12px] font-medium whitespace-nowrap text-white opacity-0 shadow-lg transition-opacity delay-200 group-hover:opacity-100">
      {label}
    </span>
  );
}

function AppIcon({ app, size, centreX }: { app: DockApp; size: number; centreX: number }) {
  const icon = useDock((s) => s.icons[app.key]);
  const loadIcon = useDock((s) => s.loadIcon);
  const backend = useDock((s) => s.backend);
  const launching = useDock((s) => !!s.launching[app.key]);
  const menuOpen = useDock((s) => !!s.menu);
  const previewKey = useDock((s) => s.preview?.key);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => loadIcon(app.key, app.exe), [app.key, app.exe, loadIcon]);

  const click = () => {
    useDock.setState({ preview: null });
    if (!backend) return;
    if (!app.running) {
      useDock.setState((s) => ({ launching: { ...s.launching, [app.key]: Date.now() } }));
      setTimeout(() => useDock.setState((s) => ({ launching: omit(s.launching, app.key) })), 6000);
      void backend.dockLaunch(app.key);
      return;
    }
    const wins = app.windows;
    if (app.active && wins.length === 1 && !wins[0]!.minimized) {
      void backend.dockWindow(wins[0]!.hwnd, "minimize");
    } else if (app.active && wins.length > 1) {
      // Cycle: bring the least-recent window forward.
      void backend.dockWindow(wins[wins.length - 1]!.hwnd, "activate");
    } else {
      void backend.dockWindow((wins.find((w) => !w.minimized) ?? wins[0]!).hwnd, "activate");
    }
  };

  return (
    <button
      type="button"
      aria-label={app.name}
      className="group relative flex flex-col items-center outline-none"
      onClick={click}
      onContextMenu={(e) => {
        e.preventDefault();
        useDock.setState({ menu: { key: app.key, x: centreX }, preview: null });
      }}
      onPointerEnter={() => {
        if (!app.running || menuOpen) return;
        if (previewKey) useDock.setState({ preview: { key: app.key, x: centreX } });
        else hoverTimer.current = setTimeout(() => useDock.setState({ preview: { key: app.key, x: centreX } }), 550);
      }}
      onPointerLeave={() => hoverTimer.current && clearTimeout(hoverTimer.current)}
    >
      {!previewKey && !menuOpen && <Tooltip label={app.name} />}
      <div className={launching && !app.running ? "isle-bounce" : ""} style={{ width: size, height: size }}>
        {icon ? (
          <img src={icon} alt="" draggable={false} className="h-full w-full object-contain drop-shadow-[0_3px_6px_rgba(0,0,0,0.35)] transition-transform active:scale-90" />
        ) : (
          <div className="grid h-full w-full place-items-center rounded-[22%] bg-white/10 text-[15px] font-semibold text-white/70">{app.name.slice(0, 1)}</div>
        )}
      </div>
      <span
        className={`absolute -bottom-[7px] h-[4px] rounded-full transition-all ${app.running ? (app.active ? "w-[14px] bg-white" : "w-[4px] bg-white/55") : "w-0 bg-transparent"}`}
      />
    </button>
  );
}

function StartButton({ size }: { size: number }) {
  const backend = useDock((s) => s.backend);
  return (
    <button type="button" aria-label="Start" className="group relative outline-none" onClick={() => void backend?.launcherToggle()}>
      <Tooltip label="Start" />
      <div className="grid place-items-center rounded-[24%] bg-gradient-to-b from-[#3d4a8f] to-[#1d2147] shadow-inner transition-transform active:scale-90" style={{ width: size, height: size }}>
        <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" aria-hidden>
          <rect x="3" y="7.5" width="18" height="7" rx="3.5" fill="#05060a" />
          <circle cx="7.3" cy="11" r="1.8" fill="#ffb15a" />
          <path d="M13.5 11h0M16 9.6v2.8M18.4 10.3v1.4" stroke="#9db4ff" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </div>
    </button>
  );
}

function PlaceIcon({ place, size, centreX }: { place: "downloads" | "recycle"; size: number; centreX: number }) {
  const backend = useDock((s) => s.backend);
  const items = useDock((s) => s.recycleItems);
  const label = place === "downloads" ? "Downloads" : items ? `Recycle Bin · ${items} item${items === 1 ? "" : "s"}` : "Recycle Bin";
  return (
    <button
      type="button"
      aria-label={label}
      className="group relative outline-none"
      onClick={() => void backend?.dockOpenPlace(place)}
      onContextMenu={(e) => {
        e.preventDefault();
        useDock.setState({ menu: { key: `place:${place}`, x: centreX }, preview: null });
      }}
    >
      <Tooltip label={label} />
      <div style={{ width: size, height: size }} className="transition-transform active:scale-90">
        {place === "downloads" ? <DownloadsGlyph /> : <BinGlyph full={items > 0} />}
      </div>
    </button>
  );
}

function DownloadsGlyph() {
  return (
    <svg viewBox="0 0 48 48" className="h-full w-full drop-shadow-[0_3px_6px_rgba(0,0,0,0.35)]">
      <defs>
        <linearGradient id="dl" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5fb6ff" />
          <stop offset="1" stopColor="#2a7de1" />
        </linearGradient>
      </defs>
      <path d="M5 13a4 4 0 0 1 4-4h9l4 4h17a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4Z" fill="url(#dl)" />
      <path d="M24 18v11m-5-4.5 5 5 5-5" stroke="white" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BinGlyph({ full }: { full: boolean }) {
  return (
    <svg viewBox="0 0 48 48" className="h-full w-full drop-shadow-[0_3px_6px_rgba(0,0,0,0.35)]">
      <defs>
        <linearGradient id="bin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e9edf3" />
          <stop offset="1" stopColor="#b6bfcc" />
        </linearGradient>
      </defs>
      {full && <path d="M15 12c3-4 6 1 9-3s6 1 9-2l1 6H14Z" fill="#8fb8ff" />}
      <path d="M12 14h24l-2.4 25.2A3 3 0 0 1 30.6 42H17.4a3 3 0 0 1-3-2.8Z" fill="url(#bin)" />
      <rect x="10" y="11" width="28" height="4" rx="2" fill="#d5dbe4" />
      <path d="M20 20v16M24 20v16M28 20v16" stroke="#9aa5b5" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function omit<T>(rec: Record<string, T>, key: string): Record<string, T> {
  const next = { ...rec };
  delete next[key];
  return next;
}

/* ───────────────────────────── plumbing ───────────────────────────── */

function useDockSync() {
  useEffect(() => {
    let disposed = false;
    const offs: (() => void)[] = [];
    void getBackend().then(async (backend) => {
      if (disposed) return;
      useDock.setState({ backend });
      offs.push(
        backend.on("dock://apps", (apps) =>
          useDock.setState((s) => ({
            apps,
            // Stop bouncing once a launched app shows a window.
            launching: Object.fromEntries(Object.entries(s.launching).filter(([k]) => !apps.find((a) => a.key === k)?.running)),
          })),
        ),
        backend.on("dock://overlap", (overlap) => useDock.setState({ overlap })),
        backend.on("island://hover", (hovered) => useDock.setState({ hovered })),
        backend.on("settings://changed", (settings) => useDock.setState({ settings })),
        backend.on("tray://icons", (tray) => useDock.setState({ tray })),
      );
      const [settings, apps, places, tray] = await Promise.all([backend.getSettings(), backend.dockApps(), backend.dockPlaces(), backend.trayIcons()]);
      if (disposed) return;
      useDock.setState({ settings, apps, recycleItems: places.recycleBinItems, tray });
      requestAnimationFrame(() => requestAnimationFrame(() => void backend.ready()));
    });
    const places = setInterval(async () => {
      const b = useDock.getState().backend;
      if (b) useDock.setState({ recycleItems: (await b.dockPlaces()).recycleBinItems });
    }, 15_000);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && useDock.setState({ menu: null, preview: null });
    window.addEventListener("keydown", onKey);
    return () => {
      disposed = true;
      offs.forEach((f) => f());
      clearInterval(places);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Close popups when the cursor leaves the dock entirely.
  const hovered = useDock((s) => s.hovered);
  useEffect(() => {
    if (hovered) return;
    const t = setTimeout(() => useDock.setState({ preview: null, menu: null }), 350);
    return () => clearTimeout(t);
  }, [hovered]);
}

/**
 * Report interactive regions to the native hit tester: the bar (plus the
 * magnification zone while hovered) and any open popup. When the bar is
 * hidden, a 3 px strip along the bottom edge wakes it.
 */
function useHitRects(
  root: React.RefObject<HTMLDivElement | null>,
  bar: React.RefObject<HTMLDivElement | null>,
  opts: { visible: boolean; extraAbove: number },
  deps: unknown[],
) {
  const backend = useDock((s) => s.backend);
  const last = useRef("");
  const report = useCallback(() => {
    const r = root.current, b = bar.current;
    if (!backend || !r || !b) return;
    const o = r.getBoundingClientRect();
    const rel = (d: DOMRect): Rect => ({ x: d.left - o.left, y: d.top - o.top, w: d.width, h: d.height });
    let rects: Rect[];
    if (!opts.visible) {
      rects = [{ x: 0, y: o.height - 3, w: o.width, h: 3 }];
    } else {
      const br = rel(b.getBoundingClientRect());
      rects = [{ ...br, y: br.y - opts.extraAbove, h: br.h + opts.extraAbove + BOTTOM }];
      r.querySelectorAll<HTMLElement>("[data-dock-popup]").forEach((el) => rects.push(rel(el.getBoundingClientRect())));
    }
    const json = JSON.stringify(rects.map((x) => [Math.round(x.x), Math.round(x.y), Math.round(x.w), Math.round(x.h)]));
    if (json !== last.current) {
      last.current = json;
      void backend.setHitRects(rects);
    }
  }, [backend, root, bar, opts.visible, opts.extraAbove]);

  useLayoutEffect(() => {
    report();
    // Catch the end of slide/magnify transitions.
    const t1 = setTimeout(report, 120);
    const t2 = setTimeout(report, 300);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, ...deps]);
}
