import { describe, expect, it } from "vitest";
import { HIGH, LOW, powerLamp } from "./power";

describe("powerLamp mirrors the pedal's POWER LED", () => {
  it("uses guessed thresholds of 20 and 80", () => {
    expect(LOW).toBe(20);
    expect(HIGH).toBe(80);
  });
  it("colours by level: red below LOW, yellow to HIGH, green from HIGH", () => {
    expect(powerLamp({ connected: true, level: 19, powered: false }).colour).toBe("red");
    expect(powerLamp({ connected: true, level: 20, powered: false }).colour).toBe("yellow");
    expect(powerLamp({ connected: true, level: 30, powered: true }).colour).toBe("yellow");
    expect(powerLamp({ connected: true, level: 79, powered: false }).colour).toBe("yellow");
    expect(powerLamp({ connected: true, level: 80, powered: false }).colour).toBe("green");
  });
  it("blinks while charging only", () => {
    expect(powerLamp({ connected: true, level: 30, powered: true }).blink).toBe(true);
    expect(powerLamp({ connected: true, level: 30, powered: false }).blink).toBe(false);
    expect(powerLamp({ connected: true, level: 100, powered: true })).toEqual({
      colour: "green",
      blink: false,
    });
  });
  it("is off when disconnected or before a reading", () => {
    expect(powerLamp({ connected: false, level: 50, powered: true })).toEqual({
      colour: "off",
      blink: false,
    });
    expect(powerLamp({ connected: true, level: -1, powered: true }).colour).toBe("off");
  });
});
