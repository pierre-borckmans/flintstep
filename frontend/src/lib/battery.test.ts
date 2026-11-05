import { describe, expect, it } from "vitest";
import { batteryInfo } from "./battery";

describe("batteryInfo", () => {
  it("charging whenever the pedal says so, at any level", () => {
    expect(batteryInfo(30, true)).toEqual({ power: "charging", tooltip: "Charging · 30%" });
    expect(batteryInfo(100, true)).toEqual({ power: "charging", tooltip: "Charging · 100%" });
  });
  it("otherwise just the level: plugged-in-but-done looks the same as on battery", () =>
    expect(batteryInfo(61, false)).toEqual({ power: "battery", tooltip: "Battery 61%" }));
});
