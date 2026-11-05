import type { ReactNode } from "react";
import { useDock, type Popup } from "./store";

const W = 236;

export function DockMenu({ popup, canvasW, bottom }: { popup: Popup; canvasW: number; bottom: number }) {
  const left = Math.min(Math.max(8, popup.x - W / 2), canvasW - W - 8);
  const close = () => useDock.setState({ menu: null });
  return (
    <>
      {/* Click anywhere else in the dock to dismiss. */}
      <div className="absolute inset-0" onPointerDown={close} />
      <div
        data-dock-popup
        role="menu"
        className="absolute rounded-xl border border-white/10 bg-[rgba(24,24,28,0.96)] p-1.5 text-[12.5px] text-white shadow-[0_12px_40px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
        style={{ left, bottom, width: W }}
      >
        {popup.key.startsWith("place:") ? <PlaceMenu place={popup.key.slice(6)} close={close} /> : <AppMenu appKey={popup.key} close={close} />}
      </div>
    </>
  );
}

function AppMenu({ appKey, close }: { appKey: string; close(): void }) {
  const app = useDock((s) => s.apps.find((a) => a.key === appKey));
  const backend = useDock((s) => s.backend);
  if (!app || !backend) return null;
  const run = (f: () => unknown) => () => {
    void f();
    close();
  };
  return (
    <>
      <div className="truncate px-2.5 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-white/40 uppercase">{app.name}</div>
      {app.windows.map((w) => (
        <Item key={w.hwnd} onClick={run(() => backend.dockWindow(w.hwnd, "activate"))}>
          <span className="truncate">{w.title}</span>
          {w.minimized && <span className="ml-auto text-[10.5px] text-white/35">min</span>}
        </Item>
      ))}
      {app.windows.length > 0 && <Sep />}
      <Item onClick={run(() => backend.dockLaunch(app.key))}>{app.running ? "New window" : "Open"}</Item>
      <Item onClick={run(() => backend.dockPin(app.key, app.name, !app.pinned))}>{app.pinned ? "Unpin from dock" : "Pin to dock"}</Item>
      {app.running && (
        <>
          <Sep />
          <Item danger onClick={run(() => Promise.all(app.windows.map((w) => backend.dockWindow(w.hwnd, "close"))))}>
            {app.windows.length > 1 ? "Close all windows" : "Close window"}
          </Item>
        </>
      )}
    </>
  );
}

function PlaceMenu({ place, close }: { place: string; close(): void }) {
  const backend = useDock((s) => s.backend);
  const items = useDock((s) => s.recycleItems);
  if (!backend) return null;
  if (place === "downloads") {
    return (
      <>
        <Item onClick={() => (void backend.dockOpenPlace("downloads"), close())}>Open Downloads</Item>
        <Item onClick={() => (void backend.dockOpenPlace("documents"), close())}>Open Documents</Item>
        <Item onClick={() => (void backend.dockOpenPlace("this-pc"), close())}>This PC</Item>
      </>
    );
  }
  return (
    <>
      <Item onClick={() => (void backend.dockOpenPlace("recycle"), close())}>Open Recycle Bin</Item>
      <Item danger disabled={!items} onClick={() => (void backend.dockEmptyRecycleBin(), close())}>
        Empty Recycle Bin…
      </Item>
    </>
  );
}

function Item({ children, onClick, danger, disabled }: { children: ReactNode; onClick(): void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-white/10 disabled:opacity-35 disabled:hover:bg-transparent ${
        danger ? "text-[#ff8a80]" : ""
      }`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div className="mx-2 my-1 h-px bg-white/10" />;
}
