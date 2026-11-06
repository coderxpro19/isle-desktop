import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { ControlAction, ControlsState, DockMode, NotchBehavior, SettingsPage, TrayButton, TrayIcon } from "@/lib/types";
import { useIsland, type ControlsView } from "../store";
import { SubHeader } from "./ListParts";
import { BellIcon, BluetoothIcon, ChevronIcon, DockIcon, EthernetIcon, GearIcon, GridIcon, LeafIcon, MoonIcon, NotchIcon, RestartIcon, SpeakerIcon, SunIcon, WifiIcon } from "./icons";
import { Marquee } from "./Marquee";
import { BluetoothList } from "./BluetoothList";
import { WifiList } from "./WifiList";

export function ControlsPanel() {
  const c = useIsland((s) => s.controls);
  const backend = useIsland((s) => s.backend);
  const isl = useIsland((s) => s.settings.island);
  const dock = useIsland((s) => s.settings.dock);
  const battery = useIsland((s) => s.battery);
  const updateSettings = useIsland((s) => s.updateSettings);
  const view = useIsland((s) => s.controlsView);
  const show = (v: ControlsView) => useIsland.setState({ controlsView: v });
  if (view === "wifi") return <WifiList />;
  if (view === "bluetooth") return <BluetoothList />;
  if (view === "tray") return <TrayList />;

  const set = (a: ControlAction) => void backend?.controlsSet(a);
  const open = (p: SettingsPage) => void backend?.openSettings(p);
  const dockNext: Record<DockMode, DockMode> = { fixed: "smart", smart: "autoHide", autoHide: "fixed" };
  const dockLabel: Record<DockMode, string> = { fixed: "Fixed", smart: "Smart", autoHide: "Peek" };
  const notchNext: Record<NotchBehavior, NotchBehavior> = { smart: "hover", hover: "click", click: "smart" };
  const notchLabel: Record<NotchBehavior, string> = { smart: "Smart", hover: "Hover", click: "Click" };

  return (
    <div className="flex h-full flex-col gap-2.5 px-4 pt-1 pb-3.5" onClick={(e) => e.stopPropagation()}>
      <div className="grid grid-cols-2 gap-2">
        <WifiTile c={c} onToggle={() => c?.wifi && set({ type: "setWifi", on: !c.wifi.on })} onOpen={() => show("wifi")} />
        <Tile
          label="Dock Mode"
          sub={dock.enabled ? dockLabel[dock.mode] : "Off"}
          icon={<DockIcon size={15} />}
          title="Cycle dock mode: Fixed / Smart / Peek"
          onClick={() => updateSettings((s) => ({ ...s, dock: { ...s.dock, enabled: true, mode: dockNext[s.dock.mode] } }))}
        />
        <Tile
          label="Bluetooth"
          sub={c?.bluetooth ? (c.bluetooth.on ? "On" : "Off") : "Unavailable"}
          on={!!c?.bluetooth?.on}
          disabled={!c?.bluetooth}
          icon={<BluetoothIcon size={15} />}
          onClick={() => c?.bluetooth && set({ type: "setBluetooth", on: !c.bluetooth.on })}
          onMore={() => show("bluetooth")}
        />
        <Tile
          label="Notch Mode"
          sub={notchLabel[isl.notchBehavior]}
          icon={<NotchIcon size={15} />}
          title="Cycle notch mode: Smart / Hover / Click"
          onClick={() => updateSettings((s) => ({ ...s, island: { ...s.island, notchBehavior: notchNext[s.island.notchBehavior] } }))}
        />
      </div>

      <div className="flex justify-between px-1">
        <Round label={`Focus / DND: ${isl.focusMode ? "On" : "Off"}`} on={isl.focusMode} onClick={() => updateSettings((s) => ({ ...s, island: { ...s.island, focusMode: !s.island.focusMode } }))}>
          <MoonIcon size={15} />
        </Round>
        <Round label={`Energy saver${battery?.saver ? ": On" : ""}`} on={!!battery?.saver} onClick={() => open("battery")}>
          <LeafIcon size={16} />
        </Round>
        <Round label="System Tray" onClick={() => show("tray")}>
          <GridIcon size={15} />
        </Round>
        <Round label="Notification Center" onClick={() => open("notificationCenter")}>
          <BellIcon size={15} />
        </Round>
        <Round label="Isle Settings" onClick={() => void backend?.openIsleSettings()}>
          <GearIcon size={15} />
        </Round>
        <Round label="Restart Isle" onClick={() => void backend?.reload()}>
          <RestartIcon size={15} />
        </Round>
      </div>

      <div className="mt-0.5 flex flex-col gap-2">
        <Bar
          label="Volume"
          icon={<SpeakerIcon size={14} muted={c?.volume?.muted} level={c?.volume?.level} />}
          value={c?.volume ? (c.volume.muted ? 0 : c.volume.level) : null}
          title={c?.volume?.device}
          onIcon={() => c?.volume && set({ type: "setMute", muted: !c.volume.muted })}
          onChange={(level) => set({ type: "setVolume", level })}
        />
        <Bar
          label="Brightness"
          icon={<SunIcon size={13} />}
          value={c?.brightness ? c.brightness.level / 100 : null}
          title={c?.brightness ? undefined : "Brightness isn't adjustable on this display"}
          onIcon={() => open("display")}
          onChange={(v) => set({ type: "setBrightness", level: Math.round(v * 100) })}
        />
      </div>
    </div>
  );
}

