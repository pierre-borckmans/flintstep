import { describe, expect, it } from "vitest";
import type { Capture } from "../types";
import {
  calibrationHint,
  createRecorder,
  createWidener,
  IDLE_CAPTURE,
  robustExtremes,
  SWEEP_REST_MS,
  SWEEP_TIMEOUT_MS,
  sweepCalibration,
  sweepPatch,
  sweepProgress,
  sweepVerdict,
  widenCalibration,
} from "./sweep";

const cap = (p: Partial<Capture>): Capture => ({
  ...IDLE_CAPTURE,
  on: true,
  low: 256,
  high: 27500,
  startedAt: 0,
  movedAt: 0,
  extremeAt: 0,
  ...p,
});

describe("sweepVerdict", () => {
  it("waits while not ready or still moving", () => {
    expect(sweepVerdict(cap({ ready: false }), 5000)).toBe("wait");
    expect(sweepVerdict(cap({ ready: true, movedAt: 4000 }), 4000 + SWEEP_REST_MS - 1)).toBe(
      "wait",
    );
    expect(sweepVerdict(IDLE_CAPTURE, 99_999)).toBe("wait");
  });

  it("finishes once ready and at rest", () => {
    const c = cap({ ready: true, movedAt: 4000, extremeAt: 3000 });
    expect(sweepVerdict(c, 4000 + SWEEP_REST_MS)).toBe("finish");
  });

  it("times out whatever it has", () => {
    expect(sweepVerdict(cap({ ready: false, movedAt: 14_000 }), SWEEP_TIMEOUT_MS)).toBe("timeout");
  });
});

describe("sweepProgress", () => {
  it("grows with span, a turn, then rest", () => {
    expect(sweepProgress(cap({ low: 1000, high: 3000 }), 0)).toBeCloseTo(0.2);
    expect(sweepProgress(cap({ reversals: 0 }), 0)).toBeCloseTo(0.4);
    expect(sweepProgress(cap({ reversals: 1, ready: true, movedAt: 0 }), 0)).toBeCloseTo(0.8);
    expect(sweepProgress(cap({ reversals: 1, ready: true }), SWEEP_REST_MS)).toBe(1);
    expect(sweepProgress(IDLE_CAPTURE, 0)).toBe(0);
  });
});

describe("sweepCalibration", () => {
  it("insets heel and toe by 1 % of the span", () => {
    expect(sweepCalibration(256, 27500)).toEqual({
      low: 256,
      high: 27500,
      heel: 528,
      toe: 27228,
    });
  });

  it("refuses a small span", () => {
    expect(sweepCalibration(1000, 4999)).toBeNull();
    expect(sweepCalibration(-1, 30000)).toBeNull();
  });

  it("maps heel to min and toe to max, whatever Invert says", () => {
    expect(sweepPatch({ low: 256, high: 27500, heel: 528, toe: 27228 })).toEqual({
      min: 528,
      max: 27228,
    });
  });
});

describe("robustExtremes", () => {
  it("leaves out a lone glitch", () => {
    expect(robustExtremes([0, 10000, 10100, 20000, 20100, 65535])).toEqual([10000, 20100]);
    expect(robustExtremes([100, 300, 30000, 30200])).toEqual([100, 30200]);
    expect(robustExtremes([0, 30000, 65535])).toEqual([0, 65535]);
    expect(robustExtremes([])).toEqual([-1, -1]);
  });
});

describe("createRecorder (bridge capture.go)", () => {
  const ramp = (from: number, to: number, step: number) => {
    const out: number[] = [];
    const s = to < from ? -step : step;
    for (let v = from; s > 0 ? v < to : v > to; v += s) out.push(v);
    return [...out, to];
  };

  it("keeps the extremes across sloppy passes and counts turns", () => {
    const r = createRecorder(0);
    let t = 0;
    for (const v of [
      ...ramp(21448, 26000, 900),
      ...ramp(26000, 256, 1500),
      256,
      ...ramp(256, 27500, 1500),
      27500,
      ...ramp(27500, 15000, 1500),
    ]) {
      t += 20;
      r.add(v, t);
    }
    const c = r.view();
    expect([c.low, c.high]).toEqual([256, 27500]);
    expect(c.reversals).toBeGreaterThanOrEqual(3);
    expect(c.ready).toBe(true);
  });

  it("is not ready one way only", () => {
    const r = createRecorder(0);
    ramp(256, 27500, 1000).forEach((v, i) => {
      r.add(v, i * 20);
    });
    expect(r.view().ready).toBe(false);
  });
});

describe("widenCalibration", () => {
  it("widens either end, never narrows", () => {
    expect(widenCalibration({ min: 3000, max: 27000 }, 500, 27000)).toEqual({
      min: 500,
      max: 27000,
    });
    expect(widenCalibration({ min: 3000, max: 27000 }, 5000, 26000)).toBeNull();
    expect(widenCalibration({ min: 3000, max: 27000 }, 5000, 28000)).toEqual({
      min: 3000,
      max: 28000,
    });
  });

  it("keeps a pedal whose toe reads lower that way round", () => {
    expect(widenCalibration({ min: 27000, max: 3000 }, 500, 27000)).toEqual({
      min: 27000,
      max: 500,
    });
  });

  it("leaves an uncalibrated input alone", () => {
    expect(widenCalibration({ min: 0, max: 0 }, 0, 100)).toBeNull();
  });
});

describe("createWidener (bridge widen.go)", () => {
  it("proposes the second furthest value plus the margin", () => {
    const w = createWidener();
    const x = { min: 3000, max: 27000 };
    expect(w.add(x, 2900, 0)).toBeNull();
    expect(w.add(x, 1200, 20)).toBeNull();
    expect(w.add(x, 300, 40)).toBeNull();
    expect(w.add(x, 256, 60)).toEqual([540, 27000]);
  });

  it("ignores spikes far apart", () => {
    const w = createWidener();
    const x = { min: 3000, max: 27000 };
    w.add(x, 0, 0);
    w.add(x, 0, 4000);
    expect(w.add(x, 0, 8000)).toBeNull();
  });
});

describe("calibrationHint", () => {
  const seen = (low: number, high: number) => ({ low, high });

  it("flags a heel set with the pedal half way up", () => {
    expect(calibrationHint({ min: 21448, max: 27500 }, seen(256, 27500))).toBe(
      "Heel looks high: calibrate by sweeping",
    );
  });

  it("flags a toe short of the end", () => {
    expect(calibrationHint({ min: 300, max: 15000 }, seen(256, 27500))).toBe(
      "Toe looks low: calibrate by sweeping",
    );
  });

  it("flags a very short travel", () => {
    expect(calibrationHint({ min: 10000, max: 12000 }, seen(-1, -1))).toMatch(/very short/);
  });

  it("is quiet for a good or default calibration", () => {
    expect(calibrationHint({ min: 528, max: 27228 }, seen(256, 27500))).toBeNull();
    expect(calibrationHint({ min: 0, max: 65535 }, seen(256, 27500))).toBeNull();
    expect(calibrationHint({ min: 528, max: 27228 }, seen(-1, -1))).toBeNull();
  });
});
