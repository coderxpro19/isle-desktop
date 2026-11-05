/**
 * Minimal iCalendar (RFC 5545) reader for calendar feeds: VEVENTs with
 * SUMMARY / LOCATION / DTSTART / DTEND / DURATION, all-day events, and common
 * recurrence (RRULE FREQ=DAILY|WEEKLY|MONTHLY|YEARLY with INTERVAL, COUNT,
 * UNTIL, BYDAY for weekly) plus EXDATE. Times with a TZID are read as local
 * time, which is right for the overwhelmingly common case of a feed in the
 * user's own time zone.
 */

export interface CalEvent {
  id: string;
  title: string;
  location: string | null;
  start: number; // epoch ms
  end: number;
  allDay: boolean;
  feed: string;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

function unfold(text: string): string[] {
  return text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
}

function parseLine(line: string): Prop | null {
  const colon = findValueColon(line);
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...params] = head.split(";");
  const p: Record<string, string> = {};
  for (const kv of params) {
    const i = kv.indexOf("=");
    if (i > 0) p[kv.slice(0, i).toUpperCase()] = kv.slice(i + 1).replace(/^"|"$/g, "");
  }
  return { name: name!.toUpperCase(), params: p, value };
}

/** First ':' not inside a quoted parameter value. */
function findValueColon(line: string): number {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ":" && !quoted) return i;
  }
  return -1;
}

function unescape(v: string): string {
  return v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1").trim();
}

/** Returns [epoch ms, isDateOnly]. */
export function parseDate(value: string, params: Record<string, string> = {}): [number, boolean] | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const dateOnly = params.VALUE === "DATE" || h === undefined;
  if (dateOnly) return [new Date(+y!, +mo! - 1, +d!).getTime(), true];
  if (z) return [Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +(s ?? 0)), false];
  return [new Date(+y!, +mo! - 1, +d!, +h!, +mi!, +(s ?? 0)).getTime(), false];
}

function parseDuration(v: string): number {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return 0;
  const [, sign, w, d, h, mi, s] = m;
  const ms = ((+(w ?? 0) * 7 + +(d ?? 0)) * 86400 + +(h ?? 0) * 3600 + +(mi ?? 0) * 60 + +(s ?? 0)) * 1000;
  return sign === "-" ? -ms : ms;
}

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

interface Rule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count: number | null;
  until: number | null;
  byday: number[] | null;
}

function parseRule(v: string): Rule | null {
  const parts = Object.fromEntries(v.split(";").map((kv) => kv.split("=") as [string, string]));
  const freq = parts.FREQ as Rule["freq"];
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return null;
  const until = parts.UNTIL ? parseDate(parts.UNTIL)?.[0] ?? null : null;
  const byday = parts.BYDAY
    ? parts.BYDAY.split(",")
        .map((d) => DAYS.indexOf(d.slice(-2)))
        .filter((d) => d >= 0)
    : null;
  return { freq, interval: Math.max(1, +(parts.INTERVAL ?? 1)), count: parts.COUNT ? +parts.COUNT : null, until, byday };
}

/** Occurrence starts of a recurring event that fall in [from, to). */
export function expand(start: number, rule: Rule, from: number, to: number, exdates: Set<number>): number[] {
  const out: number[] = [];
  const base = new Date(start);
  let emitted = 0;
  const limit = 2000; // safety
  const push = (t: number) => {
    if (rule.until !== null && t > rule.until) return false;
    if (rule.count !== null && emitted >= rule.count) return false;
    emitted++;
    if (t >= from && t < to && !exdates.has(t)) out.push(t);
    return t < to;
  };
  for (let i = 0; i < limit; i++) {
    const d = new Date(base);
    if (rule.freq === "DAILY") d.setDate(base.getDate() + i * rule.interval);
    else if (rule.freq === "WEEKLY") d.setDate(base.getDate() + i * 7 * rule.interval);
    else if (rule.freq === "MONTHLY") d.setMonth(base.getMonth() + i * rule.interval);
    else d.setFullYear(base.getFullYear() + i * rule.interval);

    if (rule.freq === "WEEKLY" && rule.byday?.length) {
      // Each listed weekday within this week, in order, never before DTSTART.
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      for (const wd of [...rule.byday].sort((a, b) => a - b)) {
        const o = new Date(weekStart);
        o.setDate(weekStart.getDate() + wd);
        o.setHours(base.getHours(), base.getMinutes(), base.getSeconds(), 0);
        if (o.getTime() < start) continue;
        if (!push(o.getTime())) return out;
      }
    } else if (!push(d.getTime())) return out;
  }
  return out;
}

/** All events in [from, to) from one feed's text. */
export function parseIcs(text: string, feed: string, from: number, to: number): CalEvent[] {
  const out: CalEvent[] = [];
  let cur: Prop[] | null = null;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") cur = [];
    else if (line === "END:VEVENT" && cur) {
      out.push(...toEvents(cur, feed, from, to));
      cur = null;
    } else if (cur) {
      const p = parseLine(line);
      if (p) cur.push(p);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

function toEvents(props: Prop[], feed: string, from: number, to: number): CalEvent[] {
  const get = (n: string) => props.find((p) => p.name === n);
  const ds = get("DTSTART");
  const start = ds && parseDate(ds.value, ds.params);
  if (!start) return [];
  if (get("STATUS")?.value.toUpperCase() === "CANCELLED") return [];
  const de = get("DTEND");
  const end = de ? parseDate(de.value, de.params)?.[0] : undefined;
  const dur = get("DURATION");
  const length = end !== undefined ? end - start[0] : dur ? parseDuration(dur.value) : start[1] ? 86400_000 : 0;
  const base = {
    title: unescape(get("SUMMARY")?.value ?? "(No title)"),
    location: get("LOCATION") ? unescape(get("LOCATION")!.value) || null : null,
    allDay: start[1],
    feed,
  };
  const uid = get("UID")?.value ?? `${base.title}-${start[0]}`;
  const rrule = get("RRULE");
  const rule = rrule && parseRule(rrule.value);
  const ex = new Set(
    props
      .filter((p) => p.name === "EXDATE")
      .flatMap((p) => p.value.split(",").map((v) => parseDate(v, p.params)?.[0]))
      .filter((v): v is number => v !== undefined),
  );
  const starts = rule ? expand(start[0], rule, from - length, to, ex) : start[0] + length > from && start[0] < to ? [start[0]] : [];
  return starts.map((s) => ({ ...base, id: `${feed}:${uid}:${s}`, start: s, end: s + length }));
}
