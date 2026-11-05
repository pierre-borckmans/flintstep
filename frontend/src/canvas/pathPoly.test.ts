import { describe, expect, it } from "vitest";
import { cableBehind, rounded } from "../lib/exppedal";
import { cubicBezier, ringsAt } from "./motion";
import { flatten, head } from "./pathPoly";

const length = (pts: { x: number; y: number }[]) =>
  pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);

describe("flatten", () => {
  it("follows lines exactly", () => {
    expect(flatten("M0 0 L10 0 L10 5")).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
    ]);
  });

  it("starts and ends a cable where its path does", () => {
    const d = cableBehind({ x: 100, y: 200 }, { x: 40, y: 20 }, -1);
    const pts = flatten(d);
    expect(pts[0]).toEqual({ x: 100, y: 200 });
    const last = pts[pts.length - 1];
    expect(last.x).toBeCloseTo(40);
    expect(last.y).toBeCloseTo(20);
  });

  it("takes rounded corners (quadratics) through to their end", () => {
    const d = rounded(
      [
        { x: 0, y: 0 },
        { x: 0, y: -30 },
        { x: 50, y: -30 },
      ],
      14,
    );
    const pts = flatten(d);
    expect(pts[pts.length - 1]).toEqual({ x: 50, y: -30 });
    // a rounded corner is shorter than the square one
    expect(length(pts)).toBeLessThan(80);
    expect(length(pts)).toBeGreaterThan(70);
  });
});

describe("head", () => {
  const pts = flatten("M0 0 L10 0 L10 10");

  it("is the whole path at 1 and its start at 0", () => {
    expect(head(pts, 1)).toBe(pts);
    expect(head(pts, 0)).toEqual([{ x: 0, y: 0 }]);
  });

  it("cuts at the fraction of the length, mid-segment", () => {
    expect(head(pts, 0.75)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
    ]);
    expect(length(head(pts, 0.3))).toBeCloseTo(6);
  });
});

describe("cubicBezier", () => {
  it("is CSS's: fixed ends, and linear when the handles are on the diagonal", () => {
    const e = cubicBezier(0.3, 0.75, 0.35, 1);
    expect(e(0)).toBe(0);
    expect(e(1)).toBe(1);
    expect(cubicBezier(0.25, 0.25, 0.75, 0.75)(0.4)).toBeCloseTo(0.4, 4);
    expect(e(0.5)).toBeGreaterThan(0.5); // an ease-out
  });
});

describe("ringsAt", () => {
  it("sends sonar out: rings grow from the case and fade", () => {
    const a = ringsAt("expand", 100, 0.45, false).rings[0];
    const b = ringsAt("expand", 1500, 0.45, false).rings[0];
    expect(b.out).toBeGreaterThan(a.out);
    expect(
      Math.max(...ringsAt("expand", 600, 0.45, false).rings.map((r) => r.alpha)),
    ).toBeLessThanOrEqual(0.45);
  });

  it("closes in while connecting", () => {
    const a = ringsAt("converge", 100, 0.45, false).rings[0];
    const b = ringsAt("converge", 900, 0.45, false).rings[0];
    expect(b.out).toBeLessThan(a.out);
  });

  it("collapses into the case and is gone, with a flash in between", () => {
    expect(ringsAt("collapse", 2000, 0.45, false).rings.every((r) => r.alpha === 0)).toBe(true);
    expect(ringsAt("collapse", 400, 0.45, false).bloom).toBeGreaterThan(0);
  });

  it("holds three still rings for less motion, and no collapse", () => {
    const still = ringsAt("expand", 0, 0.45, true).rings;
    expect(still.map((r) => r.out)).toEqual([18, 48, 78]);
    expect(ringsAt("expand", 999, 0.45, true).rings).toEqual(still);
    expect(ringsAt("collapse", 100, 0.45, true).rings).toEqual([]);
  });
});
