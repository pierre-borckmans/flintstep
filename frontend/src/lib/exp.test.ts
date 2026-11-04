import { describe, expect, it } from "vitest";
import { expFraction, expValue, rawFraction } from "./exp";

const cfg = { min: 1000, max: 61000, invert: false };

describe("expValue", () => {
  it("is null with no reading", () => expect(expValue(-1, cfg)).toBeNull());
  it("maps heel to 0 and toe to 127", () => {
    expect(expValue(1000, cfg)).toBe(0);
    expect(expValue(61000, cfg)).toBe(127);
  });
  it("clamps outside the calibration", () => {
    expect(expValue(0, cfg)).toBe(0);
    expect(expValue(65535, cfg)).toBe(127);
  });
  it("scales the middle", () => expect(expValue(31000, cfg)).toBe(64));
  it("inverts", () => {
    expect(expValue(1000, { ...cfg, invert: true })).toBe(127);
    expect(expValue(61000, { ...cfg, invert: true })).toBe(0);
  });

  // min is the heel and max the toe, whichever reads higher (mapping.ExpConfig).
  const low = { min: 50000, max: 3000, invert: false };
  it("maps heel to 0 and toe to 127 when the toe reads lower", () => {
    expect(expValue(50000, low)).toBe(0);
    expect(expValue(3000, low)).toBe(127);
    expect(expValue(26500, low)).toBe(64);
  });
  it("clamps a toe-low calibration", () => {
    expect(expValue(65535, low)).toBe(0);
    expect(expValue(0, low)).toBe(127);
  });
  it("inverts a toe-low calibration", () => {
    expect(expValue(50000, { ...low, invert: true })).toBe(127);
    expect(expValue(3000, { ...low, invert: true })).toBe(0);
  });
  it("treats a one-point calibration as the whole jack, like the engine", () => {
    expect(expFraction(0, { min: 100, max: 100, invert: false })).toBe(0);
    expect(expFraction(65535, { min: 100, max: 100, invert: false })).toBe(1);
  });
});

it("rawFraction spans the jack", () => {
  expect(rawFraction(0)).toBe(0);
  expect(rawFraction(65535)).toBe(1);
  expect(rawFraction(70000)).toBe(1);
});
