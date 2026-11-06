import { useEffect, useRef, useState, type ReactNode } from "react";
import { getBackend, isTauri, type Backend } from "@/lib/backend";
import { DEFAULT_SETTINGS, type DockMode, type NotchBehavior, type Settings, type UpdateInfo, type WidgetId } from "@/lib/types";
import { WIDGETS } from "@/island/components/Header";
import { THEMES, ACCENTS, themeOf } from "./themes";

type Section = "general" | "appearance" | "notch" | "dock" | "overlays" | "calendar" | "about";
const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: "general", label: "General", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19 12l2-1-1-3-2 .2-1.3-1.3L17 5l-3-1-1 2h-2L10 4 7 5l.3 2L6 8.3 4 8l-1 3 2 1v1.9L3 15l1 3 2-.2L7.3 19 7 21l3 1 1-2h2l1 2 3-1-.3-2 1.3-1.2 2 .2 1-3-2-1Z" },
  { id: "appearance", label: "Appearance", icon: "M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.3-1.7-.4-1.1.4-2.3 1.6-2.3H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10ZM7.5 11h.01M10 7.5h.01M14.5 7.5h.01" },
  { id: "notch", label: "Notch", icon: "M4 5h16v14H4zM4 9h16M9 5v1.5a1.5 1.5 0 0 0 1.5 1.5h3A1.5 1.5 0 0 0 15 6.5V5" },
  { id: "dock", label: "Dock", icon: "M4 5h16v11H4zM8 20h8M12 16v4" },
  { id: "overlays", label: "Overlays", icon: "M12 4 3 9l9 5 9-5-9-5ZM3 14l9 5 9-5" },
  { id: "calendar", label: "Calendar", icon: "M5 6h14v13H5zM5 10h14M9 4v4M15 4v4" },
  { id: "about", label: "About", icon: "M12 8h.01M11 12h1v5h1M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" },
];

