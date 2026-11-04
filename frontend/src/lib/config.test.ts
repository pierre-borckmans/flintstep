import { describe, expect, it } from "vitest";
import { defaultConfig, edit, mergeCalibration, nextCombo, sameConfig, validate } from "./config";

describe("defaultConfig", () => {
  it("matches the spec table", () => {
    const c = defaultConfig();
    expect(c.switches.map((s) => s.tap.number)).toEqual([80, 81, 82, 83, 84, 85]);
    expect(c.switches.every((s) => s.tap.mode === "momentary" && s.tap.channel === 1)).toBe(true);
    expect(c.exp.map((x) => x.cc)).toEqual([11, 7]);
    expect(c.ledMode).toBe("local");
  });
  it("is valid", () => expect(validate(defaultConfig())).toBeNull());
});

describe("validate", () => {
  const base = defaultConfig;
  it("catches a bad channel", () =>
    expect(validate(edit(base(), { type: "tap", sw: 1, patch: { channel: 17 } }))).toBe(
      "Switch II: channel must be 1 to 16",
    ));
  it("catches a bad velocity on a long press", () =>
    expect(
      validate(
        edit(base(), { type: "long", sw: 0, patch: { kind: "note", number: 60, value: 0 } }),
      ),
    ).toBe("Switch I hold: velocity must be 1 to 127"));
  it("ignores fields of an off action", () =>
    expect(
      validate(edit(base(), { type: "tap", sw: 0, patch: { kind: "off", number: 999 } })),
    ).toBeNull());
  it("program change needs no value", () =>
    expect(
      validate(edit(base(), { type: "tap", sw: 0, patch: { kind: "pc", value: 0 } })),
    ).toBeNull());
  it("rejects a combo on one switch", () => {
    const c = edit(edit(base(), { type: "addCombo" }), {
      type: "combo",
      index: 0,
      patch: { b: 0 },
    });
    expect(validate(c)).toBe("combo uses the same switch twice");
  });
  it("rejects two combos on the same pair, either order", () => {
    let c = edit(edit(base(), { type: "addCombo" }), { type: "addCombo" });
    c = edit(c, { type: "combo", index: 1, patch: { a: 1, b: 0 } });
    expect(validate(c)).toBe("two combos use II + I");
  });
  it("wants heel below toe", () =>
    expect(validate(edit(base(), { type: "exp", n: 1, patch: { min: 500, max: 500 } }))).toBe(
      "EXP 2: heel must be below toe (set them again)",
    ));
  it("bounds long press and brightness", () => {
    expect(validate(edit(base(), { type: "longPressMs", value: 50 }))).toMatch(/long-press/);
    expect(edit(base(), { type: "brightness", value: 140 }).brightness).toBe(100);
  });
});

describe("edit", () => {
  it("does not mutate", () => {
    const c = defaultConfig();
    const snap = JSON.stringify(c);
    edit(c, { type: "tap", sw: 0, patch: { number: 1 } });
    edit(c, { type: "colour", sw: 0, colour: { r: 1, g: 2, b: 3 } });
    expect(JSON.stringify(c)).toBe(snap);
  });
  it("turning a long press on gives a usable action", () => {
    const c = defaultConfig();
    c.switches[2].long = { kind: "off", channel: 0, number: 5, value: 0, mode: "momentary" };
    const l = edit(c, { type: "long", sw: 2, patch: { kind: "cc" } }).switches[2].long;
    expect(l).toMatchObject({ kind: "cc", channel: 1, value: 127, mode: "momentary" });
  });
  it("adds combos on fresh pairs and removes them", () => {
    let c = edit(defaultConfig(), { type: "addCombo" });
    c = edit(c, { type: "addCombo" });
    expect(c.combos.map((k) => [k.a, k.b])).toEqual([
      [0, 1],
      [1, 2],
    ]);
    c = edit(c, { type: "removeCombo", index: 0 });
    expect(c.combos.map((k) => [k.a, k.b])).toEqual([[1, 2]]);
  });
  it("nextCombo finds a free pair once the neighbours are used", () => {
    let c = defaultConfig();
    for (let i = 0; i < 7; i++) c = edit(c, { type: "addCombo" });
    expect(validate(c)).toBeNull();
    const k = nextCombo(c);
    expect([k.a, k.b]).toEqual([0, 2]);
  });
  it("detects a dirty draft", () => {
    const a = defaultConfig();
    expect(sameConfig(a, defaultConfig())).toBe(true);
    expect(sameConfig(a, edit(a, { type: "ledMode", mode: "feedback" }))).toBe(false);
  });
  it("merges a calibration into a dirty draft", () => {
    const draft = edit(defaultConfig(), { type: "ledMode", mode: "feedback" });
    const fresh = edit(defaultConfig(), { type: "exp", n: 0, patch: { min: 1200 } });
    const m = mergeCalibration(draft, fresh, 0);
    expect(m.ledMode).toBe("feedback");
    expect(m.exp[0].min).toBe(1200);
  });
});
