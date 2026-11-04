import { describe, expect, it } from "vitest";
import type { IndicatorMode } from "../types";
import { FLASH_MS, INDICATOR_MODES, indicatorLit, modeLabel } from "./indicators";

describe("indicator modes", () => {
  it("are Go's, with plain labels", () =>
    expect(INDICATOR_MODES.map((m) => [m.value, m.label])).toEqual([
      ["off", "Off"],
      ["connected", "Connected"],
      ["midiOut", "MIDI out"],
      ["midiIn", "MIDI in"],
      ["usb", "USB power"],
      ["on", "Always on"],
    ]));
  it("each has a one-line explanation", () =>
    expect(INDICATOR_MODES.every((m) => m.hint.length > 0)).toBe(true));
  it("labels an unknown mode as itself", () => {
    expect(modeLabel("midiIn")).toBe("MIDI in");
    expect(modeLabel("blink" as IndicatorMode)).toBe("blink");
  });
});

describe("indicatorLit mirrors mapping.IndicatorLamps", () => {
  const base = { connected: true, powered: false, now: 1000, lastOut: -1e9, lastIn: -1e9 };
  it("connected, usb, on, off", () => {
    expect(indicatorLit("connected", base)).toBe(true);
    expect(indicatorLit("connected", { ...base, connected: false })).toBe(false);
    expect(indicatorLit("usb", base)).toBe(false);
    expect(indicatorLit("usb", { ...base, powered: true })).toBe(true);
    expect(indicatorLit("on", base)).toBe(true);
    expect(indicatorLit("off", { ...base, powered: true, lastOut: 1000, lastIn: 1000 })).toBe(
      false,
    );
  });
  it("flashes for FLASH_MS after the last message", () => {
    expect(FLASH_MS).toBe(120);
    expect(indicatorLit("midiOut", { ...base, lastOut: 1000 - 119 })).toBe(true);
    expect(indicatorLit("midiOut", { ...base, lastOut: 1000 - 120 })).toBe(false);
    expect(indicatorLit("midiIn", { ...base, lastOut: 1000 })).toBe(false);
    expect(indicatorLit("midiIn", { ...base, lastIn: 990 })).toBe(true);
  });
});