function Round({ label, on, onClick, children }: { label: string; on?: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      onClick={onClick}
      className={`grid h-[34px] w-[34px] place-items-center rounded-full transition active:scale-90 ${
        on ? "bg-white text-black" : "bg-white/[.07] text-white/85 ring-1 ring-white/10 hover:bg-white/15"
      }`}
    >
      {children}
    </button>
  );
}

/** Thin slider row: icon · label · bar · percent. */
function Bar({ label, icon, value, title, onIcon, onChange }: { label: string; icon: ReactNode; value: number | null; title?: string; onIcon(): void; onChange(v: number): void }) {
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? value ?? 0;
  const at = (x: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (x - r.left) / r.width));
  };
  return (
    <div className={`flex h-[22px] items-center gap-2 text-[11.5px] font-medium ${value === null ? "opacity-40" : ""}`} title={title}>
      <button type="button" aria-label={label} onClick={onIcon} className="flex w-[78px] shrink-0 items-center gap-1.5 text-white/75 hover:text-white">
        {icon}
        {label}
      </button>
      <div
        ref={track}
        role="slider"
        aria-label={label}
        aria-valuenow={Math.round(shown * 100)}
        className="relative h-[18px] flex-1 cursor-pointer touch-none"
        onPointerDown={(e) => {
          if (value === null) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const v = at(e.clientX);
          setDrag(v);
          onChange(v);
        }}
        onPointerMove={(e) => {
          if (drag === null) return;
          const v = at(e.clientX);
          setDrag(v);
          onChange(v);
        }}
        onPointerUp={() => setDrag(null)}
        onWheel={(e) => value !== null && onChange(Math.max(0, Math.min(1, value - Math.sign(e.deltaY) * 0.05)))}
      >
        <div className="absolute inset-x-0 top-1/2 h-[6px] -translate-y-1/2 overflow-hidden rounded-full bg-white/15">
          <div className="h-full rounded-full bg-white" style={{ width: `${shown * 100}%` }} />
        </div>
      </div>
      <span className="w-9 shrink-0 text-right text-white/60 tabular-nums">{value === null ? "–" : `${Math.round(shown * 100)}%`}</span>
    </div>
  );
}

