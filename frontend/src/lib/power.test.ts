import { describe, expect, it } from "vitest";
import { HIGH, LOW, powerLamp } from "./power";

describe("powerLamp mirrors the pedal's POWER LED", () => {
  it("uses thresholds of 20 (guess) and 50 (from the pedal)", () => {
    expect(LOW).toBe(20);
    expect(HIGH).toBe(50);
  });
  it("colours by level: red below LOW, yellow to HIGH, green from HIGH", () => {
    expect(powerLamp({ connected: true, level: 19, powered: false }).colour).toBe("red");
    expect(powerLamp({ connected: true, level: 20, powered: false }).colour).toBe("yellow");
    expect(powerLamp({ connected: true, level: 30, powered: true }).colour).toBe("yellow");
    expect(powerLamp({ connected: true, level: 49, powered: false }).colour).toBe("yellow");
    expect(powerLamp({ connected: true, level: 50, powered: false }).colour).toBe("green");
    expect(powerLamp({ connected: true, level: 61, powered: true }).colour).toBe("green");
  });
  it("blinks while charging only", () => {
    expect(powerLamp({ connected: true, level: 30, powered: true }).blink).toBe(true);
    expect(powerLamp({ connected: true, level: 30, powered: false }).blink).toBe(false);
    // The pedal's flag decides, at any level: blinking green at 61 % was seen on hardware.
    expect(powerLamp({ connected: true, level: 61, powered: true })).toEqual({
      colour: "green",
      blink: true,
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
