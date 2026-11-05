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
    let view = <Island />;
    if (label.startsWith("dock-")) {
      const { Dock } = await import("@/dock/Dock");
      view = <Dock />;
    } else if (label === "launcher") {
      const { Launcher } = await import("@/dock/Launcher");
      view = <Launcher />;
    }
    root.render(<StrictMode>{view}</StrictMode>);
  } else {
    const { DevStage } = await import("@/dev/DevStage");
    root.render(
      <StrictMode>
        <DevStage />
      </StrictMode>,
    );
  }
}

void boot();
