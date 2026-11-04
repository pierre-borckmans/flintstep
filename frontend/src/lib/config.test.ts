import { describe, expect, it } from "vitest";
import type { Action, Combo, Config } from "../types";
import {
  cc,
  defaultConfig,
  edit,
  mergeCalibration,
  nextCombo,
  opKey,
  sameConfig,
  sameMapping,
  validate,
} from "./config";

describe("defaultConfig", () => {
  it("matches the spec table", () => {
    const c = defaultConfig();
    expect(c.switches.map((s) => s.tap.number)).toEqual([80, 81, 82, 83, 84, 85]);
    expect(c.switches.every((s) => s.tap.mode === "momentary" && s.tap.channel === 1)).toBe(true);
    expect(c.exp.map((x) => x.cc)).toEqual([11, 7]);
    expect(c.ledMode).toBe("local");
  });
  it("is valid", () => expect(validate(defaultConfig())).toBeNull());
  // mapping.Default(), field for field: what ResetConfig would return.
  it("is Go's Default()", () =>
    expect(defaultConfig()).toEqual({
      version: 3,
      pedal: { address: "", name: "" },
      switches: [
        { r: 255, g: 150, b: 0 },
        { r: 255, g: 80, b: 0 },
        { r: 255, g: 0, b: 170 },
        { r: 0, g: 220, b: 255 },
        { r: 0, g: 120, b: 255 },
        { r: 150, g: 0, b: 255 },
      ].map((colour, n) => ({
        tap: { kind: "cc", channel: 1, number: 80 + n, value: 127, mode: "momentary" },
        long: { kind: "off", channel: 1, number: 0, value: 127, mode: "momentary" },
        colour,
      })),
      combos: [],
      exp: [
        [11, 102],
        [7, 103],
      ].map(([cc, trig]) => ({
        enabled: true,
        channel: 1,
        cc,
        min: 0,
        max: 65535,
        invert: false,
        trigger: {
          mode: "off",
          action: { kind: "cc", channel: 1, number: trig, value: 127, mode: "momentary" },
          threshold: 4,
          offDelayMs: 400,
        },
      })),
      ledMode: "local",
      longPressMs: 500,
      brightness: 100,
      indicators: [
        { mode: "midiOut", colour: { r: 0, g: 176, b: 80 } },
        { mode: "connected", colour: { r: 64, g: 32, b: 255 } },
      ],
    }));
});

describe("indicators", () => {
  it("rejects an unknown mode, naming the lamp", () => {
    const c = defaultConfig();
    c.indicators[1] = { ...c.indicators[1], mode: "blink" as "on" };
    expect(validate(c)).toBe("APP lamp: unknown mode");
  });
  it("needs both lamps", () =>
    expect(validate({ ...defaultConfig(), indicators: [] })).toBe(
      "the pedal has two indicator lamps",
    ));
  it("edits one lamp's mode or colour", () => {
    const c = defaultConfig();
    const m = edit(c, { type: "indicator", n: 0, patch: { mode: "usb" } });
    expect(m.indicators[0]).toEqual({ mode: "usb", colour: c.indicators[0].colour });
    expect(m.indicators[1]).toEqual(c.indicators[1]);
    expect(c.indicators[0].mode).toBe("midiOut");
    const red = { r: 255, g: 0, b: 0 };
    expect(
      edit(c, { type: "indicator", n: 1, patch: { colour: red } }).indicators[1].colour,
    ).toEqual(red);
  });
  it("coalesces repeated edits to one field of one lamp", () => {
    expect(opKey({ type: "indicator", n: 0, patch: { mode: "on" } })).toBe(
      opKey({ type: "indicator", n: 0, patch: { mode: "off" } }),
    );
    expect(opKey({ type: "indicator", n: 0, patch: { mode: "on" } })).not.toBe(
      opKey({ type: "indicator", n: 1, patch: { mode: "on" } }),
    );
  });
});

