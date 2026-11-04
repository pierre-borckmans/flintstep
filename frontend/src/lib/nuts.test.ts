import { describe, expect, it } from "vitest";
import {
  bearing,
  defaultNuts,
  degText,
  easeOutCubic,
  nearest,
  nextSeed,
  normalise,
  nutsFromQuery,
  parseNuts,
  prng,
  seededAngles,
  serialiseNuts,
  shownAngles,
  turn,
  wheelStep,
  withAngle,
  withMode,
} from "./nuts";

describe("normalise", () => {
  it("wraps into [0, 60)", () => {
    expect(normalise(0)).toBe(0);
    expect(normalise(60)).toBe(0);
    expect(normalise(75)).toBe(15);
    expect(normalise(-15)).toBe(45);
    expect(normalise(-60)).toBe(0);
    expect(normalise(725)).toBe(5);
  });
  it("rounds to tenths and never returns 60 or -0", () => {
    expect(normalise(12.345)).toBe(12.3);
    expect(normalise(59.97)).toBe(0);
    expect(Object.is(normalise(-0), 0)).toBe(true);
    expect(Object.is(normalise(-120), 0)).toBe(true);
  });
  it("reads nonsense as 0", () => {
    expect(normalise(Number.NaN)).toBe(0);
    expect(normalise(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("seeded angles", () => {
  it("is deterministic", () => {
    expect(seededAngles(42)).toEqual(seededAngles(42));
    const a = prng(7);
    const b = prng(7);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });
  it("gives six whole degrees in [0, 60)", () => {
    for (let s = 0; s < 200; s++) {
      const a = seededAngles(s);
      expect(a).toHaveLength(6);
      for (const d of a) {
        expect(Number.isInteger(d)).toBe(true);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThan(60);
      }
    }
  });
  it("differs between seeds", () => {
    expect(seededAngles(1)).not.toEqual(seededAngles(2));
  });
  it("nextSeed never repeats the current seed and stays a uint32", () => {
    const vals = [0.5, 0.5, 0.25];
    let i = 0;
    const rand = () => vals[i++];
    const cur = Math.floor(0.5 * 4294967296);
    expect(nextSeed(cur, rand)).toBe(Math.floor(0.25 * 4294967296));
    const s = nextSeed(0);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(2 ** 32);
  });
});

describe("modes", () => {
  const s = { mode: "aligned" as const, seed: 99, custom: [1, 2, 3, 4, 5, 6] };
  it("shows zeros, the seed's angles, or the custom ones", () => {
    expect(shownAngles(s)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(shownAngles({ ...s, mode: "shuffled" })).toEqual(seededAngles(99));
    expect(shownAngles({ ...s, mode: "custom" })).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("starts Match my pedal from whatever was showing", () => {
    expect(withMode({ ...s, mode: "shuffled" }, "custom").custom).toEqual(seededAngles(99));
    expect(withMode(s, "custom").custom).toEqual([0, 0, 0, 0, 0, 0]);
  });
  it("keeps the custom angles when leaving Match my pedal", () => {
    const c = { ...s, mode: "custom" as const };
    expect(withMode(c, "aligned").custom).toEqual(c.custom);
    expect(withMode(c, "custom")).toBe(c);
  });
  it("sets one nut, normalised, without touching the others", () => {
    const t = withAngle(s, 2, -10);
    expect(t.custom).toEqual([1, 2, 50, 4, 5, 6]);
    expect(s.custom[2]).toBe(3);
  });
});

describe("wheelStep", () => {
  it("turns clockwise on scroll down, anticlockwise on scroll up", () => {
    expect(wheelStep({ deltaX: 0, deltaY: 20, deltaMode: 0 }, false)).toBeCloseTo(3);
    expect(wheelStep({ deltaX: 0, deltaY: -20, deltaMode: 0 }, false)).toBeCloseTo(-3);
  });
  it("is finer with Shift", () => {
    const fine = wheelStep({ deltaX: 0, deltaY: 20, deltaMode: 0 }, true);
    expect(fine).toBeCloseTo(0.6);
  });
  it("counts lines as pixels and caps a big notch", () => {
    expect(wheelStep({ deltaX: 0, deltaY: 1, deltaMode: 1 }, false)).toBeCloseTo(2.4);
    expect(wheelStep({ deltaX: 0, deltaY: 500, deltaMode: 0 }, false)).toBe(15);
    expect(wheelStep({ deltaX: 0, deltaY: -1, deltaMode: 2 }, false)).toBe(-15);
  });
  it("uses the bigger axis, since Shift can make a wheel horizontal", () => {
    expect(wheelStep({ deltaX: 20, deltaY: 1, deltaMode: 0 }, true)).toBeCloseTo(0.6);
  });
});

describe("geometry", () => {
  it("bearing is clockwise on screen", () => {
    expect(bearing(0, 0, 1, 0)).toBe(0);
    expect(bearing(0, 0, 0, 1)).toBe(90);
  });
  it("turn takes the short way round", () => {
    expect(turn(170, -170)).toBe(20);
    expect(turn(-170, 170)).toBe(-20);
    expect(turn(0, 180)).toBe(180);
  });
  it("nearest animates the short way within a 60° period", () => {
    expect(nearest(55, 5)).toBe(65);
    expect(nearest(5, 55)).toBe(-5);
    expect(nearest(125, 10)).toBe(130);
    expect(nearest(0, 0)).toBe(0);
  });
  it("easeOutCubic runs 0 to 1 and clamps", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(2)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
  it("degText shows tenths only when there are any", () => {
    expect(degText(12)).toBe("12°");
    expect(degText(12.5)).toBe("12.5°");
  });
});

describe("storage", () => {
  it("round-trips", () => {
    const s = { mode: "custom" as const, seed: 123456, custom: [0, 12.5, 30, 45, 59.9, 7] };
    expect(parseNuts(serialiseNuts(s))).toEqual(s);
  });
  it("defaults on missing or broken data", () => {
    expect(parseNuts(null, 5)).toEqual(defaultNuts(5));
    expect(parseNuts("{nope", 5)).toEqual(defaultNuts(5));
    expect(parseNuts("42", 5)).toEqual(defaultNuts(5));
    expect(parseNuts("null", 5)).toEqual(defaultNuts(5));
  });
  it("keeps what's valid and repairs the rest", () => {
    const s = parseNuts(
      JSON.stringify({ mode: "spinning", seed: 7, custom: [70, "x", null, -5] }),
      5,
    );
    expect(s).toEqual({ mode: "aligned", seed: 7, custom: [10, 0, 0, 55, 0, 0] });
    expect(parseNuts(JSON.stringify({ mode: "shuffled", seed: -1 }), 5)).toEqual({
      mode: "shuffled",
      seed: 5,
      custom: [0, 0, 0, 0, 0, 0],
    });
    expect(parseNuts(JSON.stringify({ seed: 1.5 }), 5).seed).toBe(5);
    expect(parseNuts(JSON.stringify({ seed: 2 ** 32 }), 5).seed).toBe(5);
  });
});

describe("nutsFromQuery", () => {
  const base = defaultNuts(3);
  it("ignores URLs without ?nuts", () => {
    expect(nutsFromQuery(new URLSearchParams("state=connected"), base)).toBeNull();
    expect(nutsFromQuery(new URLSearchParams("nuts=wobbly"), base)).toBeNull();
  });
  it("reads a mode, a seed and angles", () => {
    expect(nutsFromQuery(new URLSearchParams("nuts=shuffled&nutseed=9"), base)).toEqual({
      ...base,
      mode: "shuffled",
      seed: 9,
    });
    expect(nutsFromQuery(new URLSearchParams("nuts=custom&nutangles=10,70,-5"), base)).toEqual({
      ...base,
      mode: "custom",
      custom: [10, 10, 55, 0, 0, 0],
    });
  });
});
