import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WifiNetwork } from "@/lib/types";
import { useIsland } from "../store";
import { WifiIcon } from "./icons";
import { pinWhileFocused, Row, SectionLabel, Spinner, SubHeader, Switch } from "./ListParts";

type Busy = { ssid: string } | null;
type Ask = { ssid: string; error?: string } | null;

const RESCAN_MS = 15_000;

export function WifiList() {
  const backend = useIsland((s) => s.backend);
  const wifiOn = useIsland((s) => !!s.controls?.wifi?.on);
  const hasRadio = useIsland((s) => !!s.controls?.wifi);
  const [networks, setNetworks] = useState<WifiNetwork[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const scan = useCallback(async () => {
    if (!backend) return;
    setScanning(true);
    try {
      setNetworks(await backend.wifiScan());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, [backend]);

  useEffect(() => {
    if (!wifiOn) return;
    void scan();
    const id = setInterval(() => void scan(), RESCAN_MS);
    return () => clearInterval(id);
  }, [scan, wifiOn]);

  const join = async (ssid: string, password?: string) => {
    if (!backend) return;
    setBusy({ ssid });
    setMessage(null);
    try {
      const r = await backend.wifiConnect(ssid, password);
      if (r.status === "connected") {
        setAsk(null);
        setOpen(null);
        await scan();
      } else if (r.status === "needsPassword") setAsk({ ssid });
      else if (r.status === "wrongPassword") setAsk({ ssid, error: "Wrong password" });
      else setMessage(r.message);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const connected = networks?.find((n) => n.connected) ?? null;
  const others = useMemo(() => networks?.filter((n) => !n.connected) ?? [], [networks]);

  const renderRow = (n: WifiNetwork) => {
    const isBusy = busy?.ssid === n.ssid;
    const asking = ask?.ssid === n.ssid;
    return (
      <Row
        key={n.ssid}
        icon={<WifiIcon size={15} bars={n.signal + 1} />}
        title={n.ssid}
        sub={n.connected ? "Connected" : isBusy ? "Connecting…" : n.secured ? (n.saved ? "Saved" : "Secured") : "Open"}
        active={n.connected}
        trailing={isBusy ? <Spinner /> : n.secured ? <LockIcon /> : null}
        onClick={() => {
          if (isBusy) return;
          if (n.connected) setOpen(open === n.ssid ? null : n.ssid);
          else if (n.secured && !n.saved) setAsk(asking ? null : { ssid: n.ssid });
          else void join(n.ssid);
        }}
      >
        {asking && <PasswordForm error={ask?.error} busy={isBusy} onCancel={() => setAsk(null)} onSubmit={(pw) => void join(n.ssid, pw)} />}
        {n.connected && open === n.ssid && (
          <div className="flex justify-end px-2 pb-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void backend?.wifiDisconnect().then(scan);
                setOpen(null);
              }}
              className="rounded-lg bg-white/12 px-3 py-1 text-[11.5px] font-semibold text-white hover:bg-white/20"
            >
              Disconnect
            </button>
          </div>
        )}
      </Row>
    );
  };

  return (
    <div className="flex h-full flex-col px-3 pt-0.5 pb-3">
      <SubHeader
        title="Wi-Fi"
        trailing={
          <>
            {wifiOn && (scanning ? <Spinner /> : null)}
            <Switch
              on={wifiOn}
              label="Wi-Fi"
              disabled={!hasRadio}
              onChange={(on) => void backend?.controlsSet({ type: "setWifi", on })}
            />
          </>
        }
      />
      <div className="isle-scroll min-h-0 flex-1 overflow-y-auto">
        {!wifiOn ? (
          <Empty>Wi-Fi is off</Empty>
        ) : error ? (
          <Empty>{error}</Empty>
        ) : !networks ? (
          <Empty>Looking for networks…</Empty>
        ) : (
          <>
            {connected && renderRow(connected)}
            {message && <div className="px-2 py-1 text-[11.5px] text-[#ff8a80]">{message}</div>}
            {others.length > 0 && <SectionLabel>Networks</SectionLabel>}
            {others.map(renderRow)}
            {networks.length === 0 && <Empty>No networks found</Empty>}
          </>
        )}
      </div>
    </div>
  );
}

function PasswordForm({ error, busy, onSubmit, onCancel }: { error?: string; busy: boolean; onSubmit(pw: string): void; onCancel(): void }) {
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pin = useMemo(pinWhileFocused, []);
  useEffect(() => {
    input.current?.focus();
    return () => pin.onBlur();
  }, [pin]);
  return (
    <form
      className="flex flex-col gap-1.5 px-2 pb-2"
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        if (pw) onSubmit(pw);
      }}
    >
      <div className="flex gap-1.5">
        <input
          ref={input}
          type={show ? "text" : "password"}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          {...pin}
          placeholder="Password"
          aria-label="Wi-Fi password"
          className={`h-8 min-w-0 flex-1 rounded-lg bg-white/10 px-2.5 text-[12.5px] text-white outline-none placeholder:text-white/35 focus:bg-white/15 ${
            error ? "ring-1 ring-[#ff6b5e]" : ""
          }`}
        />
        <button type="button" onClick={() => setShow(!show)} className="rounded-lg px-2 text-[11px] text-white/50 hover:text-white">
          {show ? "Hide" : "Show"}
        </button>
        <button
          type="submit"
          disabled={!pw || busy}
          className="h-8 rounded-lg bg-[#2f7bff] px-3 text-[12px] font-semibold text-white disabled:opacity-40"
        >
          Join
        </button>
      </div>
      <div className="flex justify-between text-[11px]">
        <span className="text-[#ff8a80]">{error}</span>
        <button type="button" onClick={onCancel} className="text-white/40 hover:text-white">
          Cancel
        </button>
      </div>
    </form>
  );
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" className="text-white/35" aria-label="Secured">
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="currentColor" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" strokeWidth="2.2" fill="none" />
    </svg>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="grid h-full min-h-[80px] place-items-center px-4 text-center text-[12px] text-white/45">{children}</div>;
}
