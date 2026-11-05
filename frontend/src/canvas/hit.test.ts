import { describe, expect, it } from "vitest";
import { layout } from "../lib/exppedal";
import { COL, indicatorBox, nutAt, switchBox } from "../lib/sparkgeom";
import { captionBox, caseFrame, type Probe, probe, targetBox, unitBoxes } from "./hit";

const base = (o: Partial<Probe> = {}): Probe => ({
  layout: layout("behind", [true, true], 500),
  present: [true, true],
  simulated: [false, true],
  turnable: false,
  indicators: true,
  ...o,
});

/** The layout-px centre of a box given in case units. */
function onCase(p: Probe, b: { x: number; y: number; w: number; h: number }) {
  const c = caseFrame(p.layout);
  return { x: c.x + (b.x + b.w / 2) * c.k, y: c.y + (b.y + b.h / 2) * c.k };
}

describe("probe", () => {
  it("finds every switch at the middle of its group", () => {
    const p = base();
    for (let n = 0; n < 6; n++) {
      const at = onCase(p, switchBox(n));
      expect(probe(p, at.x, at.y)).toEqual({ kind: "switch", n });
    }
  });

  it("turns a press on a nut into the nut only in Match my pedal mode", () => {
    const p = base();
    const c = caseFrame(p.layout);
    const nut = nutAt(4);
    const at = { x: c.x + nut.x * c.k, y: c.y + nut.y * c.k };
    expect(probe(p, at.x, at.y)).toEqual({ kind: "switch", n: 4 });
    expect(probe({ ...p, turnable: true }, at.x, at.y)).toEqual({ kind: "nut", n: 4 });
  });

  it("finds the AMP and APP lamps only when they can be selected", () => {
    const p = base();
    const at = onCase(p, indicatorBox(1));
    expect(probe(p, at.x, at.y)).toEqual({ kind: "indicator", i: 1 });
    expect(probe({ ...p, indicators: false }, at.x, at.y)?.kind).not.toBe("indicator");
  });

  it("finds captions above and below the case", () => {
    const p = base();
    for (const n of [0, 2, 3, 5]) {
      const b = captionBox(p.layout, n);
      expect(probe(p, b.x + b.w / 2, b.y + b.h / 2)).toEqual({ kind: "caption", n });
    }
    // and they sit over their own column
    const c = caseFrame(p.layout);
    const b = captionBox(p.layout, 1);
    expect(b.x < c.x + COL[1] * c.k && c.x + COL[1] * c.k < b.x + b.w).toBe(true);
  });

  it("finds an expression pedal, and its treadle only when simulated", () => {
    const p = base();
    for (const n of [0, 1] as const) {
      const art = unitBoxes(p.layout.units[n]).art;
      expect(probe(p, art.x + art.w / 2, art.y + art.h / 2)).toEqual({
        kind: "exp",
        n,
        treadle: n === 1,
      });
    }
    const art = unitBoxes(p.layout.units[0]).art;
    expect(probe({ ...p, present: [false, true] }, art.x + art.w / 2, art.y + art.h / 2)).toBe(
      null,
    );
  });

  it("is null on the bare stage", () => {
    expect(probe(base(), -50, -50)).toBe(null);
  });

  it("gives each target a box that contains the point that found it", () => {
    const p = base();
    const at = onCase(p, switchBox(2));
    const t = probe(p, at.x, at.y);
    expect(t).not.toBe(null);
    const b = targetBox(p.layout, t!);
    expect(at.x >= b.x && at.x <= b.x + b.w && at.y >= b.y && at.y <= b.y + b.h).toBe(true);
  });
});
