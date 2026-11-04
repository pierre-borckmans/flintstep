import { describe, expect, it } from "vitest";
import type { PresetInfo } from "../types";
import { defaultConfig } from "./config";
import {
  checkName,
  copyName,
  decodePreset,
  encodePreset,
  exportFileName,
  listKey,
  MAX_NAME,
  presetLabel,
  uniqueName,
} from "./presets";

const p = (id: string, name: string, active = false): PresetInfo => ({
  id,
  name,
  updatedAt: 0,
  active,
});
const lib = [p("a", "My mapping", true), p("b", "Ableton live")];

describe("checkName", () => {
  it("trims and accepts a free name", () => {
    expect(checkName("  Logic  ", lib)).toEqual({ name: "Logic" });
  });
  it("refuses an empty name", () => {
    expect(checkName("   ", lib)).toEqual({ error: "A preset needs a name" });
  });
  it("refuses a name over 40 characters, counting characters not bytes", () => {
    expect(checkName("x".repeat(MAX_NAME + 1), lib)).toEqual({
      error: "At most 40 characters",
    });
    expect(checkName("é".repeat(MAX_NAME), lib)).toEqual({ name: "é".repeat(MAX_NAME) });
  });
  it("refuses another preset's name in any case", () => {
    expect(checkName("ABLETON LIVE", lib)).toEqual({
      error: "“Ableton live” already exists",
    });
  });
  it("lets a preset keep its own name, or change its case", () => {
    expect(checkName("ableton live", lib, "b")).toEqual({ name: "ableton live" });
  });
});

describe("names", () => {
  it("uniqueName adds (2), (3)… and stays within 40", () => {
    expect(uniqueName("Logic", ["My mapping"])).toBe("Logic");
    expect(uniqueName("My mapping", ["my mapping"])).toBe("My mapping (2)");
    expect(uniqueName("My mapping", ["My mapping", "My mapping (2)"])).toBe("My mapping (3)");
    const long = "y".repeat(MAX_NAME);
    const u = uniqueName(long, [long]);
    expect(u.length).toBe(MAX_NAME);
    expect(u.endsWith(" (2)")).toBe(true);
  });
  it("copyName is “<name> copy”, unique", () => {
    expect(copyName("Live", ["Live"])).toBe("Live copy");
    expect(copyName("Live", ["Live", "Live copy"])).toBe("Live copy (2)");
    expect(copyName("z".repeat(MAX_NAME), []).length).toBe(MAX_NAME);
  });
  it("presetLabel is the history entry for a switch", () => {
    expect(presetLabel("Ableton live")).toBe("Preset · Ableton live");
  });
  it("exportFileName mirrors Go's", () => {
    expect(exportFileName("Ableton live")).toBe("Ableton live.sparkx.json");
    expect(exportFileName("A/B: test")).toBe("A-B- test.sparkx.json");
  });
});

describe("listKey", () => {
  it("moves with the arrows, clamped, and jumps with Home/End", () => {
    expect(listKey("ArrowDown", 0, 3)).toEqual({ type: "move", index: 1 });
    expect(listKey("ArrowDown", 2, 3)).toEqual({ type: "move", index: 2 });
    expect(listKey("ArrowUp", 0, 3)).toEqual({ type: "move", index: 0 });
    expect(listKey("ArrowUp", 2, 3)).toEqual({ type: "move", index: 1 });
    expect(listKey("Home", 2, 3)).toEqual({ type: "move", index: 0 });
    expect(listKey("End", 0, 3)).toEqual({ type: "move", index: 2 });
  });
  it("starts from the top when nothing is highlighted", () => {
    expect(listKey("ArrowDown", -1, 3)).toEqual({ type: "move", index: 0 });
  });
  it("Enter chooses, Escape closes, F2 renames, anything else is nothing", () => {
    expect(listKey("Enter", 1, 3)).toEqual({ type: "choose", index: 1 });
    expect(listKey("Enter", -1, 3)).toBeNull();
    expect(listKey("Escape", 1, 3)).toEqual({ type: "close" });
    expect(listKey("F2", 1, 3)).toEqual({ type: "rename", index: 1 });
    expect(listKey("a", 1, 3)).toBeNull();
    expect(listKey("ArrowDown", 0, 0)).toBeNull();
  });
});

describe("decodePreset", () => {
  it("round-trips an export, without the pedal", () => {
    const c = defaultConfig();
    c.pedal = { address: "4F1A", name: "SparkX" };
    c.longPressMs = 900;
    const text = encodePreset("Ableton live", c);
    expect(text).not.toContain("4F1A");
    expect(JSON.parse(text).format).toBe("sparkx-midi-preset");
    const got = decodePreset(text, "x.json");
    expect(got.name).toBe("Ableton live");
    expect(got.config.longPressMs).toBe(900);
    expect(got.config.pedal).toEqual({ address: "", name: "" });
  });
  it("takes a bare config, named after the file", () => {
    const c = defaultConfig();
    c.pedal = { address: "4F1A", name: "SparkX" };
    const got = decodePreset(JSON.stringify(c), "/Users/me/config.json");
    expect(got.name).toBe("config");
    expect(got.config.pedal.address).toBe("");
    expect(decodePreset(JSON.stringify(c), "Gig.sparkx.json").name).toBe("Gig");
  });
  it("refuses what is not a preset", () => {
    for (const bad of [
      "{oops",
      "[]",
      "{}",
      '{"hello":1}',
      '{"format":"other","version":1,"config":{}}',
      '{"format":"sparkx-midi-preset","version":99,"config":{}}',
      '{"format":"sparkx-midi-preset","version":1}',
    ]) {
      expect(() => decodePreset(bad, "x.json"), bad).toThrow();
    }
  });
});
