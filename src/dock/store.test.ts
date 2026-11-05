import { describe, expect, it } from "vitest";
import { dockVisible, magnify } from "./store";

describe("dock", () => {
  it("magnifies most under the cursor and falls off", () => {
    expect(magnify(0, 48)).toBeCloseTo(1.55);
    expect(magnify(48, 48)).toBeLessThan(magnify(10, 48));
    expect(magnify(500, 48)).toBeCloseTo(1, 3);
  });
  it("visibility per mode", () => {
    const idle = { hovered: false, overlap: false, popupOpen: false };
    expect(dockVisible("fixed", idle)).toBe(true);
    expect(dockVisible("autoHide", idle)).toBe(false);
    expect(dockVisible("autoHide", { ...idle, hovered: true })).toBe(true);
    expect(dockVisible("smart", idle)).toBe(true);
    expect(dockVisible("smart", { ...idle, overlap: true })).toBe(false);
    expect(dockVisible("smart", { ...idle, overlap: true, popupOpen: true })).toBe(true);
  });
});
