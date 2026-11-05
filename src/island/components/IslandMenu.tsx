import type { ReactNode } from "react";
import type { DockMode } from "@/lib/types";
import { useIsland, type Tab } from "../store";

export const MENU_W = 248;
/** Fixed height so the hit-test rect is known without measuring. */
export const MENU_H = 408;

const SIZES: [number, string][] = [
  [32, "S"],
  [40, "M"],
  [48, "L"],
  [56, "XL"],
];
const MODES: [DockMode, string][] = [
  ["fixed", "Always"],
  ["autoHide", "Auto"],
  ["smart", "Smart"],
];

/** Isle's own right-click menu for the island. */
export function IslandMenu({ top }: { top: number }) {
  const backend = useIsland((s) => s.backend);
  const dock = useIsland((s) => s.settings.dock);
  const updateSettings = useIsland((s) => s.updateSettings);
  const close = () => useIsland.setState({ islandMenu: false });
  const open = (tab: Tab) => () => {
    useIsland.setState({ islandMenu: false, tab, mode: "expanded", hovered: true });
  };
  const setDock = (patch: Partial<typeof dock>) => updateSettings((s) => ({ ...s, dock: { ...s.dock, ...patch } }));

  return (
    <div
      role="menu"
      className="absolute left-1/2 -translate-x-1/2 rounded-2xl border border-white/10 bg-[rgba(22,22,26,0.97)] p-1.5 text-[12.5px] text-white shadow-[0_14px_44px_rgba(0,0,0,0.5)]"
      style={{ top, width: MENU_W, height: MENU_H }}
      onClick={(e) => e.stopPropagation()}
      onPointerEnter={() => useIsland.getState().setHovered(true)}
    >
      <Item onClick={open("controls")}>Controls</Item>
      <Item onClick={open("clock")}>Clock &amp; Calendar</Item>
      <Item onClick={open("weather")}>Weather</Item>
      <Item onClick={open("stats")}>System</Item>
      <Sep />
      <div className="flex items-center justify-between px-2.5 py-1">
        <span>Dock</span>
        <Toggle on={dock.enabled} onChange={(enabled) => setDock({ enabled })} />
      </div>
      <Segment label="Size" value={dock.iconSize} options={SIZES} disabled={!dock.enabled} onChange={(iconSize) => setDock({ iconSize })} />
      <Segment label="Show" value={dock.mode} options={MODES} disabled={!dock.enabled} onChange={(mode) => setDock({ mode })} />
      <Sep />
      <Item
        onClick={() => {
          close();
          void backend?.launcherToggle(true);
        }}
      >
        Start menu
      </Item>
      <Item
        onClick={() => {
          close();
          useIsland.setState({ update: { kind: "checking" } });
          void backend
            ?.checkUpdate()
            .then((info) => useIsland.setState({ update: info ? { kind: "available", info } : { kind: "upToDate" }, mode: "expanded", tab: "home", hovered: true }))
            .catch((e: unknown) => useIsland.setState({ update: { kind: "error", message: String(e) } }));
        }}
      >
        Check for updates
      </Item>
      <Item
        onClick={() => {
          close();
          void backend?.openIsleSettings();
        }}
      >
        Settings…
      </Item>
      <Sep />
      <Item onClick={() => void backend?.reload()}>Reload Isle</Item>
      <Item danger onClick={() => void backend?.quit()}>
        Quit Isle
      </Item>
    </div>
  );
}

function Item({ children, onClick, danger }: { children: ReactNode; onClick(): void; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex h-[30px] w-full items-center rounded-lg px-2.5 text-left hover:bg-white/10 ${danger ? "text-[#ff8a80]" : ""}`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div className="mx-2 my-1 h-px bg-white/10" />;
}

function Toggle({ on, onChange }: { on: boolean; onChange(v: boolean): void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-[20px] w-[34px] rounded-full transition-colors ${on ? "bg-[#2f7bff]" : "bg-white/20"}`}
    >
      <span className="absolute top-[2px] left-[2px] h-4 w-4 rounded-full bg-white transition-transform" style={{ transform: on ? "translateX(14px)" : "none" }} />
    </button>
  );
}

function Segment<T extends string | number>(props: { label: string; value: T; options: [T, string][]; disabled?: boolean; onChange(v: T): void }) {
  return (
    <div className={`flex items-center justify-between gap-2 px-2.5 py-1 ${props.disabled ? "opacity-40" : ""}`}>
      <span className="text-white/60">{props.label}</span>
      <div className="flex rounded-lg bg-white/8 p-0.5">
        {props.options.map(([v, label]) => (
          <button
            key={String(v)}
            type="button"
            disabled={props.disabled}
            onClick={() => props.onChange(v)}
            className={`rounded-md px-2 py-0.5 text-[11.5px] whitespace-nowrap ${v === props.value ? "bg-white text-black" : "text-white/75 hover:text-white"}`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