// The rules of mapping.Config.Validate, in its order and its words.
describe("validate mirrors Go", () => {
  const withCombos = (combos: Combo[]): Config => ({ ...defaultConfig(), combos });
  const tap = (n: number): Action => cc(80 + n);
  const off: Action = { kind: "off", channel: 1, number: 0, value: 127, mode: "momentary" };
  it("names a combo on a switch that does not exist by its number", () =>
    expect(validate(withCombos([{ a: 0, b: 6, action: tap(0) }]))).toBe(
      "combo 1 uses a switch that does not exist",
    ));
  it("names the switch a combo uses twice", () =>
    expect(validate(withCombos([{ a: 2, b: 2, action: tap(0) }]))).toBe(
      "combo A + A uses the same switch twice",
    ));
  it("rejects a combo that does nothing", () =>
    expect(validate(withCombos([{ a: 0, b: 3, action: off }]))).toBe(
      "combo I + III does nothing: pick what it sends",
    ));
  it("checks each combo whole before the next, like Go", () =>
    expect(
      validate(
        withCombos([
          { a: 0, b: 1, action: tap(0) },
          { a: 1, b: 0, action: off },
        ]),
      ),
    ).toBe("combo II + I does nothing: pick what it sends"));
  it("accepts a combo pair again in a fresh config", () =>
    expect(validate(withCombos([{ a: 0, b: 1, action: tap(0) }]))).toBeNull());
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
    expect(validate(c)).toBe("combo I + I uses the same switch twice");
  });
  it("rejects two combos on the same pair, either order", () => {
    let c = edit(edit(base(), { type: "addCombo" }), { type: "addCombo" });
    c = edit(c, { type: "combo", index: 1, patch: { a: 1, b: 0 } });
    expect(validate(c)).toBe("two combos use II + I");
  });
  it("rejects heel and toe at the same point", () =>
    expect(validate(edit(base(), { type: "exp", n: 1, patch: { min: 500, max: 500 } }))).toBe(
      "expression 2: heel and toe were calibrated at the same point",
    ));
  it("accepts a toe that reads lower than the heel", () =>
    expect(
      validate(edit(base(), { type: "exp", n: 0, patch: { min: 50000, max: 3000 } })),
    ).toBeNull());
  it("ignores the calibration of a disabled input", () =>
    expect(
      validate(edit(base(), { type: "exp", n: 1, patch: { enabled: false, min: 500, max: 500 } })),
    ).toBeNull());
  it("takes an uncalibrated 0/0 input as the whole jack", () =>
    expect(validate(edit(base(), { type: "exp", n: 0, patch: { min: 0, max: 0 } }))).toBeNull());
  it("bounds long press to Go's MinLongPressMS..MaxLongPressMS", () => {
    const lp = (value: number) => validate(edit(base(), { type: "longPressMs", value }));
    expect(lp(150)).toBeNull();
    expect(lp(3000)).toBeNull();
    expect(lp(149)).toBe("long-press time must be 150 to 3000 ms");
    expect(lp(3001)).toBe("long-press time must be 150 to 3000 ms");
  });
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

