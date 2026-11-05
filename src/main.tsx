import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { isTauri } from "@/lib/backend";
import { Island } from "@/island/Island";
import "@/styles/index.css";

async function boot() {
  const root = createRoot(document.getElementById("root")!);
  if (isTauri()) {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const label = getCurrentWebviewWindow().label;
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
