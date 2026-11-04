import { describe, expect, it } from "vitest";
import { batteryInfo } from "./battery";

describe("batteryInfo", () => {
  it("charging is USB power below 100 %", () =>
    expect(batteryInfo(30, true)).toEqual({ power: "charging", tooltip: "Charging · 30%" }));
  it("full on USB is on USB power, not charging", () =>
    expect(batteryInfo(100, true)).toEqual({ power: "usb", tooltip: "On USB power · 100%" }));
  it("on battery", () =>
    expect(batteryInfo(76, false)).toEqual({ power: "battery", tooltip: "On battery · 76%" }));
});
