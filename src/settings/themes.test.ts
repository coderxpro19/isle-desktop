import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { dockTint, themeOf } from "./themes";

describe("themes", () => {
  it("recognises the default as Midnight", () => {
    expect(themeOf(DEFAULT_SETTINGS.appearance)).toBe("midnight");
    expect(themeOf({ ...DEFAULT_SETTINGS.appearance, accent: "#123456" })).toBeNull();
  });
  it("lifts pure black for the dock", () => {
    expect(dockTint("#000000")).toBe("#141418");
    expect(dockTint("#04121f")).toBe("#04121f");
  });
});
