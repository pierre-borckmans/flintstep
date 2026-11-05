import { describe, expect, it } from "vitest";
import { RAW_MAX } from "./exp";
import {
  cableLabel,
  fractionRaw,
  pointerFraction,
  SWEEP_PERIOD_MS,
  simKey,
  sweepFraction,
  sweepOffset,
} from "./expsim";

describe("fractionRaw", () => {
  it("maps 0..1 onto the whole jack, like Go", () => {
    expect(fractionRaw(0)).toBe(0);
    expect(fractionRaw(0.5)).toBe(32768);
    expect(fractionRaw(1)).toBe(RAW_MAX);
  });
  it("clamps", () => {
    expect(fractionRaw(-1)).toBe(0);
    expect(fractionRaw(3)).toBe(RAW_MAX);
  });
});

describe("sweepFraction", () => {
  it("goes heel, toe, heel over one period", () => {
    expect(sweepFraction(0)).toBeCloseTo(0);
    expect(sweepFraction(SWEEP_PERIOD_MS / 4)).toBeCloseTo(0.5);
    expect(sweepFraction(SWEEP_PERIOD_MS / 2)).toBeCloseTo(1);
    expect(sweepFraction(SWEEP_PERIOD_MS)).toBeCloseTo(0);
  });
  it("is eased: slow at the ends", () => {
    const end = sweepFraction(100) - sweepFraction(0);
    const mid = sweepFraction(SWEEP_PERIOD_MS / 4 + 100) - sweepFraction(SWEEP_PERIOD_MS / 4);
    expect(end).toBeLessThan(mid);
  });
  it("handles negative time", () => expect(sweepFraction(-SWEEP_PERIOD_MS / 2)).toBeCloseTo(1));
});

describe("sweepOffset", () => {
  it("inverts the way up", () => {
    for (const f of [0, 0.2, 0.5, 0.9, 1]) expect(sweepFraction(sweepOffset(f))).toBeCloseTo(f);
  });
  it("lands on the rising half", () => {
    expect(sweepOffset(0.7)).toBeLessThanOrEqual(SWEEP_PERIOD_MS / 2);
  });
});

describe("pointerFraction", () => {
  it("is the position along the track", () => {
    expect(pointerFraction(150, 100, 200)).toBe(0.25);
  });
  it("clamps outside it", () => {
    expect(pointerFraction(0, 100, 200)).toBe(0);
    expect(pointerFraction(900, 100, 200)).toBe(1);
  });
  it("is 0 on a track with no width", () => expect(pointerFraction(5, 0, 0)).toBe(0));
});

describe("simKey", () => {
  it("steps 1 %, 10 % with shift", () => {
    expect(simKey("ArrowRight", 0.5)).toBeCloseTo(0.51);
    expect(simKey("ArrowLeft", 0.5, true)).toBeCloseTo(0.4);
    expect(simKey("PageUp", 0.95)).toBe(1);
  });
  it("jumps to the ends", () => {
    expect(simKey("Home", 0.4)).toBe(0);
    expect(simKey("End", 0.4)).toBe(1);
  });
  it("ignores other keys", () => expect(simKey("a", 0.4)).toBeNull());
});

describe("cableLabel", () => {
  it("says simulated over the cable", () => {
    expect(cableLabel(true, true)).toBe("simulated");
    expect(cableLabel(true, false)).toBe("cable in");
    expect(cableLabel(false, false)).toBe("no cable");
  });
});
