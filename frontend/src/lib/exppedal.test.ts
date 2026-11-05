import { describe, expect, it } from "vitest";
import { expFraction, RAW_MAX } from "./exp";
import {
  ART,
  artPoint,
  baseTop,
  cableBeside,
  choosePlacement,
  dragFraction,
  fitWidth,
  gaugeMarks,
  jackFraction,
  jackPoint,
  LABEL,
  layout,
  parsePlacement,
  readout,
  rounded,
  SPARK,
  STOPS,
  socketPoint,
  springStep,
  TILT,
  TREADLE,
  tiltDeg,
  tiltFraction,
  treadleAt,
  UNIT,
  unitHeight,
} from "./exppedal";

const both: [boolean, boolean] = [true, true];
const none: [boolean, boolean] = [false, false];

describe("tiltDeg", () => {
  it("raises the toe at the heel and lays it down at the toe", () => {
    expect(tiltDeg(0)).toBe(TILT.heel);
    expect(tiltDeg(1)).toBe(TILT.toe);
    expect(tiltDeg(0.5)).toBeCloseTo((TILT.heel + TILT.toe) / 2);
  });
  it("clamps outside 0..1", () => {
    expect(tiltDeg(-1)).toBe(TILT.heel);
    expect(tiltDeg(2)).toBe(TILT.toe);
  });
});

describe("the rocker", () => {
  it("rocks round an axle ~40% of the treadle from the heel", () => {
    const at = (ART.pivot.x - TREADLE.x0) / (TREADLE.x1 - TREADLE.x0);
    expect(at).toBeGreaterThan(0.35);
    expect(at).toBeLessThan(0.45);
    expect(TILT.heel - TILT.toe).toBeGreaterThanOrEqual(15);
    expect(TILT.heel - TILT.toe).toBeLessThanOrEqual(20);
  });

  it("raises the toe at heel down and the heel at toe down", () => {
    const heel = { x: TREADLE.x0, y: TREADLE.bottom };
    const toe = { x: TREADLE.x1, y: TREADLE.bottom };
    expect(treadleAt(toe, tiltDeg(0)).y).toBeLessThan(toe.y);
    expect(treadleAt(heel, tiltDeg(0)).y).toBeGreaterThan(heel.y);
    expect(treadleAt(toe, tiltDeg(1)).y).toBeGreaterThan(toe.y);
    expect(treadleAt(heel, tiltDeg(1)).y).toBeLessThan(heel.y);
    expect(treadleAt(ART.pivot, 7)).toEqual(ART.pivot);
  });

  it("lands on its stops, and the stops stand on the base", () => {
    const r = TREADLE.r;
    const heel = treadleAt({ x: TREADLE.x0 + r, y: TREADLE.bottom }, TILT.heel);
    const toe = treadleAt({ x: TREADLE.x1 - r, y: TREADLE.bottom }, TILT.toe);
    expect(STOPS.heel.top).toBeCloseTo(heel.y, 6);
    expect(STOPS.toe.top).toBeCloseTo(toe.y, 6);
    for (const s of [STOPS.heel, STOPS.toe]) {
      expect(s.foot - s.top).toBeGreaterThan(8);
      expect(s.foot).toBeCloseTo(baseTop(s.x), 6);
    }
  });

  it("stays inside the drawing at both ends of its travel", () => {
    for (const deg of [TILT.heel, TILT.toe]) {
      for (const x of [TREADLE.x0, TREADLE.x1]) {
        for (const y of [TREADLE.top, TREADLE.bottom]) {
          const p = treadleAt({ x, y }, deg);
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThanOrEqual(ART.w);
          expect(p.y).toBeGreaterThanOrEqual(ART.y0);
          expect(p.y).toBeLessThanOrEqual(ART.y0 + ART.h);
        }
      }
    }
  });

  it("reads a tilt back as the position it came from", () => {
    for (const f of [0, 0.3, 1]) expect(tiltFraction(tiltDeg(f))).toBeCloseTo(f, 9);
    expect(tiltFraction(TILT.heel + 5)).toBe(0);
    expect(tiltFraction(TILT.toe - 5)).toBe(1);
  });
});

