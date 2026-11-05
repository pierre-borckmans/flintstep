import { describe, expect, it } from "vitest";
import { batteryInfo } from "./battery";

describe("batteryInfo", () => {
  it("charging whenever the pedal says so, at any level", () => {
    expect(batteryInfo(30, true)).toEqual({ power: "charging", tooltip: "Battery 30%, charging" });
    expect(batteryInfo(10, true)).toEqual({ power: "charging", tooltip: "Battery 10%, charging" });
  });
  it("otherwise just the level: plugged-in-but-done looks the same as on battery", () =>
    expect(batteryInfo(61, false)).toEqual({ power: "battery", tooltip: "Battery 61%" }));
  it("says so when it is low", () =>
    expect(batteryInfo(12, false).tooltip).toBe("Battery 12%, low: plug the pedal in"));
});
