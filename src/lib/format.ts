const pad = (n: number) => String(n).padStart(2, "0");

/** 9:41, 21:41, 9:41:07, or "9:41 pm" with `period`. */
export function formatClock(d: Date, h24: boolean, seconds: boolean, period = false): string {
  const h = d.getHours();
  const hh = h24 ? pad(h) : String(h % 12 || 12);
  const ss = seconds ? `:${pad(d.getSeconds())}` : "";
  const suffix = !h24 && period ? (h < 12 ? " am" : " pm") : "";
  return `${hh}:${pad(d.getMinutes())}${ss}${suffix}`;
}

export function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** 3:07, 1:02:45 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}
