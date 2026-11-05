import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { isTauri } from "@/lib/backend";
import { Island } from "@/island/Island";
import "@/styles/index.css";

async function boot() {
  const root = createRoot(document.getElementById("root")!);
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const log = (level: string, message: string) => void invoke("ui_log", { level, message }).catch(() => {});
    window.addEventListener("error", (e) => log("error", `${e.message} @ ${e.filename}:${e.lineno}`));
    window.addEventListener("unhandledrejection", (e) => log("error", `unhandled: ${String(e.reason)}`));
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const label = getCurrentWebviewWindow().label;
    log("info", "ui booting");
    // No browser right-click menu (Back / Refresh / Print…) anywhere in Isle;
    // views that need a menu draw their own.
    window.addEventListener("contextmenu", (e) => e.preventDefault());
    // Nor browser reload/print/find shortcuts.
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (e.key === "F5" || ((e.ctrlKey || e.metaKey) && ["r", "p", "f", "g", "j", "u"].includes(k))) e.preventDefault();
    });
    let view = <Island />;
    if (label.startsWith("dock-")) {
      const { Dock } = await import("@/dock/Dock");
      view = <Dock />;
    } else if (label === "launcher") {
      const { Launcher } = await import("@/dock/Launcher");
      view = <Launcher />;
    } else if (label === "settings") {
      document.documentElement.classList.add("settings-root");
      const { SettingsApp } = await import("@/settings/SettingsApp");
      view = <SettingsApp />;
    }
    root.render(<StrictMode>{view}</StrictMode>);
  } else {
    // `?view=dock` / `?view=launcher` render a window's UI exactly as the
    // native window does (full-window, no dev container) for layout checks.
    const view = new URLSearchParams(location.search).get("view");
    if (view === "settings") {
      document.documentElement.classList.add("settings-root");
      const { SettingsApp } = await import("@/settings/SettingsApp");
      root.render(<StrictMode><SettingsApp /></StrictMode>);
    } else if (view === "dock") {
      const { Dock } = await import("@/dock/Dock");
      root.render(<StrictMode><Dock /></StrictMode>);
    } else if (view === "launcher") {
      const { Launcher } = await import("@/dock/Launcher");
      root.render(<StrictMode><Launcher /></StrictMode>);
    } else {
      const { DevStage } = await import("@/dev/DevStage");
      root.render(
        <StrictMode>
          <DevStage />
        </StrictMode>,
      );
    }
  }
}

void boot();