export function SettingsApp() {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [s, setS] = useState<Settings | null>(null);
  const [section, setSection] = useState<Section>(() => {
    const q = new URLSearchParams(location.search).get("section") as Section | null;
    return q && SECTIONS.some((x) => x.id === q) ? q : "general";
  });

  useEffect(() => {
    let offs: (() => void)[] = [];
    void getBackend().then(async (b) => {
      setBackend(b);
      setS(await b.getSettings());
      offs = [b.on("settings://changed", setS)];
    });
    let offSection: (() => void) | undefined;
    if (isTauri())
      void import("@tauri-apps/api/event")
        .then(({ listen }) => listen<string>("settings://section", (e) => setSection(e.payload as Section)))
        .then((u) => (offSection = u))
        .catch(() => {});
    return () => {
      offs.forEach((o) => o());
      offSection?.();
    };
  }, []);

  if (!backend || !s) return <div className="h-full bg-[var(--bg)]" />;

  const update = (f: (s: Settings) => Settings) => {
    const next = f(s);
    setS(next);
    void backend.setSettings(next);
  };

  return (
    <div className="isle-settings flex h-full flex-col overflow-hidden text-[13px] text-[var(--fg)]">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[200px] shrink-0 flex-col gap-1 border-r border-[var(--line)] px-3 pt-1 pb-4">
          {SECTIONS.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setSection(x.id)}
              className={`flex h-9 items-center gap-3 rounded-lg px-3 text-left font-medium transition-colors ${
                section === x.id ? "bg-[var(--sel)] text-[var(--fg)]" : "text-[var(--dim)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d={x.icon} />
              </svg>
              {x.label}
            </button>
          ))}
        </nav>
        <main className="isle-scroll min-w-0 flex-1 overflow-y-auto px-7 pt-2 pb-8">
          <div className="mx-auto max-w-[600px]">
            {section === "general" && <General s={s} update={update} backend={backend} />}
            {section === "appearance" && <AppearanceSection s={s} update={update} />}
            {section === "notch" && <NotchSection s={s} update={update} />}
            {section === "dock" && <DockSection s={s} update={update} />}
            {section === "overlays" && <OverlaysSection s={s} update={update} />}
            {section === "calendar" && <CalendarSection s={s} update={update} />}
            {section === "about" && <About backend={backend} onImported={setS} />}
          </div>
        </main>
      </div>
    </div>
  );
}

function TitleBar() {
  const close = () => {
    if (isTauri()) void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().close());
    else window.close();
  };
  return (
    <div data-tauri-drag-region className="flex h-12 shrink-0 items-center justify-between px-5">
      <span data-tauri-drag-region className="text-[12px] font-bold tracking-[.12em] text-[var(--fg)]">
        SETTINGS
      </span>
      <button type="button" aria-label="Close" onClick={close} className="grid h-7 w-7 place-items-center rounded-full bg-[var(--well)] text-[var(--dim)] hover:bg-[#e5484d] hover:text-white">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}

type Props = { s: Settings; update: (f: (s: Settings) => Settings) => void };

/* ───────────── building blocks ───────────── */

function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      {title && <h2 className="mb-2 px-1 text-[11px] font-bold tracking-[.1em] text-[var(--head)] uppercase">{title}</h2>}
      <div className="divide-y divide-[var(--line)] overflow-hidden rounded-2xl bg-[var(--card)] ring-1 ring-[var(--line)]">{children}</div>
    </section>
  );
}

const ICONS: Record<string, string> = {
  power: "M12 3v8M6.3 6.3a8 8 0 1 0 11.4 0",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
  battery: "M3 8h15v8H3zM21 11v2",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z",
  full: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  reset: "M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5",
  quit: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
  update: "M12 4v12M7 11l5 5 5-5M5 20h14",
  layers: "M12 4 3 9l9 5 9-5-9-5ZM3 14l9 5 9-5",
  opacity: "M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z",
  corners: "M4 10V7a3 3 0 0 1 3-3h3M20 10V7a3 3 0 0 0-3-3h-3",
  radius: "M4 20V10a6 6 0 0 1 6-6h10",
  motion: "M4 12h4l3-7 4 14 3-7h2",
  palette: "M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.3-1.7-.4-1.1.4-2.3 1.6-2.3H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10Z",
  notch: "M4 5h16M8 5v2a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V5",
  hand: "M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V11m0-1a1.5 1.5 0 0 1 3 0v4a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3.3 14a1.5 1.5 0 0 1 2.4-1.8L8 15",
  timer: "M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 9v4M9.5 2.5h5",
  panel: "M4 5h16v14H4zM4 9h16",
  music: "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  compact: "M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7",
  bell: "M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15l1.5-2ZM10 20.5a2.2 2.2 0 0 0 4 0",
  clip: "M8 5h8v3H8zM6 6.5H5v14h14v-14h-1",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7l1-8Z",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2",
  speaker: "M11 5 6 9H3v6h3l5 4V5ZM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13",
  edgeL: "M4 4v16M9 12h11M13 8l-4 4 4 4",
  edgeR: "M20 4v16M15 12H4M11 8l4 4-4 4",
  dock: "M4 5h16v11H4zM8 20h8M12 16v4",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  size: "M4 20h16M7 16V9M12 16V5M17 16v-5",
  magnify: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3M11 8v6M8 11h6",
  bar: "M3 15h18v5H3z",
  weather: "M7 17h10a4 4 0 0 0 0-8 5 5 0 0 0-9.6 1.5A3.3 3.3 0 0 0 7 17Z",
  pin: "M12 21s-7-6.1-7-11a7 7 0 1 1 14 0c0 4.9-7 11-7 11ZM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  download: "M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14",
  upload: "M12 20V9M7.5 13.5 12 9l4.5 4.5M5 5h14",
};

function Row({ icon, label, hint, children, danger }: { icon?: string; label: string; hint?: string; children?: ReactNode; danger?: boolean }) {
  return (
    <div className="flex min-h-[54px] items-center gap-3.5 px-4 py-2.5">
      {icon && (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--dim)]">
          <path d={ICONS[icon] ?? icon} />
        </svg>
      )}
      <div className="min-w-0 flex-1">
        <div className={`font-semibold ${danger ? "text-[#ff5a52]" : ""}`}>{label}</div>
        {hint && <div className="mt-0.5 text-[11.5px] leading-snug text-[var(--dim)]">{hint}</div>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange(v: boolean): void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-[24px] w-[44px] rounded-full transition-colors ${on ? "bg-[var(--on)]" : "bg-[var(--off)]"}`}
    >
      <span className="absolute top-[3px] left-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-transform" style={{ transform: on ? "translateX(20px)" : "none" }} />
    </button>
  );
}

