import { useRef } from "react";
import { fmtSize, removeFromShelf } from "../shelf";
import { useIsland, type ShelfItem } from "../store";
import { CloseIcon, FileIcon, FolderIcon, ShelfIcon } from "./icons";

const DRAG_PX = 5;

export function ShelfPanel() {
  const items = useIsland((s) => s.shelf);
  const dropping = useIsland((s) => s.dropping);

  return (
    <div className="flex h-full flex-col px-4 pb-3" onClick={(e) => e.stopPropagation()}>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12px] font-semibold text-white/85">Shelf</span>
        {items.length > 0 && (
          <button type="button" onClick={() => removeFromShelf(null)} className="text-[11px] text-white/45 hover:text-white">
            Clear
          </button>
        )}
      </div>
      <div
        className={`relative min-h-0 flex-1 rounded-2xl transition-colors ${
          dropping ? "bg-[#2f7bff]/16 outline-2 -outline-offset-2 outline-dashed outline-[#5aa2ff]" : items.length ? "" : "bg-white/5 outline-1 -outline-offset-1 outline-dashed outline-white/15"
        }`}
      >
        {items.length === 0 || dropping ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <ShelfIcon size={28} className={dropping ? "text-[#7cb5ff]" : "text-white/30"} />
            <div className={`mt-2 text-[12.5px] font-medium ${dropping ? "text-[#a9ccff]" : "text-white/50"}`}>
              {dropping ? "Drop to keep it here" : "Drag files onto the island"}
            </div>
            {!dropping && <div className="mt-0.5 text-[11px] text-white/30">then drag them out to any app or folder</div>}
          </div>
        ) : (
          <div className="isle-scroll grid h-full grid-cols-5 content-start gap-1.5 overflow-y-auto">
            {items.map((it) => (
              <Tile key={it.path} it={it} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ it }: { it: ShelfItem }) {
  const backend = useIsland((s) => s.backend);
  const start = useRef<{ x: number; y: number } | null>(null);

  return (
    <div
      title={`${it.name}${it.isDir ? "" : ` · ${fmtSize(it.size)}`}${it.exists ? "" : " (missing)"}\nDouble-click to open · right-click to show in folder · drag out to move`}
      className={`group relative flex h-[84px] flex-col items-center rounded-xl px-1 pt-2 hover:bg-white/8 ${it.exists ? "" : "opacity-40"}`}
      onPointerDown={(e) => {
        if (e.button === 0) start.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s || (e.buttons & 1) === 0) return;
        if (Math.abs(e.clientX - s.x) + Math.abs(e.clientY - s.y) < DRAG_PX) return;
        start.current = null;
        void backend?.shelfDrag([it.path]).catch(() => {});
      }}
      onPointerUp={() => (start.current = null)}
      onDoubleClick={() => it.exists && void backend?.shelfOpen(it.path)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (it.exists) void backend?.shelfReveal(it.path);
      }}
    >
      <div className="grid h-11 w-11 place-items-center">
        {it.thumb ? (
          <img src={it.thumb} alt="" className="max-h-11 max-w-11 rounded-md object-contain" draggable={false} />
        ) : it.isDir ? (
          <FolderIcon size={38} className="text-[#7cb5ff]" />
        ) : (
          <FileIcon size={36} className="text-white/70" />
        )}
      </div>
      <div className="mt-1 line-clamp-2 w-full text-center text-[10.5px] leading-tight break-words text-white/85">{it.name}</div>
      <button
        type="button"
        aria-label="Remove from shelf"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          removeFromShelf(it.path);
        }}
        className="absolute top-0.5 right-0.5 hidden h-[18px] w-[18px] place-items-center rounded-full bg-white/15 text-white/80 group-hover:grid hover:bg-white/30"
      >
        <CloseIcon size={10} />
      </button>
    </div>
  );
}
