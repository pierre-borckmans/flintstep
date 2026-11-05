import { describe, expect, it } from "vitest";
import type { ExpCurve } from "../types";
import golden from "./curves.golden.json";
import { applyCurve, expFraction, expOutput, expValue, normalizeCurve, rawFraction } from "./exp";

// ---- response curves: the table Go writes (internal/mapping/curve_test.go) -------

describe("applyCurve matches Go", () => {
  for (const row of golden.rows) {
    const c = row.curve as ExpCurve;
    it(`${c.kind} ${c.amount}`, () => {
      golden.inputs.forEach((t, i) => {
        expect(applyCurve(c, t)).toBeCloseTo(row.out[i], 12);
        expect(Math.round(applyCurve(c, t) * 127)).toBe(row.cc[i]);
      });
    });
  }
});

describe("curves", () => {
  const kinds: ExpCurve[] = [
    { kind: "linear", amount: 0 },
    { kind: "gentle", amount: 0 },
    { kind: "fast", amount: 0 },
    { kind: "s", amount: 0 },
    { kind: "custom", amount: 0.8 },
    { kind: "custom", amount: -1 },
  ];
  it("are exact at the ends and increasing", () => {
    for (const c of kinds) {
      expect(applyCurve(c, 0)).toBe(0);
      expect(applyCurve(c, 1)).toBe(1);
      let prev = 0;
      for (let i = 1; i <= 200; i++) {
        const y = applyCurve(c, i / 200);
        expect(y).toBeGreaterThan(prev);
        prev = y;
      }
    }
  });
  it("treat a missing or unknown curve as linear, like Go's Normalize", () => {
    expect(applyCurve(undefined, 0.3)).toBe(0.3);
    expect(normalizeCurve({ kind: "wobbly" as ExpCurve["kind"], amount: 4 })).toEqual({
      kind: "linear",
      amount: 1,
    });
    expect(normalizeCurve(undefined)).toEqual({ kind: "linear", amount: 0 });
  });
  it("bend the value sent and the bar, not the travel", () => {
    const curve: ExpCurve = { kind: "gentle", amount: 0 };
    const c = { min: 0, max: 60000, invert: false, curve };
    expect(expFraction(30000, c)).toBe(0.5);
    expect(expOutput(30000, c)).toBe(applyCurve(curve, 0.5));
    expect(expValue(30000, c)).toBe(Math.round(applyCurve(curve, 0.5) * 127));
    expect(expValue(30000, c)).toBeLessThan(30);
  });
});

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
