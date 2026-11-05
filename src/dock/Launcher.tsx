import { useEffect, useMemo, useRef, useState } from "react";
import { getBackend, type Backend } from "@/lib/backend";
import type { LauncherApp, PowerAction } from "@/lib/types";

const COLS = 6;

/** Isle's Start menu: search + all apps + power. Lives in its own window. */
export function Launcher({ onClose }: { onClose?(): void }) {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [apps, setApps] = useState<LauncherApp[]>([]);
  const [icons, setIcons] = useState<Record<string, string | null>>({});
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [powerOpen, setPowerOpen] = useState(false);
  const [menu, setMenu] = useState<LauncherApp | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let off = () => {};
    void getBackend().then((b) => {
      setBackend(b);
      void b.launcherApps().then(setApps);
      off = b.on("launcher://opened", () => {
        setQuery("");
        setSel(0);
        setPowerOpen(false);
        setMenu(null);
        // Refresh the list in the background; new installs appear next time.
        void b.launcherApps().then(setApps);
        setTimeout(() => input.current?.focus(), 30);
      });
    });
    input.current?.focus();
    return () => off();
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return apps;
    // Prefix matches first, then word starts, then anywhere.
    const score = (n: string) => {
      const s = n.toLowerCase();
      if (s.startsWith(q)) return 0;
      if (s.split(/[\s\-_.]+/).some((w) => w.startsWith(q))) return 1;
      return s.includes(q) ? 2 : 9;
    };
    return apps
      .map((a) => [a, score(a.name)] as const)
      .filter(([, s]) => s < 9)
      .sort((a, b) => a[1] - b[1] || a[0].name.localeCompare(b[0].name))
      .map(([a]) => a);
  }, [apps, query]);

  // Lazily fetch icons for what's on screen (first 48 matches).
  useEffect(() => {
    if (!backend) return;
    const want = shown.slice(0, 48).filter((a) => !(a.id in icons));
    if (!want.length) return;
    setIcons((m) => ({ ...m, ...Object.fromEntries(want.map((a) => [a.id, null])) }));
    let i = 0;
    const next = (): Promise<void> | undefined => {
      const a = want[i++];
      if (!a) return;
      return backend.dockIcon(`app:${a.id}`).then((url) => {
        setIcons((m) => ({ ...m, [a.id]: url }));
        return next();
      });
    };
    for (let k = 0; k < 6; k++) void next();
  }, [backend, shown, icons]);

  useEffect(() => setSel(0), [query]);

  const close = () => (onClose ? onClose() : void backend?.launcherToggle(false));
  const launch = (a: LauncherApp) => {
    void backend?.launcherLaunch(a.id);
    onClose?.();
  };
  const power = (p: PowerAction) => void backend?.power(p);

  return (
    <div className="flex h-full w-full p-2">
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[rgba(22,22,26,0.97)] text-white shadow-[0_20px_60px_rgba(0,0,0,0.55)]"
        onKeyDown={(e) => {
          if (e.key === "Escape") return menu ? setMenu(null) : close();
          const max = Math.min(shown.length, 48) - 1;
          const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS }[e.key];
          if (step !== undefined) {
            e.preventDefault();
            setSel((s) => Math.max(0, Math.min(max, s + step)));
          } else if (e.key === "Enter" && shown[sel]) launch(shown[sel]!);
        }}
      >
        <div className="p-4 pb-2">
          <label className="flex h-11 items-center gap-2.5 rounded-2xl bg-white/8 px-4 text-white/45 focus-within:bg-white/12">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="6.5" />
              <path d="m20 20-4.2-4.2" />
            </svg>
            <input
              ref={input}
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search apps"
              aria-label="Search apps"
              className="w-full bg-transparent text-[14px] text-white outline-none placeholder:text-white/35"
            />
          </label>
        </div>
        <div className="px-5 pt-1 pb-1 text-[11px] font-semibold tracking-wide text-white/35 uppercase">{query ? "Results" : "All apps"}</div>
        <div className="isle-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          <div className="grid" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}>
            {shown.map((a, i) => (
              <button
                key={a.id}
                type="button"
                onClick={() => launch(a)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu(a);
                }}
                onMouseEnter={() => setSel(i)}
                className={`flex flex-col items-center gap-1.5 rounded-xl px-1 py-2.5 ${i === sel ? "bg-white/10" : ""}`}
              >
                <span className="grid h-10 w-10 place-items-center">
                  {icons[a.id] ? (
                    <img src={icons[a.id]!} alt="" className="h-10 w-10 object-contain" draggable={false} />
                  ) : (
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/8 text-[13px] font-semibold text-white/50">{a.name.slice(0, 1)}</span>
                  )}
                </span>
                <span className="line-clamp-2 w-full text-center text-[11.5px] leading-tight text-white/85">{a.name}</span>
              </button>
            ))}
          </div>
          {shown.length === 0 && <div className="py-10 text-center text-[13px] text-white/40">No apps match “{query}”</div>}
        </div>
        <div className="relative flex h-12 items-center justify-between border-t border-white/8 px-4">
          <span className="text-[12px] text-white/40">{apps.length ? `${apps.length} apps` : "Loading apps…"}</span>
          <button
            type="button"
            aria-label="Power"
            onClick={() => setPowerOpen(!powerOpen)}
            className="grid h-8 w-8 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M12 3v8M6.6 6.6a8 8 0 1 0 10.8 0" />
            </svg>
          </button>
          {powerOpen && (
            <div className="absolute right-3 bottom-12 w-44 rounded-xl border border-white/10 bg-[rgba(30,30,36,0.98)] p-1.5 text-[12.5px] shadow-xl">
              {(
                [
                  ["lock", "Lock"],
                  ["sleep", "Sleep"],
                  ["signOut", "Sign out"],
                  ["restart", "Restart"],
                  ["shutdown", "Shut down"],
                ] as [PowerAction, string][]
              ).map(([p, label]) => (
                <button key={p} type="button" onClick={() => power(p)} className="w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-white/10">
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        {menu && (
          <div className="absolute inset-0 grid place-items-center bg-black/30" onClick={() => setMenu(null)}>
            <div className="w-56 rounded-xl border border-white/10 bg-[rgba(30,30,36,0.98)] p-1.5 text-[12.5px] shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="truncate px-2.5 py-1 text-[11px] font-semibold text-white/40">{menu.name}</div>
              <button type="button" onClick={() => (launch(menu), setMenu(null))} className="w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-white/10">
                Open
              </button>
              {menu.pinKey && (
                <button
                  type="button"
                  onClick={() => {
                    void backend?.dockPin(menu.pinKey!, menu.name, true);
                    setMenu(null);
                  }}
                  className="w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-white/10"
                >
                  Pin to dock
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
