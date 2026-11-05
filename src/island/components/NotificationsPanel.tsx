import type { Notice } from "@/lib/types";
import { useIsland } from "../store";
import { BellIcon, CloseIcon } from "./icons";

export function ago(atMs: number, now: number): string {
  const m = Math.floor((now - atMs) / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function NoticeIcon({ n, size = 30 }: { n: Notice; size?: number }) {
  return n.icon ? (
    <img src={n.icon} alt="" className="shrink-0 rounded-[8px] object-contain" style={{ width: size, height: size }} draggable={false} />
  ) : (
    <div className="grid shrink-0 place-items-center rounded-[8px] bg-white/12 text-[13px] font-bold text-white/80" style={{ width: size, height: size }}>
      {n.app.slice(0, 1).toUpperCase()}
    </div>
  );
}

export function openNotice(n: Notice) {
  const { backend } = useIsland.getState();
  void backend?.notifyOpen(n.appId).catch(() => {});
  void backend?.notifyDismiss(n.id);
  useIsland.setState({ mode: "compact", hovered: false, transient: null });
}

export function NotificationsPanel() {
  const { access, items } = useIsland((s) => s.notices);
  const backend = useIsland((s) => s.backend);
  const now = useIsland((s) => s.now).getTime();
  const enabled = useIsland((s) => s.settings.island.notifications);
  const updateSettings = useIsland((s) => s.updateSettings);

  if (access === "denied" || access === "unsupported") {
    return (
      <Empty>
        <div className="max-w-[300px] text-[12.5px] leading-snug text-white/60">
          {access === "denied"
            ? "Windows is blocking Isle from reading notifications. Turn on “Let apps access your notifications”."
            : "Notifications aren't available on this version of Windows."}
        </div>
        {access === "denied" && (
          <button type="button" onClick={() => void backend?.notifySettings()} className="mt-3 rounded-full bg-white px-4 py-1.5 text-[12px] font-semibold text-black">
            Open settings
          </button>
        )}
      </Empty>
    );
  }

  return (
    <div className="flex h-full flex-col px-4 pb-3" onClick={(e) => e.stopPropagation()}>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12px] font-semibold text-white/85">Notifications</span>
        <span className="flex items-center gap-3">
          <button
            type="button"
            title="Show new notifications on the island"
            onClick={() => updateSettings((s) => ({ ...s, island: { ...s.island, notifications: !s.island.notifications } }))}
            className="text-[11px] text-white/45 hover:text-white"
          >
            Pop-ups: {enabled ? "On" : "Off"}
          </button>
          {items.length > 0 && (
            <button type="button" onClick={() => void backend?.notifyDismiss(null)} className="text-[11px] text-white/45 hover:text-white">
              Clear all
            </button>
          )}
        </span>
      </div>
      {items.length === 0 ? (
        <Empty>
          <BellIcon size={26} className="text-white/25" />
          <div className="mt-2 text-[12px] text-white/40">No notifications</div>
        </Empty>
      ) : (
        <div className="isle-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
          {items.map((n) => (
            <div
              key={n.id}
              role="button"
              tabIndex={0}
              onClick={() => openNotice(n)}
              className="group relative flex cursor-default gap-2.5 rounded-2xl bg-white/7 px-3 py-2 transition-colors hover:bg-white/11"
            >
              <NoticeIcon n={n} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[11px] font-medium text-white/45">{n.app}</span>
                  <span className="shrink-0 text-[10.5px] text-white/35 group-hover:invisible">{ago(n.atMs, now)}</span>
                </div>
                <div className="truncate text-[12.5px] font-semibold text-white">{n.title}</div>
                {n.body && <div className="line-clamp-2 text-[12px] leading-snug text-white/65">{n.body}</div>}
              </div>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={(e) => {
                  e.stopPropagation();
                  void backend?.notifyDismiss(n.id);
                }}
                className="absolute top-1.5 right-1.5 hidden h-5 w-5 place-items-center rounded-full bg-white/12 text-white/70 group-hover:grid hover:bg-white/25"
              >
                <CloseIcon size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center pb-4 text-center">{children}</div>;
}
