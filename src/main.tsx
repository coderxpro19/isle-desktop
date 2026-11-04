import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { isTauri } from "@/lib/backend";
import { Island } from "@/island/Island";
import "@/styles/index.css";

async function boot() {
  const root = createRoot(document.getElementById("root")!);
  if (isTauri()) {
    // Phase 1 has one window kind; the dock and settings windows (later phases)
    // will be chosen here by window label.
    root.render(
      <StrictMode>
        <Island />
      </StrictMode>,
    );
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
