import { describe, expect, it } from "vitest";
import { parseDate, parseIcs } from "./ics";

const wrap = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;
const day = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();

describe("ics", () => {
  it("parses dates", () => {
    expect(parseDate("20261105")).toEqual([day(2026, 11, 5), true]);
    expect(parseDate("20261105T093000Z")).toEqual([Date.UTC(2026, 10, 5, 9, 30), false]);
    expect(parseDate("20261105T093000", { TZID: "Africa/Lagos" })).toEqual([day(2026, 11, 5, 9, 30), false]);
  });

  it("reads a simple event with folded summary", () => {
    const text = wrap(
      "BEGIN:VEVENT\r\nUID:a1\r\nDTSTART:20261105T100000\r\nDTEND:20261105T110000\r\nSUMMARY:Design re\r\n view\\, Isle\r\nLOCATION:Room 4\r\nEND:VEVENT",
    );
    const ev = parseIcs(text, "f", day(2026, 11, 1), day(2026, 11, 30));
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ title: "Design review, Isle", location: "Room 4", start: day(2026, 11, 5, 10), end: day(2026, 11, 5, 11), allDay: false });
  });

  it("handles all-day events", () => {
    const text = wrap("BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261224\r\nSUMMARY:Holiday\r\nEND:VEVENT");
    const [e] = parseIcs(text, "f", day(2026, 12, 1), day(2026, 12, 31));
    expect(e!.allDay).toBe(true);
    expect(e!.end - e!.start).toBe(86400_000);
  });

  it("expands weekly BYDAY with COUNT and EXDATE", () => {
    const text = wrap(
      "BEGIN:VEVENT\r\nDTSTART:20261102T090000\r\nDURATION:PT30M\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6\r\nEXDATE:20261104T090000\r\nSUMMARY:Standup\r\nEND:VEVENT",
    );
    const ev = parseIcs(text, "f", day(2026, 11, 1), day(2026, 12, 31));
    const dates = ev.map((e) => new Date(e.start).getDate());
    // Mon 2, (Wed 4 excluded), Mon 9, Wed 11, Mon 16, Wed 18 → 6 occurrences counted, 5 shown
    expect(dates).toEqual([2, 9, 11, 16, 18]);
    expect(ev[0]!.end - ev[0]!.start).toBe(30 * 60_000);
  });

  it("respects UNTIL and window", () => {
    const text = wrap("BEGIN:VEVENT\r\nDTSTART:20261101T080000\r\nRRULE:FREQ=DAILY;UNTIL=20261105T235959Z\r\nSUMMARY:Gym\r\nEND:VEVENT");
    const ev = parseIcs(text, "f", day(2026, 11, 3), day(2026, 11, 30));
    expect(ev.map((e) => new Date(e.start).getDate())).toEqual([3, 4, 5]);
  });

  it("skips cancelled events", () => {
    const text = wrap("BEGIN:VEVENT\r\nDTSTART:20261105T100000\r\nSTATUS:CANCELLED\r\nSUMMARY:X\r\nEND:VEVENT");
    expect(parseIcs(text, "f", day(2026, 11, 1), day(2026, 11, 30))).toEqual([]);
  });
});
