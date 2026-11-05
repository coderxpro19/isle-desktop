import { describe, expect, it } from "vitest";
import { fmtSize, mergePaths } from "./shelf";

describe("shelf", () => {
  it("merges new paths to the front without duplicates", () => {
    expect(mergePaths(["a", "b", "c"], ["c", "d", "d"])).toEqual(["c", "d", "a", "b"]);
  });
  it("formats sizes", () => {
    expect(fmtSize(512)).toBe("512 B");
    expect(fmtSize(1536)).toBe("1.5 KB");
    expect(fmtSize(250 * 1024 * 1024)).toBe("250 MB");
  });
});
