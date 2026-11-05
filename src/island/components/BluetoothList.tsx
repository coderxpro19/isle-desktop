import { useCallback, useEffect, useState } from "react";
import type { BtAction, BtDevice } from "@/lib/types";
import { useIsland } from "../store";
import { BluetoothIcon } from "./icons";
import { Row, SectionLabel, Spinner, SubHeader, Switch } from "./ListParts";
import { Empty } from "./WifiList";

const POLL_MS = 4000;

export function BluetoothList() {
  const backend = useIsland((s) => s.backend);
  const on = useIsland((s) => !!s.controls?.bluetooth?.on);
  const hasRadio = useIsland((s) => !!s.controls?.bluetooth);
  const prompt = useIsland((s) => s.btPrompt);
  const [devices, setDevices] = useState<BtDevice[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!backend) return;
    try {
      setDevices(await backend.btDevices());
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }, [backend]);

  // Discovery + live refresh while this page is open and the radio is on.
  useEffect(() => {
    if (!backend || !on) return;
    void refresh();
    void backend.btSetDiscovery(true);
    let t: ReturnType<typeof setTimeout> | null = null;
    const off = backend.on("bt://changed", () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => void refresh(), 300);
    });
    const poll = setInterval(() => void refresh(), POLL_MS);
    return () => {
      off();
      clearInterval(poll);
      if (t) clearTimeout(t);
      void backend.btSetDiscovery(false);
    };
  }, [backend, on, refresh]);

  const act = async (d: BtDevice, action: BtAction) => {
    if (!backend) return;
    setBusy(d.id);
    setMessage(null);
    try {
      await backend.btAction(d.id, action);
      setOpen(null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const mine = devices?.filter((d) => d.paired) ?? [];
  const nearby = devices?.filter((d) => !d.paired) ?? [];

  return (
    <div className="flex h-full flex-col px-3 pt-0.5 pb-3">
      <SubHeader
        title="Bluetooth"
        trailing={<Switch on={on} label="Bluetooth" disabled={!hasRadio} onChange={(v) => void backend?.controlsSet({ type: "setBluetooth", on: v })} />}
      />
      {prompt && <PairPrompt pin={prompt.pin} confirm={prompt.kind === "confirmPin"} />}
      <div className="isle-scroll min-h-0 flex-1 overflow-y-auto">
        {!hasRadio ? (
          <Empty>No Bluetooth adapter</Empty>
        ) : !on ? (
          <Empty>Bluetooth is off</Empty>
        ) : !devices ? (
          <Empty>Loading devices…</Empty>
        ) : (
          <>
            {message && <div className="px-2 py-1 text-[11.5px] text-[#ff8a80]">{message}</div>}
            {mine.length > 0 && <SectionLabel>My devices</SectionLabel>}
            {mine.map((d) => (
              <Row
                key={d.id}
                icon={<DeviceIcon kind={d.kind} />}
                title={d.name}
                sub={busy === d.id ? "Working…" : d.connected ? "Connected" : "Not connected"}
                active={d.connected}
                trailing={busy === d.id ? <Spinner /> : <More onClick={() => setOpen(open === d.id ? null : d.id)} />}
                onClick={() => {
                  if (busy) return;
                  if (d.canConnect) void act(d, d.connected ? "disconnect" : "connect");
                  else setOpen(open === d.id ? null : d.id);
                }}
              >
                {open === d.id && (
                  <div className="flex items-center justify-end gap-1.5 px-2 pb-2">
                    {!d.canConnect && <span className="mr-auto text-[11px] text-white/40">Connects automatically when it's on</span>}
                    {d.canConnect && (
                      <SmallButton onClick={() => void act(d, d.connected ? "disconnect" : "connect")}>{d.connected ? "Disconnect" : "Connect"}</SmallButton>
                    )}
                    <SmallButton danger onClick={() => void act(d, "forget")}>
                      Forget
                    </SmallButton>
                  </div>
                )}
              </Row>
            ))}
            <SectionLabel>
              <span className="flex items-center gap-1.5">
                Nearby <Spinner size={10} />
              </span>
            </SectionLabel>
            {nearby.length === 0 && <div className="px-2 py-1.5 text-[11.5px] text-white/40">Put your device in pairing mode…</div>}
            {nearby.map((d) => (
              <Row
                key={d.id}
                icon={<DeviceIcon kind={d.kind} />}
                title={d.name}
                sub={busy === d.id ? "Pairing…" : undefined}
                trailing={busy === d.id ? <Spinner /> : <span className="text-[11.5px] font-semibold text-[#5aa2ff]">Pair</span>}
                onClick={() => !busy && void act(d, "pair")}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function PairPrompt({ pin, confirm }: { pin: string; confirm: boolean }) {
  const backend = useIsland((s) => s.backend);
  return (
    <div className="mb-1.5 flex items-center gap-2 rounded-xl bg-[#2f7bff]/20 px-3 py-2" onClick={(e) => e.stopPropagation()}>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="text-[11px] text-white/60">{confirm ? "Does the device show this PIN?" : "Type this PIN on the device"}</div>
        <div className="text-[17px] font-semibold tracking-[0.18em] text-white tabular-nums">{pin}</div>
      </div>
      {confirm && (
        <>
          <SmallButton onClick={() => void backend?.btPairRespond(false)}>No</SmallButton>
          <SmallButton primary onClick={() => void backend?.btPairRespond(true)}>
            Yes, pair
          </SmallButton>
        </>
      )}
    </div>
  );
}

function SmallButton({ children, onClick, danger, primary }: { children: React.ReactNode; onClick(): void; danger?: boolean; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`rounded-lg px-3 py-1 text-[11.5px] font-semibold transition active:scale-95 ${
        primary ? "bg-[#2f7bff] text-white" : danger ? "bg-white/10 text-[#ff8a80] hover:bg-white/15" : "bg-white/12 text-white hover:bg-white/20"
      }`}
    >
      {children}
    </button>
  );
}

function More({ onClick }: { onClick(): void }) {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label="More"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="grid h-6 w-6 place-items-center rounded-full text-white/40 hover:bg-white/10 hover:text-white"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="5" cy="12" r="1.8" />
        <circle cx="12" cy="12" r="1.8" />
        <circle cx="19" cy="12" r="1.8" />
      </svg>
    </span>
  );
}

function DeviceIcon({ kind }: { kind: BtDevice["kind"] }) {
  const p = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (kind) {
    case "audio":
      return (
        <svg {...p}>
          <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
          <rect x="3" y="14" width="4.5" height="6.5" rx="1.6" fill="currentColor" />
          <rect x="16.5" y="14" width="4.5" height="6.5" rx="1.6" fill="currentColor" />
        </svg>
      );
    case "input":
      return (
        <svg {...p}>
          <rect x="6.5" y="3" width="11" height="18" rx="5.5" />
          <path d="M12 7v3" />
        </svg>
      );
    case "phone":
      return (
        <svg {...p}>
          <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
          <path d="M11 18.5h2" />
        </svg>
      );
    case "computer":
      return (
        <svg {...p}>
          <rect x="3.5" y="5" width="17" height="11" rx="1.5" />
          <path d="M2 19h20" />
        </svg>
      );
    default:
      return <BluetoothIcon size={14} />;
  }
}
