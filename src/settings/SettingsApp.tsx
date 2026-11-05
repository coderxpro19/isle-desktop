import { useEffect, useRef, useState, type ReactNode } from "react";
import { getBackend, type Backend } from "@/lib/backend";
import { DEFAULT_SETTINGS, type DockMode, type Settings, type UpdateInfo } from "@/lib/types";
import { THEMES, ACCENTS, themeOf } from "./themes";

type Section = "general" | "island" | "dock" | "appearance" | "calendar" | "weather" | "backup" | "about";
const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: "general", label: "General", icon: "M4 6h16M4 12h16M4 18h10" },
  { id: "island", label: "Island", icon: "M6 9h12a3 3 0 0 1 0 6H6a3 3 0 0 1 0-6Z" },
  { id: "dock", label: "Dock", icon: "M4 15h16v4H4zM7 11h3v4H7zM14 9h3v6h-3z" },
  { id: "appearance", label: "Appearance", icon: "M12 4a8 8 0 1 0 0 16c1 0 1.5-.8 1.2-1.6-.4-1 .3-2.4 1.6-2.4H17a3 3 0 0 0 3-3c0-5-3.6-9-8-9Z" },
  { id: "calendar", label: "Calendar", icon: "M5 6h14v13H5zM5 10h14M9 4v4M15 4v4" },
  { id: "weather", label: "Weather", icon: "M7 17h10a4 4 0 0 0 0-8 5 5 0 0 0-9.6 1.5A3.3 3.3 0 0 0 7 17Z" },
  { id: "backup", label: "Backup", icon: "M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14" },
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
    <div className="isle-settings flex h-full text-[13px] text-[var(--fg)]">
      <nav className="flex w-[210px] shrink-0 flex-col gap-0.5 bg-[var(--side)] px-3 py-4">
        <div className="mb-4 flex items-center gap-2.5 px-2">
          <div className="h-[18px] w-[34px] rounded-full bg-black shadow-[0_0_0_1px_rgba(255,255,255,.15)]" />
          <span className="text-[15px] font-semibold">Isle</span>
        </div>
        {SECTIONS.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setSection(x.id)}
            className={`flex h-9 items-center gap-3 rounded-lg px-3 text-left transition-colors ${
              section === x.id ? "bg-[var(--sel)] font-medium" : "text-[var(--dim)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"
            }`}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d={x.icon} />
            </svg>
            {x.label}
          </button>
        ))}
      </nav>
      <main className="isle-scroll min-w-0 flex-1 overflow-y-auto bg-[var(--bg)] px-10 py-8">
        <div className="mx-auto max-w-[640px]">
          <h1 className="mb-6 text-[24px] font-semibold tracking-tight">{SECTIONS.find((x) => x.id === section)!.label}</h1>
          {section === "general" && <General s={s} update={update} backend={backend} />}
          {section === "island" && <IslandSection s={s} update={update} />}
          {section === "dock" && <DockSection s={s} update={update} />}
          {section === "appearance" && <AppearanceSection s={s} update={update} />}
          {section === "calendar" && <CalendarSection s={s} update={update} />}
          {section === "weather" && <WeatherSection s={s} update={update} />}
          {section === "backup" && <BackupSection backend={backend} onImported={setS} update={update} />}
          {section === "about" && <About backend={backend} />}
        </div>
      </main>
    </div>
  );
}

type Props = { s: Settings; update: (f: (s: Settings) => Settings) => void };

/* ───────────── building blocks ───────────── */

function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      {title && <h2 className="mb-2 px-1 text-[12px] font-semibold tracking-wide text-[var(--dim)] uppercase">{title}</h2>}
      <div className="divide-y divide-[var(--line)] overflow-hidden rounded-xl bg-[var(--card)] ring-1 ring-[var(--line)]">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[56px] items-center justify-between gap-6 px-4 py-3">
      <div className="min-w-0">
        <div className="font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] leading-snug text-[var(--dim)]">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
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
      className={`relative h-[22px] w-[40px] rounded-full transition-colors ${on ? "bg-[var(--accent)]" : "bg-[var(--off)]"}`}
    >
      <span className="absolute top-[3px] left-[3px] h-4 w-4 rounded-full bg-white shadow transition-transform" style={{ transform: on ? "translateX(18px)" : "none" }} />
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
          className={`rounded-md px-3 py-1 text-[12.5px] whitespace-nowrap ${v === value ? "bg-[var(--seg)] font-medium shadow-sm" : "text-[var(--dim)] hover:text-[var(--fg)]"}`}
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
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-40 accent-[var(--accent)]" />
      <span className="w-12 text-right text-[12px] text-[var(--dim)] tabular-nums">
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
      className={`h-8 rounded-lg px-4 text-[12.5px] font-medium transition-colors disabled:opacity-40 ${
        primary ? "bg-[var(--accent)] text-white hover:brightness-110" : danger ? "bg-[#e5484d]/15 text-[#ff6b6b] hover:bg-[#e5484d]/25" : "bg-[var(--well)] hover:bg-[var(--hover)]"
      }`}
    >
      {children}
    </button>
  );
}

