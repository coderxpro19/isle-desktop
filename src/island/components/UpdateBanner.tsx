import { useEffect } from "react";
import { useIsland } from "../store";

/** Height the banner adds to the Home tab when shown. */
export const UPDATE_BANNER_H = 40;

export function useShowUpdateBanner(): boolean {
  return useIsland((s) => s.update.kind !== "idle");
}

export function UpdateBanner() {
  const u = useIsland((s) => s.update);
  const backend = useIsland((s) => s.backend);

  const install = (info: { version: string; notes: string | null }) => {
    if (!backend) return;
    const unpin = useIsland.getState().pin();
    useIsland.setState({ update: { kind: "installing", info, progress: null } });
    backend
      .installUpdate((progress) => useIsland.setState({ update: { kind: "installing", info, progress } }))
      .catch((e: unknown) => {
        useIsland.setState({ update: { kind: "error", info, message: e instanceof Error ? e.message : String(e) } });
      })
      .finally(unpin);
  };

  const recheck = () => {
    if (!backend) return;
    useIsland.setState({ update: { kind: "checking" } });
    backend
      .checkUpdate()
      .then((info) => useIsland.setState({ update: info ? { kind: "available", info } : { kind: "upToDate" } }))
      .catch((e: unknown) => useIsland.setState({ update: { kind: "error", message: e instanceof Error ? e.message : String(e) } }));
  };

  // Put the reason in Isle.log (main.tsx forwards window errors there).
  const errMsg = u.kind === "error" ? u.message : null;
  useEffect(() => {
    if (errMsg) window.dispatchEvent(new ErrorEvent("error", { message: `updater: ${errMsg}` }));
  }, [errMsg]);

  let text: string;
  let action: { label: string; run(): void } | null = null;
  let progress: number | null | undefined;
  switch (u.kind) {
    case "idle":
      return null;
    case "checking":
      text = "Checking for updates…";
      break;
    case "upToDate":
      text = "Isle is up to date";
      break;
    case "available":
      text = `Isle ${u.info.version} is available`;
      action = { label: "Update", run: () => install(u.info) };
      break;
    case "installing":
      text = u.progress === 1 ? "Installing — Isle will restart…" : `Downloading ${u.info.version}…`;
      progress = u.progress;
      break;
    case "error":
      text = `Update failed: ${u.message.replace(/^Error:\s*/, "")}`;
      action = u.info ? { label: "Retry", run: () => install(u.info!) } : { label: "Retry", run: recheck };
      break;
  }

  return (
    <div className="mx-4 mb-1 flex h-[34px] items-center gap-2.5 overflow-hidden rounded-xl bg-[#2f7bff]/18 px-3" onClick={(e) => e.stopPropagation()}>
      <span className="h-2 w-2 shrink-0 rounded-full bg-[#5aa2ff]" />
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-white" title={u.kind === "error" ? u.message : undefined}>
        {text}
      </span>
      {progress !== undefined && (
        <div className="h-[4px] w-24 overflow-hidden rounded-full bg-white/15">
          <div
            className={`h-full rounded-full bg-white ${progress === null ? "w-1/3 animate-pulse" : ""}`}
            style={progress === null ? undefined : { width: `${progress * 100}%`, transition: "width 120ms linear" }}
          />
        </div>
      )}
      {action && (
        <button
          type="button"
          onClick={action.run}
          className="rounded-lg bg-[#2f7bff] px-3 py-1 text-[11.5px] font-semibold text-white transition active:scale-95"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/** Small dot on the compact pill when an update is waiting. */
export function UpdateDot() {
  const show = useIsland((s) => s.update.kind === "available");
  return show ? <span className="h-[6px] w-[6px] rounded-full bg-[#5aa2ff]" aria-label="Update available" /> : null;
}
