import { describe, expect, it } from "vitest";
import type { Clip } from "@/lib/types";
import { clipMatches, orderClips } from "./ClipboardPanel";

const clip = (id: number, p: Partial<Clip>): Clip => ({ id, kind: "text", text: "", files: [], preview: null, width: 0, height: 0, pinned: false, atMs: id, app: null, ...p });

describe("clipboard panel", () => {
  it("searches words in any order, across text, files and app", () => {
    const c = clip(1, { text: "Meet at the Lekki office", app: "WhatsApp" });
    expect(clipMatches(c, "lekki meet", "all")).toBe(true);
    expect(clipMatches(c, "whatsapp", "all")).toBe(true);
    expect(clipMatches(c, "ikoyi", "all")).toBe(false);
    expect(clipMatches(c, "", "image")).toBe(false);
    expect(clipMatches(clip(2, { kind: "files", files: ["C:\\x\\deck.pdf"] }), "deck", "files")).toBe(true);
  });
  it("puts pinned first, then newest", () => {
    const out = orderClips([clip(1, {}), clip(3, {}), clip(2, { pinned: true })]);
    expect(out.map((c) => c.id)).toEqual([2, 3, 1]);
  });
});
