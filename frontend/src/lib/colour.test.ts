import { describe, expect, it } from "vitest";
import { fromHex, lampLight, toHex } from "./colour";

describe("hex", () => {
  it("round-trips", () => {
    expect(toHex({ r: 255, g: 72, b: 0 })).toBe("#ff4800");
    expect(fromHex("#FF4800")).toEqual({ r: 255, g: 72, b: 0 });
  });
  it("rejects junk", () => expect(fromHex("#fff")).toBeNull());
});

describe("lampLight", () => {
  it("separates hue from dimming", () => {
    const l = lampLight({ r: 51, g: 0, b: 0 });
    expect(l.colour).toEqual({ r: 255, g: 0, b: 0 });
    expect(l.level).toBeCloseTo(0.2);
  });
  it("is level 0 when dark", () => expect(lampLight({ r: 0, g: 0, b: 0 }).level).toBe(0));
});