describe("dragFraction: the grabbed point follows the pointer", () => {
  const toeGrab = { x: 800, y: 230 };
  const heelGrab = { x: 120, y: 230 };

  it("pushes the toe down when dragged down on the toe half", () => {
    expect(dragFraction(0.5, toeGrab, toeGrab.y + 20)).toBeGreaterThan(0.5);
    expect(dragFraction(0.5, toeGrab, toeGrab.y - 20)).toBeLessThan(0.5);
  });

  it("pushes the heel down when dragged down on the heel half", () => {
    expect(dragFraction(0.5, heelGrab, heelGrab.y + 20)).toBeLessThan(0.5);
    expect(dragFraction(0.5, heelGrab, heelGrab.y - 20)).toBeGreaterThan(0.5);
  });

  it("keeps the grabbed point under the pointer", () => {
    const f0 = 0.5;
    const flat = { x: toeGrab.x, y: TREADLE.top }; // a point on the tread, flat
    const grab = treadleAt(flat, tiltDeg(f0));
    const f = dragFraction(f0, grab, grab.y + 30);
    expect(treadleAt(flat, tiltDeg(f)).y).toBeCloseTo(grab.y + 30, 0);
  });

  it("is still with no movement, and clamps to the travel", () => {
    expect(dragFraction(0.3, toeGrab, toeGrab.y)).toBeCloseTo(0.3, 9);
    expect(dragFraction(0.5, toeGrab, toeGrab.y + 500)).toBe(1);
    expect(dragFraction(0.5, heelGrab, heelGrab.y + 500)).toBe(0);
  });

  it("does not fling a grab right over the axle", () => {
    const over = { x: ART.pivot.x + 2, y: 230 };
    const f = dragFraction(0.5, over, over.y + 5);
    expect(f - 0.5).toBeLessThan(0.3);
  });

  it("works on a mirrored pedal in the drawing's own units", () => {
    const u = { x: 100, y: 50, w: 200, mirror: true };
    const k = u.w / ART.w;
    // the toe end of a mirrored pedal is on the left
    const p = artPoint(u, { x: u.x + 10 * k, y: u.y });
    expect(p.x).toBeCloseTo(ART.w - 10, 6);
    expect(p.y).toBeCloseTo(ART.y0, 6);
  });
});

describe("jackFraction", () => {
  it("undoes expFraction through the calibration and invert", () => {
    const cfg = { min: 1000, max: 61000, invert: false };
    for (const f of [0, 0.25, 0.5, 1]) {
      expect(expFraction(jackFraction(f, cfg) * RAW_MAX, cfg)).toBeCloseTo(f, 4);
      const inv = { ...cfg, invert: true };
      expect(expFraction(jackFraction(f, inv) * RAW_MAX, inv)).toBeCloseTo(f, 4);
      const low = { min: 60000, max: 2000, invert: false }; // toe reads lower
      expect(expFraction(jackFraction(f, low) * RAW_MAX, low)).toBeCloseTo(f, 4);
    }
  });
  it("uses the whole jack for a one-point calibration", () => {
    expect(jackFraction(0.5, { min: 7, max: 7, invert: false })).toBeCloseTo(0.5);
  });
});

describe("gaugeMarks", () => {
  it("puts the threshold and its release on the value axis", () => {
    const m = gaugeMarks({
      fraction: 0.5,
      rawFraction: 0.4,
      heelRaw: 0.1,
      toeRaw: 0.9,
      threshold: 96,
    });
    expect(m.threshold).toBeCloseTo(0.96);
    expect(m.release).toBeCloseTo(0.93);
    expect([m.value, m.raw, m.heel, m.toe]).toEqual([0.5, 0.4, 0.1, 0.9]);
  });
  it("has no threshold without a trigger, and a release never below the heel", () => {
    const base = { fraction: null, rawFraction: null, heelRaw: 0, toeRaw: 1 };
    expect(gaugeMarks({ ...base, threshold: null }).threshold).toBeNull();
    expect(gaugeMarks({ ...base, threshold: 2 }).release).toBe(0);
  });
});

describe("readout", () => {
  it("shows the channel only when it is not 1", () => {
    expect(readout(11, 1, 64)).toBe("CC 11 · 64");
    expect(readout(11, 3, 64)).toBe("Ch 3 · CC 11 · 64");
    expect(readout(7, 1, null)).toBe("CC 7 · --");
  });
});

describe("parsePlacement", () => {
  it("defaults to auto", () => {
    expect(parsePlacement(null)).toBe("auto");
    expect(parsePlacement("sideways")).toBe("auto");
    expect(parsePlacement("beside")).toBe("beside");
  });
});

describe("layout", () => {
  const w = 500;
  it("is the Spark alone with no pedal", () => {
    for (const p of ["behind", "beside"] as const) {
      const l = layout(p, none, w);
      expect(l.box).toEqual({ w: w + 2 * SPARK.padX, h: SPARK.aspect * w + SPARK.padY });
      expect(l.spark).toEqual({ x: 0, y: 0, w });
    }
  });
  it("behind: a row above the Spark, EXP 1 left (mirrored) and EXP 2 right", () => {
    const l = layout("behind", both, w);
    expect(l.spark.y).toBeGreaterThanOrEqual(unitHeight(w));
    expect(l.units[0].x + l.units[0].w).toBeLessThan(l.units[1].x);
    expect(l.units[0].mirror).toBe(true);
    expect(l.units[1].mirror).toBe(false);
    expect(l.units[0].w).toBeCloseTo(UNIT * w);
    // nothing outside the box
    for (const u of l.units) {
      expect(u.x).toBeGreaterThanOrEqual(0);
      expect(u.x + u.w).toBeLessThanOrEqual(l.box.w);
    }
  });
  it("beside: a column right of the Spark, EXP 1 above EXP 2, within the box", () => {
    const l = layout("beside", both, w);
    const [a, b] = l.units;
    expect(a.x).toBeGreaterThan(w + 2 * SPARK.padX);
    expect(a.y + unitHeight(w)).toBeLessThanOrEqual(b.y);
    expect(b.y + unitHeight(w)).toBeLessThanOrEqual(l.box.h);
    expect(a.x + a.w).toBeCloseTo(l.box.w);
  });
  it("beside: one pedal alone sits on the case's middle", () => {
    const l = layout("beside", [false, true], w);
    const mid = l.spark.y + SPARK.caseTop + (SPARK.aspect * w) / 2;
    expect(l.units[1].y + unitHeight(w) / 2).toBeCloseTo(mid);
  });
});