/* ───────────── sections ───────────── */

function General({ s, update, backend }: Props & { backend: Backend }) {
  return (
    <>
      <Card>
        <Row label="Start with Windows" hint="Open Isle automatically when you sign in. Recommended when the dock replaces your taskbar.">
          <Switch on={s.general.startWithWindows} onChange={(v) => update((x) => ({ ...x, general: { ...x.general, startWithWindows: v } }))} />
        </Row>
        <Row label="Focus mode" hint="Silences notification pop-ups and alerts on the island.">
          <Switch on={s.island.focusMode} onChange={(v) => update((x) => ({ ...x, island: { ...x.island, focusMode: v } }))} />
        </Row>
      </Card>
      <Updates backend={backend} />
    </>
  );
}

function Updates({ backend }: { backend: Backend }) {
  const [st, setSt] = useState<{ k: "idle" | "checking" | "none" | "error" } | { k: "available"; info: UpdateInfo } | { k: "installing"; p: number | null }>({ k: "idle" });
  const [version, setVersion] = useState("");
  useEffect(() => void backend.appVersion().then(setVersion, () => {}), [backend]);
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
          ? "Couldn't check for updates. Check your connection and try again."
          : st.k === "available"
            ? `Isle ${st.info.version} is available.`
            : st.k === "installing"
              ? st.p === 1
                ? "Installing — Isle will restart…"
                : `Downloading… ${st.p !== null ? Math.round(st.p * 100) + "%" : ""}`
              : `You're on Isle ${version}. Updates are checked automatically.`;
  return (
    <Card title="Updates">
      <Row label="Isle updates" hint={text}>
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

function IslandSection({ s, update }: Props) {
  const isl = s.island;
  const set = (patch: Partial<Settings["island"]>) => update((x) => ({ ...x, island: { ...x.island, ...patch } }));
  const t = (label: string, key: keyof Settings["island"], hint?: string) => (
    <Row label={label} hint={hint}>
      <Switch on={isl[key] as boolean} onChange={(v) => set({ [key]: v })} />
    </Row>
  );
  return (
    <>
      <Card title="Clock & status">
        {t("24-hour clock", "clock24h")}
        {t("Show seconds", "showSeconds")}
        {t("Battery percentage", "batteryPercent")}
      </Card>
      <Card title="Behaviour">
        {t("Open fully on hover", "expandOnHover", "Otherwise hovering shows a preview and a click opens it.")}
        {t("Hide when a game or video is full screen", "hideInFullscreen")}
        <Row label="Distance from top" hint="Move the island down if it covers something.">
          <Range value={isl.topOffset} min={0} max={40} onChange={(v) => set({ topOffset: v })} unit="px" />
        </Row>
      </Card>
      <Card title="Live activities">
        {t("Music visualiser", "visualizer")}
        {t("Charging alerts", "chargingActivity")}
        {t("Volume & brightness pop-up", "volumeHud", "Replaces the Windows volume flyout.")}
        {t("Notification pop-ups", "notifications")}
        {t("Clipboard history", "clipboardHistory", "Remembers what you copy. Open it with Alt+Shift+V.")}
      </Card>
    </>
  );
}

function DockSection({ s, update }: Props) {
  const d = s.dock;
  const set = (patch: Partial<Settings["dock"]>) => update((x) => ({ ...x, dock: { ...x.dock, ...patch } }));
  return (
    <>
      <Card>
        <Row label="Show the dock">
          <Switch on={d.enabled} onChange={(enabled) => set({ enabled })} />
        </Row>
        <Row label="Replace the Windows taskbar" hint="Hides the taskbar while the dock is on. It always comes back when Isle closes.">
          <Switch on={d.replaceTaskbar} onChange={(replaceTaskbar) => set({ replaceTaskbar })} />
        </Row>
      </Card>
      <Card title="Behaviour">
        <Row label="Show" hint="Auto: slides away until you touch the bottom edge. Smart: hides only when a window needs the space.">
          <Segmented<DockMode>
            value={d.mode}
            disabled={!d.enabled}
            options={[
              ["fixed", "Always"],
              ["autoHide", "Auto"],
              ["smart", "Smart"],
            ]}
            onChange={(mode) => set({ mode })}
          />
        </Row>
        <Row label="Icon size">
          <Range value={d.iconSize} min={28} max={64} step={2} onChange={(iconSize) => set({ iconSize })} unit="px" />
        </Row>
        <Row label="Magnify icons on hover">
          <Switch on={d.magnification} onChange={(magnification) => set({ magnification })} />
        </Row>
      </Card>
    </>
  );
}

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
              className={`overflow-hidden rounded-xl text-left ring-2 transition ${current === t.id ? "ring-[var(--accent)]" : "ring-transparent hover:ring-[var(--line)]"}`}
            >
              <div className="relative h-[70px]" style={{ background: t.wall }}>
                <div className="absolute top-2.5 left-1/2 flex h-[18px] w-[70px] -translate-x-1/2 items-center justify-between rounded-full px-2" style={{ background: t.surface }}>
                  <span className="h-1.5 w-5 rounded-full bg-white/70" />
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.accent === "artwork" ? "#ff8a5c" : t.accent }} />
                </div>
                <div className="absolute bottom-2 left-1/2 h-3 w-[90px] -translate-x-1/2 rounded-md" style={{ background: t.surface, opacity: 0.8 }} />
              </div>
              <div className="bg-[var(--well)] px-2.5 py-1.5 text-[12px] font-medium">{t.name}</div>
            </button>
          ))}
        </div>
      </Card>
      <Card title="Fine-tune">
        <Row label="Accent colour" hint="Used for sliders, the visualiser and highlights.">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              title="Match album art"
              onClick={() => set({ accent: "artwork" })}
              className={`h-6 rounded-full px-2.5 text-[11.5px] ring-2 ${a.accent === "artwork" ? "ring-[var(--accent)]" : "ring-transparent"} bg-[var(--well)]`}
            >
              Album art
            </button>
            {ACCENTS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => set({ accent: c })}
                className={`h-6 w-6 rounded-full ring-2 ring-offset-2 ring-offset-[var(--card)] ${a.accent === c ? "ring-[var(--fg)]" : "ring-transparent"}`}
                style={{ background: c }}
              />
            ))}
            <label className="relative h-6 w-6 cursor-pointer overflow-hidden rounded-full bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]" title="Custom colour">
              <input type="color" value={a.accent.startsWith("#") ? a.accent : "#5aa2ff"} onChange={(e) => set({ accent: e.target.value })} className="absolute inset-0 opacity-0" />
            </label>
          </div>
        </Row>
        <Row label="Island colour">
          <label className="flex items-center gap-2">
            <span className="h-6 w-6 rounded-full ring-1 ring-[var(--line)]" style={{ background: a.surface }} />
            <input type="color" value={a.surface} onChange={(e) => set({ surface: e.target.value })} className="h-7 w-10 cursor-pointer bg-transparent" />
          </label>
        </Row>
        <Row label="Corner roundness">
          <Range value={a.cornerRadius} min={12} max={32} onChange={(cornerRadius) => set({ cornerRadius })} unit="px" />
        </Row>
        <Row label="Reduce motion" hint="Fewer springy animations.">
          <Switch on={a.reduceMotion} onChange={(reduceMotion) => set({ reduceMotion })} />
        </Row>
      </Card>
    </>
  );
}

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
        {feeds.length === 0 && <div className="px-4 py-4 text-[12.5px] text-[var(--dim)]">No calendars yet.</div>}
        {feeds.map((f) => (
          <div key={f.url} className="flex items-center gap-3 px-4 py-3">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: f.color }} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{f.name}</div>
              <div className="truncate text-[11.5px] text-[var(--dim)]">{f.url.replace(/(private-|secret)[^/]*/i, "$1…")}</div>
            </div>
            <Button danger onClick={() => save(feeds.filter((x) => x.url !== f.url))}>
              Remove
            </Button>
          </div>
        ))}
      </Card>
      <Card title="Add a calendar">
        <div className="space-y-3 p-4">
          <div className="text-[12.5px] leading-relaxed text-[var(--dim)]">
            Paste the calendar's iCal link. <b className="text-[var(--fg)]">Google:</b> Calendar settings → your calendar → “Secret address in iCal format”.{" "}
            <b className="text-[var(--fg)]">Outlook:</b> Settings → Calendar → Shared calendars → Publish → ICS. <b className="text-[var(--fg)]">iCloud:</b> share as public calendar.
          </div>
          <div className="flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (Work, Family…)" className="h-9 w-44 rounded-lg bg-[var(--well)] px-3 outline-none focus:ring-2 focus:ring-[var(--accent)]" />
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… .ics" className="h-9 min-w-0 flex-1 rounded-lg bg-[var(--well)] px-3 outline-none focus:ring-2 focus:ring-[var(--accent)]" />
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

