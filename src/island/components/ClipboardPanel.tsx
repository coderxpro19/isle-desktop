import { useEffect, useMemo, useRef, useState } from "react";
import type { Clip } from "@/lib/types";
import { useIsland } from "../store";
import { ago } from "./NotificationsPanel";
import { ClipboardIcon, CloseIcon, FileIcon, SearchIcon, StarIcon } from "./icons";

type Filter = "all" | "text" | "image" | "files" | "pinned";
const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["pinned", "Pinned"],
  ["text", "Text"],
  ["image", "Images"],
  ["files", "Files"],
];

const base = (p: string) => p.split(/[\\/]/).pop() ?? p;

export function clipMatches(c: Clip, q: string, f: Filter): boolean {
  if (f === "pinned" ? !c.pinned : f !== "all" && c.kind !== f) return false;
  if (!q) return true;
  const hay = `${c.text ?? ""} ${c.files.join(" ")} ${c.app ?? ""}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((w) => hay.includes(w));
}

/** Pinned first, then newest. */
export function orderClips(clips: Clip[]): Clip[] {
  return [...clips].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.atMs - a.atMs);
}

export function ClipboardPanel() {
  const clips = useIsland((s) => s.clips);
  const summoned = useIsland((s) => s.summoned);
  const enabled = useIsland((s) => s.settings.island.clipboardHistory);
  const backend = useIsland((s) => s.backend);
  const updateSettings = useIsland((s) => s.updateSettings);
  const now = useIsland((s) => s.now).getTime();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => orderClips(clips).filter((c) => clipMatches(c, q.trim(), filter)), [clips, q, filter]);
  useEffect(() => setSel(0), [q, filter]);
  useEffect(() => {
    if (summoned) {
      setQ("");
      setSel(0);
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [summoned]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const use = (c: Clip) => {
    const paste = useIsland.getState().summoned;
    void backend?.clipCopy(c.id, paste).catch(() => {});
    useIsland.setState({ summoned: false, hovered: false, mode: "compact" });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") setSel((i) => Math.min(shown.length - 1, i + 1));
    else if (e.key === "ArrowUp") setSel((i) => Math.max(0, i - 1));
    else if (e.key === "Enter" && shown[sel]) use(shown[sel]);
    else if (e.key === "Delete" && shown[sel] && e.target === input.current && !q) void backend?.clipDelete(shown[sel].id);
    else return;
    e.preventDefault();
  };

  return (
    <div className="flex h-full flex-col px-4 pb-3" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
      <div className="mb-2 flex items-center gap-2">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-full bg-white/8 px-3 focus-within:bg-white/12">
          <SearchIcon size={13} className="shrink-0 text-white/40" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search clipboard"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-white outline-none placeholder:text-white/35"
          />
        </label>
        <button
          type="button"
          onClick={() => updateSettings((s) => ({ ...s, island: { ...s.island, clipboardHistory: !s.island.clipboardHistory } }))}
          className="text-[11px] whitespace-nowrap text-white/45 hover:text-white"
          title="Record what you copy"
        >
          {enabled ? "Recording" : "Paused"}
        </button>
        {clips.some((c) => !c.pinned) && (
          <button type="button" onClick={() => void backend?.clipDelete(null)} className="text-[11px] whitespace-nowrap text-white/45 hover:text-white">
            Clear
          </button>
        )}
      </div>
      <div className="mb-1.5 flex gap-1">
        {FILTERS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`rounded-full px-2.5 py-0.5 text-[11px] ${filter === id ? "bg-white/16 text-white" : "text-white/45 hover:text-white/80"}`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto self-center text-[10.5px] whitespace-nowrap text-white/30">{summoned ? "Enter to paste" : "Alt+Shift+V"}</span>
      </div>
      <div ref={list} className="isle-scroll min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
        {shown.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center pb-4 text-center">
            <ClipboardIcon size={26} className="text-white/25" />
            <div className="mt-2 text-[12px] text-white/40">{clips.length ? "No matches" : enabled ? "Copy something — it'll show up here" : "Clipboard history is paused"}</div>
          </div>
        )}
        {shown.map((c, i) => (
          <div
            key={c.id}
            data-i={i}
            role="button"
            tabIndex={-1}
            onMouseMove={() => sel !== i && setSel(i)}
            onClick={() => use(c)}
            className={`group flex cursor-default items-center gap-2.5 rounded-xl px-2.5 py-1.5 ${i === sel ? "bg-white/12" : "bg-white/5"}`}
          >
            <ClipBody c={c} />
            <div className="flex shrink-0 items-center gap-1">
              <span className="text-[10.5px] text-white/35">
                {c.app ? `${c.app} · ` : ""}
                {ago(c.atMs, now)}
              </span>
              <span className="flex">
                <button
                  type="button"
                  aria-label={c.pinned ? "Unpin" : "Pin"}
                  onClick={(e) => {
                    e.stopPropagation();
                    void backend?.clipPin(c.id, !c.pinned);
                  }}
                  className={`grid h-5 w-5 place-items-center rounded-full hover:bg-white/15 ${c.pinned ? "text-[#ffd25a]" : "text-white/40 opacity-0 group-hover:opacity-100"}`}
                >
                  <StarIcon size={12} filled={c.pinned} />
                </button>
                <button
                  type="button"
                  aria-label="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    void backend?.clipDelete(c.id);
                  }}
                  className="grid h-5 w-5 place-items-center rounded-full text-white/40 opacity-0 group-hover:opacity-100 hover:bg-white/15"
                >
                  <CloseIcon size={11} />
                </button>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ClipBody({ c }: { c: Clip }) {
  if (c.kind === "image") {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {c.preview && <img src={c.preview} alt="" className="h-11 max-w-[88px] rounded-md object-cover" draggable={false} />}
        <span className="text-[11.5px] text-white/55 tabular-nums">
          Image · {c.width}×{c.height}
        </span>
      </div>
    );
  }
  if (c.kind === "files") {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <FileIcon size={20} className="shrink-0 text-white/60" />
        <span className="truncate text-[12.5px] text-white/90">
          {c.files.map(base).join(", ")}
          {c.files.length > 1 && <span className="text-white/40"> · {c.files.length} files</span>}
        </span>
      </div>
    );
  }
  const t = (c.text ?? "").replace(/\s+/g, " ").trim();
  const isLink = /^https?:\/\/\S+$/.test(t);
  return <div className={`line-clamp-2 min-w-0 flex-1 text-[12.5px] leading-snug break-words ${isLink ? "text-[#8ab8ff]" : "text-white/90"}`}>{t}</div>;
}
