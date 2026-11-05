/** File shelf state helpers: items are file references kept in localStorage. */
import { useEffect } from "react";
import { useIsland, type ShelfItem } from "./store";

const KEY = "isle.shelf.v1";
export const SHELF_MAX = 30;

function save(items: ShelfItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.map((i) => i.path)));
  } catch {
    /* storage unavailable */
  }
}

function load(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

/** New paths go first; existing ones move to the front. */
export function mergePaths(current: string[], added: string[]): string[] {
  const fresh = added.filter((p, i) => added.indexOf(p) === i);
  return [...fresh, ...current.filter((p) => !fresh.includes(p))].slice(0, SHELF_MAX);
}

let seq = 0;

async function refresh(paths: string[]) {
  const { backend } = useIsland.getState();
  if (!backend) return;
  const mine = ++seq;
  const infos = await backend.shelfInfo(paths).catch(() => []);
  if (mine !== seq) return; // a newer change superseded this one
  const prev = new Map(useIsland.getState().shelf.map((i) => [i.path, i]));
  const items: ShelfItem[] = infos.map((i) => ({ ...i, thumb: prev.get(i.path)?.thumb }));
  useIsland.setState({ shelf: items });
  save(items);
  for (const it of items) {
    if (it.thumb !== undefined || !it.exists) continue;
    const thumb = await backend.shelfThumb(it.path).catch(() => null);
    useIsland.setState((s) => ({ shelf: s.shelf.map((x) => (x.path === it.path ? { ...x, thumb } : x)) }));
  }
}

const placeholder = (path: string): ShelfItem => ({ path, name: path.split(/[\\/]/).pop() ?? path, exists: true, isDir: false, size: 0 });

/** Update the list now (so later reads see it), then fill in file details. */
function setPaths(paths: string[]) {
  const prev = new Map(useIsland.getState().shelf.map((i) => [i.path, i]));
  useIsland.setState({ shelf: paths.map((p) => prev.get(p) ?? placeholder(p)) });
  void refresh(paths);
}

export function addToShelf(paths: string[]) {
  if (!paths.length) return;
  setPaths(mergePaths(useIsland.getState().shelf.map((i) => i.path), paths));
}

export function removeFromShelf(path: string | null) {
  const items = path === null ? [] : useIsland.getState().shelf.filter((i) => i.path !== path);
  useIsland.setState({ shelf: items });
  save(items);
}

/** Load the shelf, and turn file drags over the island into shelf drops. */
export function useShelf() {
  const backend = useIsland((s) => s.backend);
  const tab = useIsland((s) => s.tab);
  const mode = useIsland((s) => s.mode);
  useEffect(() => {
    if (!backend) return;
    setPaths(mergePaths(load(), useIsland.getState().shelf.map((i) => i.path)));
    return backend.onFileDrop((e) => {
      if (e.type === "enter") {
        useIsland.setState({ dropping: true, mode: "expanded", tab: "shelf", hovered: true, islandMenu: false });
      } else if (e.type === "leave") {
        useIsland.setState({ dropping: false });
      } else if (e.type === "drop") {
        useIsland.setState({ dropping: false });
        addToShelf(e.paths);
      }
    });
  }, [backend]);
  // Files may have moved or been deleted since: re-check when the shelf opens.
  useEffect(() => {
    if (backend && mode === "expanded" && tab === "shelf") void refresh(useIsland.getState().shelf.map((i) => i.path));
  }, [backend, mode, tab]);
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}