describe("opKey", () => {
  it("is the same for repeated edits to one field", () => {
    expect(opKey({ type: "tap", sw: 1, patch: { number: 1 } })).toBe(
      opKey({ type: "tap", sw: 1, patch: { number: 127 } }),
    );
    expect(opKey({ type: "brightness", value: 10 })).toBe(opKey({ type: "brightness", value: 90 }));
    expect(opKey({ type: "colour", sw: 2, colour: { r: 1, g: 1, b: 1 } })).toBe("colour:2");
  });
  it("differs across fields, switches and inputs", () => {
    const keys = [
      opKey({ type: "tap", sw: 1, patch: { number: 1 } }),
      opKey({ type: "tap", sw: 1, patch: { value: 1 } }),
      opKey({ type: "tap", sw: 2, patch: { number: 1 } }),
      opKey({ type: "long", sw: 1, patch: { number: 1 } }),
      opKey({ type: "exp", n: 0, patch: { cc: 1 } }),
      opKey({ type: "exp", n: 1, patch: { cc: 1 } }),
      opKey({ type: "combo", index: 0, patch: {}, action: { number: 1 } }),
      opKey({ type: "combo", index: 0, patch: { a: 1 } }),
      opKey({ type: "longPressMs", value: 500 }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("is null for steps of their own", () => {
    expect(opKey({ type: "addCombo" })).toBeNull();
    expect(opKey({ type: "removeCombo", index: 0 })).toBeNull();
  });
});

describe("expression triggers", () => {
  const base = () => defaultConfig();
  it("picking a mode fills in a working trigger", () => {
    const c = edit(base(), { type: "triggerMode", n: 1, mode: "toe" });
    expect(c.exp[1].trigger).toEqual({
      mode: "toe",
      action: { kind: "cc", channel: 1, number: 103, value: 127, mode: "toggle" },
      threshold: 96,
      offDelayMs: 400,
    });
    expect(c.exp[0]).toEqual(base().exp[0]);
    expect(validate(c)).toBeNull();
  });
  it("edits the threshold, delay and action", () => {
    let c = edit(base(), { type: "triggerMode", n: 0, mode: "engage" });
    c = edit(c, { type: "trigger", n: 0, patch: { threshold: 7, offDelayMs: 650 } });
    c = edit(c, { type: "trigger", n: 0, patch: {}, action: { kind: "note", number: 60 } });
    expect(c.exp[0].trigger).toMatchObject({ threshold: 7, offDelayMs: 650 });
    expect(c.exp[0].trigger.action).toMatchObject({ kind: "note", number: 60 });
  });
  it("leaves the trigger alone on other expression edits", () => {
    const c = edit(base(), { type: "triggerMode", n: 0, mode: "engage" });
    expect(edit(c, { type: "exp", n: 0, patch: { cc: 4 } }).exp[0].trigger).toEqual(
      c.exp[0].trigger,
    );
  });
  it("Go's rule: a trigger that sends nothing, in Go's words", () => {
    const c = edit(base(), { type: "triggerMode", n: 1, mode: "engage" });
    expect(validate(edit(c, { type: "trigger", n: 1, patch: {}, action: { kind: "off" } }))).toBe(
      "expression 2: the trigger does nothing: pick what it sends",
    );
    // Off, it does not matter what it would send.
    const off = edit(base(), { type: "trigger", n: 1, patch: {}, action: { kind: "off" } });
    expect(validate(off)).toBeNull();
  });
  it("the ranges Go would clamp", () => {
    const t = (patch: { threshold?: number; offDelayMs?: number }) =>
      validate(edit(base(), { type: "trigger", n: 0, patch }));
    expect(t({ threshold: 0 })).toBe("EXP 1: trigger threshold must be 1 to 99%");
    expect(t({ threshold: 100 })).toBe("EXP 1: trigger threshold must be 1 to 99%");
    expect(t({ threshold: 4.5 })).toBe("EXP 1: trigger threshold must be 1 to 99%");
    expect(t({ offDelayMs: 2001 })).toBe("EXP 1: off delay must be 0 to 2000 ms");
    expect(t({ offDelayMs: 0 })).toBeNull();
    expect(
      validate(edit(base(), { type: "trigger", n: 0, patch: {}, action: { channel: 0 } })),
    ).toBe("EXP 1 trigger: channel must be 1 to 16");
    const bad = base();
    bad.exp[0].trigger.mode = "wah" as "off";
    expect(validate(bad)).toBe("EXP 1: unknown trigger mode");
  });
  it("a threshold drag is one undo step, a mode pick its own", () => {
    expect(opKey({ type: "trigger", n: 0, patch: { threshold: 5 } })).toBe(
      opKey({ type: "trigger", n: 0, patch: { threshold: 9 } }),
    );
    expect(opKey({ type: "trigger", n: 0, patch: { threshold: 5 } })).not.toBe(
      opKey({ type: "trigger", n: 1, patch: { threshold: 5 } }),
    );
    expect(opKey({ type: "triggerMode", n: 0, mode: "toe" })).toBeNull();
  });
});

describe("sameMapping", () => {
  it("ignores the remembered pedal", () => {
    const a = defaultConfig();
    const b = { ...defaultConfig(), pedal: { address: "AA", name: "SparkX" } };
    expect(sameConfig(a, b)).toBe(false);
    expect(sameMapping(a, b)).toBe(true);
    expect(sameMapping(a, edit(b, { type: "brightness", value: 5 }))).toBe(false);
  });
});