describe("fitWidth", () => {
  it("fits the whole layout in the space", () => {
    const avail = { w: 700, h: 420 };
    for (const p of ["behind", "beside"] as const) {
      const w = fitWidth(p, both, avail);
      const b = layout(p, both, w).box;
      expect(b.w).toBeLessThanOrEqual(avail.w);
      expect(b.h).toBeLessThanOrEqual(avail.h - 16);
      // and as big as it can: a hair bigger would not fit
      const c = layout(p, both, w + 1).box;
      expect(c.w > avail.w || c.h > avail.h - 16).toBe(true);
    }
  });
  it("matches the Spark-only fit with no pedal", () => {
    expect(fitWidth("behind", none, { w: 2000, h: 500 })).toBeCloseTo(
      (500 - 168) / SPARK.aspect,
      0,
    );
  });
  it("is 0 when nothing fits", () => expect(fitWidth("behind", both, { w: 10, h: 10 })).toBe(0));
});

describe("choosePlacement", () => {
  it("picks beside on a wide canvas and behind on a tall one", () => {
    expect(choosePlacement({ w: 1400, h: 500 }, both, "behind")).toBe("beside");
    expect(choosePlacement({ w: 600, h: 900 }, both, "beside")).toBe("behind");
  });
  it("keeps the current one with no pedal", () => {
    expect(choosePlacement({ w: 1400, h: 500 }, none, "behind")).toBe("behind");
  });
  it("does not flip near the boundary", () => {
    // find a canvas where both placements give nearly the same Spark
    let w = 400;
    const h = 600;
    while (fitWidth("beside", both, { w, h }) < fitWidth("behind", both, { w, h })) w += 1;
    const edge = { w, h };
    expect(choosePlacement(edge, both, "behind")).toBe("behind");
    expect(choosePlacement(edge, both, "beside")).toBe("beside");
    expect(choosePlacement({ w: w + 200, h }, both, "behind")).toBe("beside");
  });
});

describe("cables", () => {
  it("start at the jacks on the back edge", () => {
    const l = layout("behind", both, 500);
    const j = jackPoint(l, 1);
    expect(j.x).toBeCloseTo(SPARK.padX + SPARK.jackX[1] * 500);
    expect(j.y).toBe(l.spark.y + SPARK.caseTop - SPARK.plug);
  });
  it("enter the socket on the heel end, which a mirrored pedal has on its right", () => {
    const l = layout("behind", both, 500);
    expect(socketPoint(l.units[0]).x).toBeGreaterThan(l.units[0].x + l.units[0].w / 2);
    expect(socketPoint(l.units[1]).x).toBeLessThan(l.units[1].x + l.units[1].w / 2);
  });
  it("beside: EXP 1 runs above EXP 2 and turns down further out", () => {
    const l = layout("beside", both, 500);
    const d0 = cableBeside(l, 0, socketPoint(l.units[0]));
    const d1 = cableBeside(l, 1, socketPoint(l.units[1]));
    const ys = (d: string) => [...d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => Number(m[2]));
    expect(Math.min(...ys(d0))).toBeLessThan(Math.min(...ys(d1)));
  });
  it("rounds corners and keeps straight runs", () => {
    const d = rounded(
      [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
        { x: 100, y: 100 },
      ],
      10,
    );
    expect(d).toBe("M0 0 L0 90 Q0 100 10 100 L100 100");
  });
});

describe("springStep", () => {
  it("settles on the target without overshoot", () => {
    let s = { x: 0, v: 0 };
    let max = 0;
    for (let i = 0; i < 120; i++) {
      s = springStep(s.x, s.v, 10, 1 / 60, 15);
      max = Math.max(max, s.x);
    }
    expect(s.x).toBeCloseTo(10, 3);
    expect(max).toBeLessThanOrEqual(10 + 1e-9);
  });
  it("does not depend on the frame rate", () => {
    let a = { x: 0, v: 0 };
    for (let i = 0; i < 10; i++) a = springStep(a.x, a.v, 1, 0.01, 20);
    const b = springStep(0, 0, 1, 0.1, 20);
    expect(a.x).toBeCloseTo(b.x, 9);
  });
});

it("keeps the readout legible: LABEL px whatever the size", () => {
  expect(unitHeight(0)).toBe(LABEL);
});