function TrayList() {
  const backend = useIsland((s) => s.backend);
  const [icons, setIcons] = useState<TrayIcon[] | null>(null);
  useEffect(() => {
    if (!backend) return;
    void backend.trayIcons().then(setIcons, () => setIcons([]));
    return backend.on("tray://icons", setIcons);
  }, [backend]);
  const send = (el: HTMLElement, id: string, button: TrayButton) => {
    const b = el.getBoundingClientRect();
    void backend?.trayClick(id, button, b.left + b.width / 2, b.top + b.height / 2);
  };
  return (
    <div className="flex h-full flex-col px-4 pb-3" onClick={(e) => e.stopPropagation()}>
      <SubHeader title="System Tray" />
      {icons && icons.length === 0 ? (
        <div className="grid flex-1 place-items-center text-[12px] text-white/40">No tray icons — the dock hosts them when it replaces the taskbar.</div>
      ) : (
        <div className="isle-scroll grid flex-1 grid-cols-8 content-start gap-1.5 overflow-y-auto pt-1">
          {(icons ?? []).map((i) => (
            <button
              key={i.id}
              type="button"
              title={i.tip}
              aria-label={i.tip || "Tray icon"}
              onClick={(e) => send(e.currentTarget, i.id, "left")}
              onDoubleClick={(e) => send(e.currentTarget, i.id, "double")}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                send(e.currentTarget, i.id, "right");
              }}
              className="grid h-10 w-10 place-items-center rounded-xl bg-white/[.06] hover:bg-white/15 active:scale-90"
            >
              {i.icon ? <img src={i.icon} alt="" className="h-5 w-5" draggable={false} /> : <span className="h-2 w-2 rounded-full bg-white/40" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function WifiTile({ c, onToggle, onOpen }: { c: ControlsState | null; onToggle(): void; onOpen(): void }) {
  if (!c) return <Tile label="Wi-Fi" sub="…" icon={<WifiIcon size={15} />} onClick={onOpen} />;
  const n = c.network;
  if (n.kind === "ethernet" && !c.wifi?.on) {
    return <Tile label="Ethernet" sub={n.online ? (n.name ?? "Connected") : "No internet"} on icon={<EthernetIcon size={15} />} onClick={onOpen} />;
  }
  const on = !!c.wifi?.on;
  const sub = !c.wifi ? "Unavailable" : !on ? "Off" : n.kind === "wifi" ? (n.name ?? "Connected") : "Not connected";
  return (
    <Tile
      label="Wi-Fi"
      sub={sub}
      on={on}
      disabled={!c.wifi}
      icon={<WifiIcon size={15} bars={n.kind === "wifi" ? (n.signal ?? 5) : 0} off={!on} />}
      onClick={on ? onOpen : onToggle}
      onMore={onOpen}
    />
  );
}

function Tile(props: {
  label: string;
  sub: string;
  on?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  title?: string;
  onClick(): void;
  /** Chevron: open the list (Bluetooth). */
  onMore?(): void;
}) {
  const on = !!props.on;
  return (
    <div
      role="button"
      tabIndex={props.disabled ? -1 : 0}
      title={props.title}
      onClick={() => !props.disabled && props.onClick()}
      onKeyDown={(e) => e.key === "Enter" && !props.disabled && props.onClick()}
      className={`flex h-[42px] cursor-pointer items-center gap-2.5 rounded-[14px] px-3 transition active:scale-[.98] ${
        on ? "bg-white text-black" : "bg-white/[.07] text-white ring-1 ring-white/10 hover:bg-white/12"
      } ${props.disabled ? "opacity-40" : ""}`}
    >
      <span className={on ? "text-black/80" : "text-white/80"}>{props.icon}</span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-[12px] font-semibold">{props.label}</div>
        <Marquee className={`text-[10.5px] ${on ? "text-black/55" : "text-white/50"}`}>{props.sub}</Marquee>
      </div>
      {props.onMore && (
        <button
          type="button"
          aria-label={`${props.label} devices`}
          onClick={(e) => {
            e.stopPropagation();
            props.onMore!();
          }}
          className={`-mr-1 grid h-7 w-6 place-items-center rounded-md ${on ? "text-black/50 hover:bg-black/10" : "text-white/40 hover:bg-white/10 hover:text-white"}`}
        >
          <ChevronIcon size={13} />
        </button>
      )}
    </div>
  );
}
