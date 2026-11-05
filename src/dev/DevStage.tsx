import { useEffect, useState, type ReactNode } from "react";
import { CANVAS_H, CANVAS_W, Island } from "@/island/Island";
import { useIsland, type Mode, type Tab } from "@/island/store";
import { Dock } from "@/dock/Dock";
import { Launcher } from "@/dock/Launcher";
import { useDock } from "@/dock/store";

/**
 * Browser-only harness (`npm run dev`, open http://localhost:1420): renders the
 * island over a fake desktop with a mock backend and a control panel, so the
 * UI can be designed and screenshotted without building the native app.
 */
export function DevStage() {
  const mode = useIsland((s) => s.mode);
  const media = useIsland((s) => s.media);
  const battery = useIsland((s) => s.battery);
  const tab = useIsland((s) => s.tab);
  const [wallpaper, setWallpaper] = useState(0);
  const [launcher, setLauncher] = useState(false);
  const dockMode = useDock((s) => s.settings.dock.mode);
  useEffect(() => {
    const on = (e: Event) => setLauncher((v) => ((e as CustomEvent).detail === "toggle" ? !v : !!(e as CustomEvent).detail));
    window.addEventListener("isle-mock-launcher", on);
    return () => window.removeEventListener("isle-mock-launcher", on);
  }, []);

  // Allow `?mode=expanded&media=paused&charging=1` for scripted screenshots.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const t = setTimeout(() => {
      const m = q.get("media");
      if (m === "none" || m === "paused" || m === "playing") window.__isleMock?.setMedia(m);
      if (q.get("charging")) window.__isleMock?.setBattery({ charging: true, onAc: true });
      if (q.get("wall")) setWallpaper(Number(q.get("wall")));
      if (q.get("weather")) {
        useIsland.getState().updateSettings((s) => ({ ...s, weather: { ...s.weather, location: { name: "Lagos, Nigeria", latitude: 6.455, longitude: 3.394 } } }));
      }
      if (q.get("focus")) useIsland.getState().updateSettings((s) => ({ ...s, island: { ...s.island, focusMode: true } }));
      const tb = q.get("tab") as Tab | null;
      if (tb) useIsland.setState({ tab: tb });
      if (q.get("launcher")) setLauncher(true);
      const dm = q.get("dock");
      if (dm === "autoHide" || dm === "smart" || dm === "fixed") useDock.setState((s) => ({ settings: { ...s.settings, dock: { ...s.settings.dock, mode: dm } } }));
      if (q.get("preview")) setTimeout(() => useDock.setState({ preview: { key: "chrome", x: window.innerWidth / 2 - 40 } }), 400);
      if (q.get("menu")) setTimeout(() => useDock.setState({ menu: { key: "code", x: window.innerWidth / 2 + 60 } }), 400);
      const cv = q.get("view");
      if (cv === "wifi" || cv === "bluetooth") useIsland.setState({ controlsView: cv });
      const md = q.get("mode") as Mode | null;
      if (md) useIsland.setState({ mode: md, hovered: md !== "compact" });
    }, 150);
    return () => clearTimeout(t);
  }, []);

  const walls = [
    "radial-gradient(1200px 700px at 20% 10%, #3b4c9b 0%, transparent 60%), radial-gradient(900px 600px at 85% 30%, #9b3b7a 0%, transparent 55%), linear-gradient(160deg, #141a33, #2a1530)",
    "linear-gradient(160deg, #e9eef6 0%, #c9d6ea 50%, #f3e7dc 100%)",
    "radial-gradient(800px 500px at 50% 0%, #0f5c4d, transparent 70%), linear-gradient(180deg, #0a1714, #04100c)",
  ];

  return (
    <div className="relative h-screen w-screen overflow-hidden" style={{ background: walls[wallpaper % walls.length] }}>
      <div className="absolute top-0 left-1/2 -translate-x-1/2" style={{ width: CANVAS_W, height: CANVAS_H, outline: "1px dashed rgb(255 255 255 / .12)" }}>
        <Island />
      </div>

      <div className="absolute inset-x-0 bottom-0" style={{ height: 340 }}>
        <Dock />
      </div>
      {launcher && (
        <div className="absolute left-1/2 -translate-x-1/2" style={{ width: 640, height: 560, bottom: 96 }}>
          <Launcher onClose={() => setLauncher(false)} />
        </div>
      )}

      <div className="absolute top-4 right-4 w-[300px] rounded-2xl border border-white/10 bg-black/55 p-4 text-[12px] text-white/80 backdrop-blur-xl">
        <div className="mb-3 text-[13px] font-semibold text-white">Isle dev stage</div>
        <Group label="Mode">
          {(["compact", "peek", "expanded"] as const).map((m) => (
            <Btn key={m} on={mode === m} onClick={() => useIsland.setState({ mode: m, hovered: m !== "compact" })}>
              {m}
            </Btn>
          ))}
        </Group>
        <Group label="Tab">
          {(["home", "controls", "weather", "stats"] as const).map((t) => (
            <Btn key={t} on={tab === t && mode === "expanded"} onClick={() => useIsland.setState({ mode: "expanded", hovered: true, tab: t })}>
              {t}
            </Btn>
          ))}
        </Group>
        <Group label="Media">
          <Btn on={!!media?.playing} onClick={() => window.__isleMock?.setMedia("playing")}>playing</Btn>
          <Btn on={!!media && !media.playing} onClick={() => window.__isleMock?.setMedia("paused")}>paused</Btn>
          <Btn on={!media} onClick={() => window.__isleMock?.setMedia("none")}>none</Btn>
          <Btn onClick={() => window.__isleMock?.nextTrack()}>next ›</Btn>
        </Group>
        <Group label="Battery">
          <Btn on={!!battery?.charging} onClick={() => window.__isleMock?.setBattery({ charging: !battery?.charging, onAc: !battery?.charging })}>
            charger
          </Btn>
          <Btn onClick={() => window.__isleMock?.setBattery({ percent: 21, charging: false })}>21%</Btn>
          <Btn onClick={() => window.__isleMock?.setBattery({ percent: 19, charging: false })}>→19%</Btn>
          <Btn onClick={() => window.__isleMock?.setBattery({ percent: 76 })}>76%</Btn>
        </Group>
        <Group label="Dock">
          {(["fixed", "autoHide", "smart"] as const).map((m) => (
            <Btn key={m} on={dockMode === m} onClick={() => useDock.setState((s) => ({ settings: { ...s.settings, dock: { ...s.settings.dock, mode: m } } }))}>
              {m}
            </Btn>
          ))}
          <Btn on={launcher} onClick={() => setLauncher(!launcher)}>start</Btn>
        </Group>
        <Group label="Wallpaper">
          {walls.map((_, i) => (
            <Btn key={i} on={wallpaper === i} onClick={() => setWallpaper(i)}>
              {["dusk", "light", "forest"][i]}
            </Btn>
          ))}
        </Group>
        <p className="mt-2 text-[11px] leading-snug text-white/40">
          Hover the island to peek, click to expand. Mock data only — run <code>npm run app:dev</code> on Windows for the real thing.
        </p>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-2.5">
      <div className="mb-1 text-[10.5px] tracking-wide text-white/40 uppercase">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Btn({ on, onClick, children }: { on?: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-2.5 py-1 transition ${on ? "bg-white text-black" : "bg-white/10 hover:bg-white/20"}`}
    >
      {children}
    </button>
  );
}