function Segmented<T extends string | number>({ value, options, onChange, disabled }: { value: T; options: [T, string][]; onChange(v: T): void; disabled?: boolean }) {
  return (
    <div className={`flex rounded-lg bg-[var(--well)] p-0.5 ${disabled ? "pointer-events-none opacity-40" : ""}`}>
      {options.map(([v, l]) => (
        <button
          key={String(v)}
          type="button"
          onClick={() => onChange(v)}
          className={`rounded-md px-3 py-1 text-[12px] font-medium whitespace-nowrap ${v === value ? "bg-[var(--seg)] text-[var(--fg)] shadow-sm" : "text-[var(--dim)] hover:text-[var(--fg)]"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function Range({ value, min, max, step = 1, onChange, unit = "" }: { value: number; min: number; max: number; step?: number; onChange(v: number): void; unit?: string }) {
  return (
    <div className="flex items-center gap-3">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="isle-range w-36" />
      <span className="w-14 text-right text-[11.5px] text-[var(--dim)] tabular-nums">
        {value}
        {unit}
      </span>
    </div>
  );
}

function Button({ children, onClick, primary, danger, disabled }: { children: ReactNode; onClick(): void; primary?: boolean; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`h-8 rounded-lg px-4 text-[12px] font-semibold transition-colors disabled:opacity-40 ${
        primary ? "bg-white text-black hover:bg-white/85" : danger ? "bg-[#e5484d]/15 text-[#ff6b6b] hover:bg-[#e5484d]/25" : "bg-[var(--well)] hover:bg-[var(--hover)]"
      }`}
    >
      {children}
    </button>
  );
}

const islandSet = (update: Props["update"]) => (patch: Partial<Settings["island"]>) => update((x) => ({ ...x, island: { ...x.island, ...patch } }));

/* ───────────── General ───────────── */

function General({ s, update, backend }: Props & { backend: Backend }) {
  const set = islandSet(update);
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <>
      <Card title="System">
        <Row icon="power" label="Launch at Login" hint="Open Isle automatically when you sign in.">
          <Switch on={s.general.startWithWindows} onChange={(v) => update((x) => ({ ...x, general: { ...x.general, startWithWindows: v } }))} />
        </Row>
        <Row icon="clock" label="24-Hour Time" hint="Use the 24-hour clock format.">
          <Switch on={s.island.clock24h} onChange={(clock24h) => set({ clock24h })} />
        </Row>
        <Row icon="clock" label="Show Seconds">
          <Switch on={s.island.showSeconds} onChange={(showSeconds) => set({ showSeconds })} />
        </Row>
        <Row icon="bolt" label="Battery Alerts" hint="Show charging and low-battery alerts on the notch.">
          <Switch on={s.island.chargingActivity} onChange={(chargingActivity) => set({ chargingActivity })} />
        </Row>
        <Row icon="full" label="Hide in Full Screen" hint="Get out of the way of games and videos.">
          <Switch on={s.island.hideInFullscreen} onChange={(hideInFullscreen) => set({ hideInFullscreen })} />
        </Row>
        <Row icon="moon" label="Focus Mode" hint="Silence pop-ups and alerts.">
          <Switch on={s.island.focusMode} onChange={(focusMode) => set({ focusMode })} />
        </Row>
      </Card>
      <Card title="App">
        <Row icon="reset" label="Reset to Defaults" hint="Restore all settings. Pinned apps and calendars are cleared too." danger>
          {confirmReset ? (
            <span className="flex gap-2">
              <Button onClick={() => setConfirmReset(false)}>Cancel</Button>
              <Button
                danger
                onClick={() => {
                  update(() => structuredClone(DEFAULT_SETTINGS));
                  setConfirmReset(false);
                }}
              >
                Reset
              </Button>
            </span>
          ) : (
            <Button onClick={() => setConfirmReset(true)}>Reset…</Button>
          )}
        </Row>
        <Row icon="reset" label="Restart Isle" hint="Reload the notch, dock and overlays.">
          <Button onClick={() => void backend.reload()}>Restart</Button>
        </Row>
        <Row icon="quit" label="Quit Isle" hint="Your taskbar comes back." danger>
          <Button danger onClick={() => void backend.quit()}>
            Quit
          </Button>
        </Row>
      </Card>
    </>
  );
}

/* ───────────── Appearance ───────────── */

function AppearanceSection({ s, update }: Props) {
  const a = s.appearance;
  const set = (patch: Partial<Settings["appearance"]>) => update((x) => ({ ...x, appearance: { ...x.appearance, ...patch } }));
  const current = themeOf(a);
  return (
    <>
      <Card title="Theme">
        <div className="grid grid-cols-3 gap-3 p-4">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => set({ surface: t.surface, accent: t.accent })}
              className={`overflow-hidden rounded-xl text-left ring-2 transition ${current === t.id ? "ring-white" : "ring-transparent hover:ring-[var(--line)]"}`}
            >
              <div className="relative h-[64px]" style={{ background: t.wall }}>
                <div className="absolute top-0 left-1/2 flex h-[16px] w-[64px] -translate-x-1/2 items-center justify-center rounded-b-[8px]" style={{ background: t.surface }}>
                  <span className="h-1.5 w-6 rounded-full bg-white/80" />
                </div>
                <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
                  {[0, 1, 2, 3].map((i) => (
                    <span key={i} className="h-2.5 w-2.5 rounded-[3px] bg-white/70" />
                  ))}
                </div>
              </div>
              <div className="bg-[var(--well)] px-2.5 py-1.5 text-[11.5px] font-semibold">{t.name}</div>
            </button>
          ))}
        </div>
        <Row icon="palette" label="Accent Colour" hint="Sliders, visualiser and highlights.">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => set({ accent: "artwork" })}
              className={`h-6 rounded-full bg-[var(--well)] px-2.5 text-[11px] ring-2 ${a.accent === "artwork" ? "ring-white" : "ring-transparent"}`}
            >
              Album art
            </button>
            {ACCENTS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => set({ accent: c })}
                className={`h-6 w-6 rounded-full ring-2 ring-offset-2 ring-offset-[var(--card)] ${a.accent === c ? "ring-white" : "ring-transparent"}`}
                style={{ background: c }}
              />
            ))}
            <label className="relative h-6 w-6 cursor-pointer overflow-hidden rounded-full bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]" title="Custom colour">
              <input type="color" value={a.accent.startsWith("#") ? a.accent : "#5aa2ff"} onChange={(e) => set({ accent: e.target.value })} className="absolute inset-0 opacity-0" />
            </label>
          </div>
        </Row>
        <Row icon="palette" label="Notch Colour">
          <label className="relative block h-7 w-7 cursor-pointer overflow-hidden rounded-full ring-2 ring-[var(--line)]" style={{ background: a.surface }}>
            <input type="color" value={a.surface} onChange={(e) => set({ surface: e.target.value })} className="absolute inset-0 opacity-0" />
          </label>
        </Row>
        <Row icon="opacity" label="Background Opacity" hint={`Notch and dock transparency (${Math.round(a.backgroundOpacity * 100)}%).`}>
          <Range value={Math.round(a.backgroundOpacity * 100)} min={50} max={100} step={5} onChange={(v) => set({ backgroundOpacity: v / 100 })} unit="%" />
        </Row>
      </Card>
      <Card title="Display">
        <Row icon="corners" label="Screen Corners" hint="Rounded top edges of the screen.">
          <Switch on={a.screenCorners} onChange={(screenCorners) => set({ screenCorners })} />
        </Row>
        <Row icon="radius" label="Corner Roundness" hint="How round the open notch is.">
          <Range value={a.cornerRadius} min={12} max={32} onChange={(cornerRadius) => set({ cornerRadius })} unit="px" />
        </Row>
        <Row icon="motion" label="Reduce Motion" hint="Fewer springy animations.">
          <Switch on={a.reduceMotion} onChange={(reduceMotion) => set({ reduceMotion })} />
        </Row>
      </Card>
    </>
  );
}

/* ───────────── Notch ───────────── */

function NotchSection({ s, update }: Props) {
  const isl = s.island;
  const set = islandSet(update);
  return (
    <>
      <Card title="Notch">
        <Row icon="notch" label="Style" hint="Flush with the top edge, or a floating pill.">
          <Segmented
            value={isl.notchStyle}
            options={[
              ["notch", "Notch"],
              ["floating", "Floating"],
            ]}
            onChange={(notchStyle) => set({ notchStyle })}
          />
        </Row>
        <Row icon="hand" label="Notch Behavior" hint="Smart: hover peeks, click opens. Hover: opens on hover. Click: only on click.">
          <Segmented<NotchBehavior>
            value={isl.notchBehavior}
            options={[
              ["smart", "Smart"],
              ["hover", "Hover"],
              ["click", "Click"],
            ]}
            onChange={(notchBehavior) => set({ notchBehavior })}
          />
        </Row>
        <Row icon="timer" label="Peek Delay" hint={`Rest on the notch for ${isl.peekDelayMs}ms to reveal.`}>
          <Range value={isl.peekDelayMs} min={0} max={800} step={50} onChange={(peekDelayMs) => set({ peekDelayMs })} unit="ms" />
        </Row>
        <Row icon="panel" label="Remember Last Panel" hint="Reopen the page you last used; off always opens the Control Centre.">
          <Switch on={isl.rememberPanel} onChange={(rememberPanel) => set({ rememberPanel })} />
        </Row>
        {isl.notchStyle === "floating" && (
          <Row icon="notch" label="Distance from Top">
            <Range value={isl.topOffset} min={0} max={40} onChange={(topOffset) => set({ topOffset })} unit="px" />
          </Row>
        )}
      </Card>
      <Card title="Live Activities">
        <Row icon="music" label="Music Visualiser" hint="Live bars that move with your music.">
          <Switch on={isl.visualizer} onChange={(visualizer) => set({ visualizer })} />
        </Row>
        <Row icon="compact" label="Compact Mode" hint="Show visualiser and artwork when collapsed.">
          <Switch on={isl.compactMode} onChange={(compactMode) => set({ compactMode })} />
        </Row>
        <Row icon="bell" label="Notification Pop-ups" hint="New Windows notifications drop down from the notch.">
          <Switch on={isl.notifications} onChange={(notifications) => set({ notifications })} />
        </Row>
        <Row icon="clip" label="Clipboard History" hint="Remembers what you copy. Alt+Shift+V opens it.">
          <Switch on={isl.clipboardHistory} onChange={(clipboardHistory) => set({ clipboardHistory })} />
        </Row>
      </Card>
      <Card title="Weather">
        <Row icon="weather" label="Temperature Unit">
          <Segmented
            value={s.weather.fahrenheit ? "f" : "c"}
            options={[
              ["c", "°C"],
              ["f", "°F"],
            ]}
            onChange={(v) => update((x) => ({ ...x, weather: { ...x.weather, fahrenheit: v === "f" } }))}
          />
        </Row>
        <Row icon="pin" label="Location" hint={s.weather.location ? s.weather.location.name : "Automatic. Pick a city on the notch's Weather page."}>
          {s.weather.location && <Button onClick={() => update((x) => ({ ...x, weather: { ...x.weather, location: null } }))}>Use automatic</Button>}
        </Row>
      </Card>
      <Card title="Widgets">
        <WidgetSide label="Left" side="widgetsLeft" s={s} update={update} />
        <WidgetSide label="Right" side="widgetsRight" s={s} update={update} />
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-3">
          <span className="mr-1 text-[11px] font-bold tracking-wider text-[var(--dim)]">ADD</span>
          {WIDGETS.filter((w) => !isl.widgetsLeft.includes(w.id) && !isl.widgetsRight.includes(w.id)).map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => set(isl.widgetsLeft.length <= isl.widgetsRight.length ? { widgetsLeft: [...isl.widgetsLeft, w.id] } : { widgetsRight: [...isl.widgetsRight, w.id] })}
              className="h-7 rounded-lg bg-[var(--well)] px-2.5 text-[11.5px] font-semibold hover:bg-[var(--hover)]"
            >
              + {w.label}
            </button>
          ))}
        </div>
      </Card>
    </>
  );
}

function WidgetSide({ label, side, s, update }: Props & { label: string; side: "widgetsLeft" | "widgetsRight" }) {
  const list = s.island[side];
  const other = side === "widgetsLeft" ? "widgetsRight" : "widgetsLeft";
  const set = islandSet(update);
  const move = (i: number, d: -1 | 1) => {
    const next = [...list];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    set({ [side]: next });
  };
  return (
    <div className="flex min-h-[50px] flex-wrap items-center gap-1.5 px-4 py-2.5">
      <span className="mr-2 w-10 text-[11px] font-bold tracking-wider text-[var(--dim)]">{label.toUpperCase()}</span>
      {list.length === 0 && <span className="text-[11.5px] text-[var(--dim)]">Nothing here</span>}
      {list.map((id: WidgetId, i) => (
        <span key={id} className="flex h-7 items-center gap-1 rounded-lg bg-[var(--well)] pr-1 pl-2.5 text-[11.5px] font-semibold">
          {WIDGETS.find((w) => w.id === id)?.label ?? id}
          <Mini label="Move left" disabled={i === 0} onClick={() => move(i, -1)}>
            ‹
          </Mini>
          <Mini label="Move right" disabled={i === list.length - 1} onClick={() => move(i, 1)}>
            ›
          </Mini>
          <Mini label={`Move to ${other === "widgetsLeft" ? "left" : "right"} side`} onClick={() => set({ [side]: list.filter((x) => x !== id), [other]: [...s.island[other], id] })}>
            ⇄
          </Mini>
          <Mini label="Remove" onClick={() => set({ [side]: list.filter((x) => x !== id) })}>
            ×
          </Mini>
        </span>
      ))}
    </div>
  );
}

function Mini({ label, onClick, disabled, children }: { label: string; onClick(): void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick} className="grid h-5 w-5 place-items-center rounded text-[13px] leading-none text-[var(--dim)] hover:bg-[var(--hover)] hover:text-[var(--fg)] disabled:opacity-25">
      {children}
    </button>
  );
}

/* ───────────── Dock ───────────── */

function DockSection({ s, update }: Props) {
  const d = s.dock;
  const set = (patch: Partial<Settings["dock"]>) => update((x) => ({ ...x, dock: { ...x.dock, ...patch } }));
  return (
    <Card title="Dock">
      <Row icon="dock" label="Isle Dock" hint="Replace the Windows taskbar with Isle's dock.">
        <Switch on={d.enabled && d.replaceTaskbar} onChange={(on) => set({ enabled: on, replaceTaskbar: on })} />
      </Row>
      <Row icon="eye" label="Behavior" hint="Fixed: always shown. Smart: hides when a window needs the space. Peek: slides away until you touch the bottom edge.">
        <Segmented<DockMode>
          value={d.mode}
          disabled={!d.enabled}
          options={[
            ["fixed", "Fixed"],
            ["smart", "Smart"],
            ["autoHide", "Peek"],
          ]}
          onChange={(mode) => set({ mode })}
        />
      </Row>
      <Row icon="bar" label="Icon Only" hint="Remove the bar background behind the icons.">
        <Switch on={d.iconOnly} onChange={(iconOnly) => set({ iconOnly })} />
      </Row>
      <Row icon="size" label="Icon Size">
        <Range value={d.iconSize} min={24} max={64} step={2} onChange={(iconSize) => set({ iconSize })} unit="px" />
      </Row>
      <Row icon="magnify" label="Magnify on Hover">
        <Switch on={d.magnification} onChange={(magnification) => set({ magnification })} />
      </Row>
      <Row icon="dock" label="Show the Dock without Replacing the Taskbar" hint="Keep both.">
        <Switch on={d.enabled && !d.replaceTaskbar} onChange={(on) => set(on ? { enabled: true, replaceTaskbar: false } : { replaceTaskbar: true })} />
      </Row>
    </Card>
  );
}

/* ───────────── Overlays ───────────── */

function OverlaysSection({ s, update }: Props) {
  const o = s.overlays;
  const set = (patch: Partial<Settings["overlays"]>) => update((x) => ({ ...x, overlays: { ...x.overlays, ...patch } }));
  return (
    <Card title="Overlays">
      <Row icon="speaker" label="Volume HUD" hint="Isle's volume overlay replaces the Windows one.">
        <Switch on={s.island.volumeHud} onChange={(volumeHud) => update((x) => ({ ...x, island: { ...x.island, volumeHud } }))} />
      </Row>
      <Row icon="edgeL" label="Show on Edge Hover" hint="Slide in from the left edge.">
        <Switch on={o.volumeEdge} onChange={(volumeEdge) => set({ volumeEdge })} />
      </Row>
      <Row icon="sun" label="Brightness HUD" hint="Isle brightness overlay.">
        <Switch on={o.brightnessHud} onChange={(brightnessHud) => set({ brightnessHud })} />
      </Row>
      <Row icon="edgeR" label="Show on Edge Hover" hint="Slide in from the right edge.">
        <Switch on={o.brightnessEdge} onChange={(brightnessEdge) => set({ brightnessEdge })} />
      </Row>
    </Card>
  );
}

/* ───────────── Calendar ───────────── */

const FEED_COLORS = ["#5aa2ff", "#ff6b5e", "#4cd97b", "#ffb340", "#a597ff", "#ff7ac6"];

function CalendarSection({ s, update }: Props) {
  const feeds = s.calendar.feeds;
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const valid = /^(https?|webcal):\/\/\S+$/i.test(url.trim()) && !feeds.some((f) => f.url === url.trim());
  const save = (next: typeof feeds) => update((x) => ({ ...x, calendar: { ...x.calendar, feeds: next } }));
  return (
    <>
      <Card title="Calendars">
        {feeds.length === 0 && <div className="px-4 py-4 text-[12px] text-[var(--dim)]">No calendars yet.</div>}
        {feeds.map((f) => (
          <div key={f.url} className="flex items-center gap-3 px-4 py-3">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: f.color }} />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{f.name}</div>
              <div className="truncate text-[11px] text-[var(--dim)]">{f.url.replace(/(private-|secret)[^/]*/i, "$1…")}</div>
            </div>
            <Button danger onClick={() => save(feeds.filter((x) => x.url !== f.url))}>
              Remove
            </Button>
          </div>
        ))}
      </Card>
      <Card title="Add a Calendar">
        <div className="space-y-3 p-4">
          <div className="text-[12px] leading-relaxed text-[var(--dim)]">
            Paste the calendar's iCal link. <b className="text-[var(--fg)]">Google:</b> Calendar settings → your calendar → “Secret address in iCal format”.{" "}
            <b className="text-[var(--fg)]">Outlook:</b> Settings → Calendar → Shared calendars → Publish → ICS.
          </div>
          <div className="flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="h-9 w-36 rounded-lg bg-[var(--well)] px-3 outline-none focus:ring-2 focus:ring-white/40" />
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… .ics" className="h-9 min-w-0 flex-1 rounded-lg bg-[var(--well)] px-3 outline-none focus:ring-2 focus:ring-white/40" />
            <Button
              primary
              disabled={!valid}
              onClick={() => {
                save([...feeds, { url: url.trim(), name: name.trim() || `Calendar ${feeds.length + 1}`, color: FEED_COLORS[feeds.length % FEED_COLORS.length]! }]);
                setUrl("");
                setName("");
              }}
            >
              Add
            </Button>
          </div>
        </div>
      </Card>
    </>
  );
}

/* ───────────── About ───────────── */

function About({ backend, onImported }: { backend: Backend; onImported(s: Settings): void }) {
  const [version, setVersion] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => void backend.appVersion().then(setVersion, () => {}), [backend]);
  return (
    <>
      <div className="flex flex-col items-center pt-4 pb-7">
        <div className="relative h-14 w-28">
          <div className="absolute inset-x-0 top-0 mx-auto h-8 w-24 rounded-b-[14px] bg-black ring-1 ring-white/15" />
          <span className="absolute top-3 left-1/2 h-2 w-10 -translate-x-1/2 rounded-full bg-white/85" />
        </div>
        <div className="text-[30px] font-black tracking-tight">Isle</div>
        <div className="mt-1 text-[11px] font-bold tracking-[.14em] text-[var(--dim)]">VERSION {version}</div>
      </div>
      <Updates backend={backend} />
      <Card title="Data">
        <Row icon="download" label="Export Settings" hint="Save every setting, pinned app and calendar to your Downloads folder.">
          <Button onClick={() => backend.settingsExport().then((p) => setMsg({ ok: true, text: `Saved to ${p}` }), (e) => setMsg({ ok: false, text: String(e) }))}>Export</Button>
        </Row>
        <Row icon="upload" label="Import Settings" hint="Restore a file you exported, on this PC or another one.">
          <>
            <input
              ref={file}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                try {
                  onImported(await backend.settingsImport(await f.text()));
                  setMsg({ ok: true, text: "Settings imported." });
                } catch (err) {
                  setMsg({ ok: false, text: String(err).replace(/^Error:\s*/, "") });
                }
              }}
            />
            <Button onClick={() => file.current?.click()}>Import</Button>
          </>
        </Row>
      </Card>
      {msg && <div className={`rounded-lg px-4 py-2.5 text-[12px] ${msg.ok ? "bg-[#30a46c]/15 text-[#5bd39a]" : "bg-[#e5484d]/15 text-[#ff8a8a]"}`}>{msg.text}</div>}
      <div className="mt-4 text-center text-[11px] text-[var(--dim)]">Alt+Shift+V clipboard · Esc closes the notch</div>
    </>
  );
}

function Updates({ backend }: { backend: Backend }) {
  const [st, setSt] = useState<{ k: "idle" | "checking" | "none" | "error" } | { k: "available"; info: UpdateInfo } | { k: "installing"; p: number | null }>({ k: "idle" });
  const check = () => {
    setSt({ k: "checking" });
    backend.checkUpdate().then(
      (info) => setSt(info ? { k: "available", info } : { k: "none" }),
      () => setSt({ k: "error" }),
    );
  };
  const text =
    st.k === "checking"
      ? "Checking…"
      : st.k === "none"
        ? "Isle is up to date."
        : st.k === "error"
          ? "Couldn't check. Check your connection and try again."
          : st.k === "available"
            ? `Isle ${st.info.version} is available.`
            : st.k === "installing"
              ? st.p === 1
                ? "Installing — Isle will restart…"
                : `Downloading… ${st.p !== null ? Math.round(st.p * 100) + "%" : ""}`
              : "Isle checks for updates automatically.";
  return (
    <Card title="Software Updates">
      <Row icon="update" label={st.k === "available" ? "Update Available" : "Updates"} hint={text}>
        {st.k === "available" ? (
          <Button
            primary
            onClick={() => {
              setSt({ k: "installing", p: null });
              backend.installUpdate((p) => setSt({ k: "installing", p })).catch(() => setSt({ k: "error" }));
            }}
          >
            Update now
          </Button>
        ) : (
          <Button onClick={check} disabled={st.k === "checking" || st.k === "installing"}>
            Check now
          </Button>
        )}
      </Row>
    </Card>
  );
}
