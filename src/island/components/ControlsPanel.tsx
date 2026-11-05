import type { ReactNode } from "react";
import type { ControlsState, SettingsPage } from "@/lib/types";
import { useIsland } from "../store";
import { BluetoothIcon, ChevronIcon, EthernetIcon, MoonIcon, SpeakerIcon, SunIcon, WifiIcon } from "./icons";
import { Marquee } from "./Marquee";
import { Slider } from "./Slider";

export function ControlsPanel() {
  const c = useIsland((s) => s.controls);
  const backend = useIsland((s) => s.backend);
  const focus = useIsland((s) => s.settings.island.focusMode);
  const updateSettings = useIsland((s) => s.updateSettings);
  if (!c) return <div className="grid h-full place-items-center text-[12px] text-white/40">Loading…</div>;

  const set = (a: Parameters<NonNullable<typeof backend>["controlsSet"]>[0]) => void backend?.controlsSet(a);
  const open = (p: SettingsPage) => void backend?.openSettings(p);

  return (
    <div className="flex h-full flex-col gap-3 px-4 pt-1 pb-4">
      <div className="grid grid-cols-3 gap-2">
        <WifiTile c={c} onToggle={() => c.wifi && set({ type: "setWifi", on: !c.wifi.on })} onMore={() => open("wifi")} />
        <Tile
          label="Bluetooth"
          sub={c.bluetooth ? (c.bluetooth.on ? "On" : "Off") : "Unavailable"}
          on={!!c.bluetooth?.on}
          disabled={!c.bluetooth}
          icon={<BluetoothIcon size={17} />}
          onToggle={() => c.bluetooth && set({ type: "setBluetooth", on: !c.bluetooth.on })}
          onMore={() => open("bluetooth")}
        />
        <Tile
          label="Focus"
          sub={focus ? "On" : "Off"}
          on={focus}
          activeColor="bg-[#7d6bff]"
          icon={<MoonIcon size={15} />}
          onToggle={() => updateSettings((s) => ({ ...s, island: { ...s.island, focusMode: !s.island.focusMode } }))}
          onMore={() => open("focus")}
        />
      </div>

      <div className="flex flex-col gap-2.5">
        <Slider
          label="Volume"
          value={c.volume?.muted ? 0 : (c.volume?.level ?? 0)}
          disabled={!c.volume}
          icon={<SpeakerIcon size={17} muted={c.volume?.muted} level={c.volume?.level} />}
          onIconClick={() => c.volume && set({ type: "setMute", muted: !c.volume.muted })}
          onChange={(level) => set({ type: "setVolume", level })}
          trailing={<MoreButton label="Sound settings" onClick={() => open("sound")} />}
        />
        <Slider
          label="Brightness"
          value={(c.brightness?.level ?? 0) / 100}
          disabled={!c.brightness}
          icon={<SunIcon size={16} />}
          onChange={(v) => set({ type: "setBrightness", level: Math.round(v * 100) })}
          trailing={<MoreButton label="Display settings" onClick={() => open("display")} />}
        />
      </div>

      <div className="mt-auto flex items-center justify-between text-[11px] text-white/40">
        <span className="truncate">{c.volume ? c.volume.device : "No output device"}</span>
        {!c.brightness && <span>Brightness not supported on this display</span>}
      </div>
    </div>
  );
}

function WifiTile({ c, onToggle, onMore }: { c: ControlsState; onToggle(): void; onMore(): void }) {
  const n = c.network;
  if (n.kind === "ethernet") {
    return <Tile label="Ethernet" sub={n.online ? (n.name ?? "Connected") : "No internet"} on icon={<EthernetIcon size={16} />} onToggle={onMore} onMore={onMore} />;
  }
  const on = !!c.wifi?.on;
  const sub = !c.wifi ? "Unavailable" : !on ? "Off" : n.kind === "wifi" ? (n.name ?? "Connected") : "Not connected";
  return (
    <Tile
      label="Wi-Fi"
      sub={sub}
      on={on}
      disabled={!c.wifi}
      icon={<WifiIcon size={17} bars={n.kind === "wifi" ? (n.signal ?? 5) : 0} off={!on} />}
      onToggle={onToggle}
      onMore={onMore}
    />
  );
}

function Tile(props: {
  label: string;
  sub: string;
  on: boolean;
  disabled?: boolean;
  icon: ReactNode;
  activeColor?: string;
  onToggle(): void;
  onMore(): void;
}) {
  return (
    <div className={`group relative flex h-[70px] flex-col justify-between rounded-2xl bg-white/8 p-2.5 ${props.disabled ? "opacity-40" : ""}`}>
      <div className="flex items-start justify-between">
        <button
          type="button"
          aria-label={`Toggle ${props.label}`}
          aria-pressed={props.on}
          disabled={props.disabled}
          onClick={(e) => {
            e.stopPropagation();
            props.onToggle();
          }}
          className={`grid h-7 w-7 place-items-center rounded-full transition active:scale-90 ${
            props.on ? `${props.activeColor ?? "bg-[#2f7bff]"} text-white` : "bg-white/12 text-white/80"
          }`}
        >
          {props.icon}
        </button>
        <MoreButton label={`${props.label} settings`} onClick={props.onMore} subtle />
      </div>
      <div className="min-w-0 leading-tight">
        <div className="text-[11.5px] font-semibold text-white">{props.label}</div>
        <Marquee className="text-[10.5px] text-white/50">{props.sub}</Marquee>
      </div>
    </div>
  );
}

function MoreButton({ label, onClick, subtle }: { label: string; onClick(): void; subtle?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`grid h-6 w-6 place-items-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white ${
        subtle ? "opacity-0 group-hover:opacity-100 focus-visible:opacity-100" : ""
      }`}
    >
      <ChevronIcon size={13} />
    </button>
  );
}
