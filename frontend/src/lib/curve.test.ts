import { describe, expect, it } from "vitest";
import { readFlags } from "../useStoredFlags";
import {
  curvePath,
  curveWords,
  dragAmount,
  formatAmount,
  keyAmount,
  pickCurve,
  taperHint,
  taperText,
} from "./curve";
import { applyCurve, PRESET_AMOUNT } from "./exp";

describe("pickCurve", () => {
  it("keeps the custom shape when switching away and back", () => {
    const c = pickCurve({ kind: "custom", amount: 0.35 }, "s");
    expect(c).toEqual({ kind: "s", amount: 0.35 });
    expect(pickCurve(c, "custom")).toEqual({ kind: "custom", amount: 0.35 });
  });
  it("starts Custom where Gentle or Fast was, so the graph does not jump", () => {
    expect(pickCurve({ kind: "gentle", amount: 0 }, "custom")).toEqual({
      kind: "custom",
      amount: PRESET_AMOUNT,
    });
    expect(pickCurve({ kind: "fast", amount: 0 }, "custom").amount).toBe(-PRESET_AMOUNT);
    expect(pickCurve({ kind: "linear", amount: 0 }, "custom").amount).toBe(0);
    const g = { kind: "gentle", amount: 0 } as const;
    const c = { kind: "custom", amount: PRESET_AMOUNT } as const;
    expect(applyCurve(c, 0.4)).toBeCloseTo(applyCurve(g, 0.4), 12);
  });
});

describe("dragging the graph", () => {
  it("goes gentler upwards, clamped and rounded", () => {
    expect(dragAmount(0, -40)).toBe(0.5);
    expect(dragAmount(0, 40)).toBe(-0.5);
    expect(dragAmount(0.9, -400)).toBe(1);
    expect(dragAmount(0, -40, true)).toBe(0.13);
  });
  it("takes keys", () => {
    expect(keyAmount(0.3, "ArrowUp")).toBe(0.35);
    expect(keyAmount(0.3, "ArrowDown", true)).toBe(0.2);
    expect(keyAmount(0.3, "0")).toBe(0);
    expect(keyAmount(0.3, "End")).toBe(1);
    expect(keyAmount(0.3, "a")).toBeNull();
  });
});

it("names a curve for the history", () => {
  expect(curveWords({ kind: "custom", amount: 0.35 })).toBe("custom 0.35");
  expect(curveWords({ kind: "custom", amount: -0.3 })).toBe("custom -0.3");
  expect(curveWords({ kind: "gentle", amount: 0 })).toBe("gentle start");
  expect(formatAmount(0)).toBe("0");
});

it("draws the curve corner to corner", () => {
  const d = curvePath({ kind: "s", amount: 0 }, 100, 50, 4);
  expect(d.startsWith("M0.00 50.00")).toBe(true);
  expect(d.endsWith("L100.00 0.00")).toBe(true);
});

// A sweep: the foot rocks evenly (a cosine in time), the pot maps the foot's position
// to the reading through `pot`, sampled every 40 ms like the pedal reports.
function sweep(pot: (f: number) => number, heel = 500, toe = 27000): [number, number][] {
  const out: [number, number][] = [];
  for (let t = 0; t <= 6000; t += 40) {
    const f = (1 - Math.cos((2 * Math.PI * t) / 2000)) / 2;
    out.push([t, Math.round(heel + (toe - heel) * pot(f))]);
  }
  return out;
}
const audioTaper = (f: number) => applyCurve({ kind: "fast", amount: 0 }, f);

describe("taperHint", () => {
  it("says nothing for an even pot", () => {
    expect(
      taperHint(
        sweep((f) => f),
        500,
        27000,
      ),
    ).toBeNull();
  });
  it("suggests Gentle for a pot that races near the heel", () => {
    const h = taperHint(sweep(audioTaper), 500, 27000);
    expect(h).toEqual({ curve: "gentle", end: "heel" });
    expect(h && taperText(h)).toBe("This pedal changes fast near the heel: try Gentle start");
  });
  it("suggests Fast for one that races near the toe", () => {
    expect(
      taperHint(
        sweep((f) => 1 - audioTaper(1 - f)),
        500,
        27000,
      ),
    ).toEqual({
      curve: "fast",
      end: "toe",
    });
  });
  it("flips the suggestion when inverted, since the curve sees the travel reversed", () => {
    expect(taperHint(sweep(audioTaper), 500, 27000, true)).toEqual({
      curve: "fast",
      end: "heel",
    });
  });
  it("needs enough of a sweep to tell", () => {
    expect(taperHint(sweep(audioTaper).slice(0, 8), 500, 27000)).toBeNull();
    expect(taperHint([], 500, 27000)).toBeNull();
    expect(taperHint(sweep(audioTaper), 500, 500)).toBeNull();
  });
});

describe("readFlags", () => {
  it("falls back per flag", () => {
    expect(readFlags(null, [false, true])).toEqual([false, true]);
    expect(readFlags("[true]", [false, true])).toEqual([true, true]);
    expect(readFlags("not json", [true, false])).toEqual([true, false]);
    expect(readFlags('[1, "x"]', [false, false])).toEqual([false, false]);
  });
});