function WeatherSection({ s, update }: Props) {
  const w = s.weather;
  return (
    <Card>
      <Row label="Temperature unit">
        <Segmented
          value={w.fahrenheit ? "f" : "c"}
          options={[
            ["c", "°C"],
            ["f", "°F"],
          ]}
          onChange={(v) => update((x) => ({ ...x, weather: { ...x.weather, fahrenheit: v === "f" } }))}
        />
      </Row>
      <Row label="Location" hint={w.location ? w.location.name : "Automatic (from Windows location), or pick a city in the island's weather tab."}>
        {w.location && <Button onClick={() => update((x) => ({ ...x, weather: { ...x.weather, location: null } }))}>Use automatic</Button>}
      </Row>
    </Card>
  );
}

function BackupSection({ backend, onImported, update }: { backend: Backend; onImported(s: Settings): void; update: Props["update"] }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  return (
    <>
      <Card>
        <Row label="Export settings" hint="Saves a file with all your Isle settings, pinned apps and calendars to your Downloads folder.">
          <Button onClick={() => backend.settingsExport().then((p) => setMsg({ ok: true, text: `Saved to ${p}` }), (e) => setMsg({ ok: false, text: String(e) }))}>Export…</Button>
        </Row>
        <Row label="Import settings" hint="Restore a file you exported, on this PC or another one.">
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
                  const next = await backend.settingsImport(await f.text());
                  onImported(next);
                  setMsg({ ok: true, text: "Settings imported." });
                } catch (err) {
                  setMsg({ ok: false, text: String(err).replace(/^Error:\s*/, "") });
                }
              }}
            />
            <Button onClick={() => file.current?.click()}>Import…</Button>
          </>
        </Row>
        <Row label="Reset to defaults" hint="Pinned apps and calendars are cleared too.">
          {confirmReset ? (
            <span className="flex gap-2">
              <Button onClick={() => setConfirmReset(false)}>Cancel</Button>
              <Button
                danger
                onClick={() => {
                  update(() => structuredClone(DEFAULT_SETTINGS));
                  setConfirmReset(false);
                  setMsg({ ok: true, text: "Settings reset." });
                }}
              >
                Reset
              </Button>
            </span>
          ) : (
            <Button danger onClick={() => setConfirmReset(true)}>
              Reset…
            </Button>
          )}
        </Row>
      </Card>
      {msg && <div className={`rounded-lg px-4 py-2.5 text-[12.5px] ${msg.ok ? "bg-[#30a46c]/15 text-[#5bd39a]" : "bg-[#e5484d]/15 text-[#ff8a8a]"}`}>{msg.text}</div>}
    </>
  );
}

function About({ backend }: { backend: Backend }) {
  const [version, setVersion] = useState("");
  useEffect(() => void backend.appVersion().then(setVersion, () => {}), [backend]);
  return (
    <Card>
      <div className="flex items-center gap-4 px-4 py-5">
        <div className="h-7 w-[54px] rounded-full bg-black shadow-[0_0_0_1px_rgba(255,255,255,.15)]" />
        <div>
          <div className="text-[15px] font-semibold">Isle {version}</div>
          <div className="text-[12.5px] text-[var(--dim)]">A Dynamic Island and dock for Windows.</div>
        </div>
      </div>
      <Row label="Keyboard shortcuts">
        <span className="text-[12.5px] text-[var(--dim)]">Alt+Shift+V clipboard · Esc closes the island</span>
      </Row>
    </Card>
  );
}
