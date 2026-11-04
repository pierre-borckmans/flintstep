import { describe, expect, it } from "vitest";
import { parseNote } from "./notes";
import {
  clampStep,
  fraction,
  keyValue,
  nextGesture,
  parseValue,
  scrubValue,
  stepsFor,
  travel,
  wheelSteps,
} from "./scrub";

const cc = { min: 0, max: 127 };
const ch = { min: 1, max: 16 };

describe("stepsFor", () => {
  it("is one step per 4 px, toward zero", () => {
    expect(stepsFor(0)).toBe(0);
    expect(stepsFor(3)).toBe(0);
    expect(stepsFor(4)).toBe(1);
    expect(stepsFor(41)).toBe(10);
    expect(stepsFor(-9)).toBe(-2);
  });
  it("is one step per 12 px with Shift, and ten at a time with Alt", () => {
    expect(stepsFor(24, { fine: true })).toBe(2);
    expect(stepsFor(8, { coarse: true })).toBe(20);
    expect(stepsFor(-12, { fine: true, coarse: true })).toBe(-10);
  });
});

describe("scrubValue", () => {
  it("moves from the start and clamps", () => {
    expect(scrubValue(64, 40, cc)).toBe(74);
    expect(scrubValue(120, 400, cc)).toBe(127);
    expect(scrubValue(1, -400, ch)).toBe(1);
    expect(scrubValue(8, 4, ch, { coarse: true })).toBe(16);
  });
  it("respects a step", () => {
    expect(scrubValue(400, 8, { min: 0, max: 2000, step: 50 })).toBe(500);
  });
});

describe("travel", () => {
  it("takes the larger axis, up counting as positive", () => {
    expect(travel(10, 2)).toBe(10);
    expect(travel(1, -10)).toBe(10);
    expect(travel(-3, 20)).toBe(-20);
  });
});

describe("clampStep", () => {
  it("snaps to the step from min and clamps", () => {
    expect(clampStep(7, { min: 0, max: 100, step: 5 })).toBe(5);
    expect(clampStep(8, { min: 0, max: 100, step: 5 })).toBe(10);
    expect(clampStep(0, ch)).toBe(1);
    expect(clampStep(0.30000000000000004, { min: 0, max: 1, step: 0.1 })).toBe(0.3);
  });
});

describe("keyValue", () => {
  it("steps with the arrows, ten with Shift or Page keys, and jumps with Home/End", () => {
    expect(keyValue("ArrowUp", 5, cc)).toBe(6);
    expect(keyValue("ArrowDown", 5, cc, { shift: true })).toBe(0);
    expect(keyValue("PageUp", 120, cc)).toBe(127);
    expect(keyValue("PageDown", 50, cc)).toBe(40);
    expect(keyValue("Home", 50, ch)).toBe(1);
    expect(keyValue("End", 5, ch)).toBe(16);
    expect(keyValue("a", 5, cc)).toBeNull();
  });
});

describe("parseValue", () => {
  it("reads numbers in range, and nothing else", () => {
    expect(parseValue(" 42 ", cc)).toBe(42);
    expect(parseValue("128", cc)).toBeNull();
    expect(parseValue("0", ch)).toBeNull();
    expect(parseValue("abc", cc)).toBeNull();
    expect(parseValue("", cc)).toBeNull();
  });
  it("reads note names through the field's parser", () => {
    expect(parseValue("C#3", cc, parseNote)).toBe(49);
    expect(parseValue("c4", cc, parseNote)).toBe(60);
    expect(parseValue("Db3", cc, parseNote)).toBe(49);
    expect(parseValue("60", cc, parseNote)).toBe(60);
    expect(parseValue("H2", cc, parseNote)).toBeNull();
  });
});

describe("fraction, wheelSteps, gestures", () => {
  it("places a value in its range", () => {
    expect(fraction(1, ch)).toBe(0);
    expect(fraction(16, ch)).toBe(1);
    expect(fraction(64, { min: 0, max: 128 })).toBe(0.5);
  });
  it("turns wheel travel into steps and keeps the rest", () => {
    expect(wheelSteps(0, -100)).toEqual([4, 4]);
    expect(wheelSteps(0, -10)).toEqual([0, 10]);
    expect(wheelSteps(10, -15)).toEqual([1, 1]);
    expect(wheelSteps(0, 30)).toEqual([-1, -6]);
  });
  it("hands out a new id per gesture", () => expect(nextGesture()).not.toBe(nextGesture()));
});
