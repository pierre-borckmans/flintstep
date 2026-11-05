import { describe, expect, it } from "vitest";
import { readFlags } from "../useStoredFlags";
import {
  addPoint,
  curvePath,
  curveWords,
  formatAmount,
  movePoint,
  pickCurve,
  removePoint,
  taperHint,
  taperText,
} from "./curve";
import { applyCurve, PRESET_AMOUNT } from "./exp";

describe("pickCurve", () => {
  it("keeps the custom points when switching away and back", () => {
    const pts = [{ x: 0.3, y: 0.1 }];
    const c = pickCurve({ kind: "custom", amount: 0, points: pts }, "s");
    expect(c.kind).toBe("s");
    expect(pickCurve(c, "custom").points).toEqual(pts);
  });
  it("starts Custom on the curve that was picked, so the graph does not jump", () => {
    for (const kind of ["gentle", "fast", "s", "linear"] as const) {
      const from = { kind, amount: 0 };
      const c = pickCurve(from, "custom");
      expect(c.points).toHaveLength(3);
      for (const p of c.points ?? []) expect(p.y).toBeCloseTo(applyCurve(from, p.x), 2);
    }
    const old = { kind: "custom", amount: PRESET_AMOUNT } as const;
    const c = pickCurve(old, "custom");
    expect(applyCurve(c, 0.5)).toBeCloseTo(applyCurve(old, 0.5), 2);
  });
});

describe("editing points", () => {
  const pts = [
    { x: 0.25, y: 0.25 },
    { x: 0.5, y: 0.5 },
    { x: 0.75, y: 0.75 },
  ];
  it("moves a point but not past its neighbours or below the one before", () => {
    const m = movePoint(pts, 1, 0.9, 0.1);
    expect(m[1].x).toBeLessThan(0.75);
    expect(m[1].y).toBeGreaterThanOrEqual(m[0].y);
  });
  it("adds a point in order and says where", () => {
    const [next, i] = addPoint(pts, 0.6, 0.4);
    expect(i).toBe(2);
    expect(next.map((p) => p.x)).toEqual([0.25, 0.5, 0.6, 0.75]);
    expect(addPoint(pts, 0.505, 0.5)[1]).toBe(-1);
  });
  it("removes a point", () => {
    expect(removePoint(pts, 0)).toEqual(pts.slice(1));
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
