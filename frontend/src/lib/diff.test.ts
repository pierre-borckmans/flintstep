import { describe, expect, it } from "vitest";
import type { Config } from "../types";
import { defaultConfig, edit, type Op } from "./config";
import { configChanges, diffConfigs } from "./diff";

const base = () => defaultConfig();
const edited = (...ops: Op[]): Config => ops.reduce(edit, base());
const label = (...ops: Op[]) => diffConfigs(base(), edited(...ops));

describe("diffConfigs: indicator lamps", () => {
  it("names the lamp and its new mode", () => {
    expect(label({ type: "indicator", n: 0, patch: { mode: "usb" } })).toBe("AMP lamp · USB power");
    expect(label({ type: "indicator", n: 1, patch: { mode: "midiOut" } })).toBe(
      "APP lamp · MIDI out",
    );
  });
  it("says the colour changed", () =>
    expect(label({ type: "indicator", n: 1, patch: { colour: { r: 1, g: 2, b: 3 } } })).toBe(
      "APP lamp · colour",
    ));
});

describe("diffConfigs: switches", () => {
  it("says nothing changed", () => expect(diffConfigs(base(), base())).toBe("No change"));

  it("names a new message type by what it sends", () => {
    expect(label({ type: "tap", sw: 1, patch: { kind: "note", number: 60 } })).toBe(
      "Switch II · CC 81 → Note C4",
    );
    expect(label({ type: "tap", sw: 4, patch: { kind: "pc", number: 5 } })).toBe(
      "Switch IV · CC 84 → PC 5",
    );
    expect(label({ type: "tap", sw: 0, patch: { kind: "off" } })).toBe("Switch I · CC 80 → Off");
  });

  it("shows a new number as before and after", () =>
    expect(label({ type: "tap", sw: 1, patch: { number: 127 } })).toBe(
      "Switch II · CC 81 → CC 127",
    ));

  it("names the CC mode", () => {
    expect(label({ type: "tap", sw: 2, patch: { mode: "toggle" } })).toBe("Switch A · toggle");
    const toggled = edited({ type: "tap", sw: 2, patch: { mode: "toggle" } });
    expect(diffConfigs(toggled, base())).toBe("Switch A · momentary");
  });

  it("names channel, value and velocity", () => {
    expect(label({ type: "tap", sw: 0, patch: { channel: 2 } })).toBe("Switch I · channel 1 → 2");
    expect(label({ type: "tap", sw: 0, patch: { value: 100 } })).toBe("Switch I · value 127 → 100");
    const note = edited({ type: "tap", sw: 0, patch: { kind: "note", number: 60 } });
    expect(diffConfigs(note, edit(note, { type: "tap", sw: 0, patch: { value: 90 } }))).toBe(
      "Switch I · velocity 127 → 90",
    );
  });

  it("ignores fields an off action does not use", () =>
    expect(label({ type: "long", sw: 0, patch: { number: 9 } })).toBe("No change"));

  it("turns a long press on and off", () => {
    const on: Op = { type: "long", sw: 3, patch: { kind: "cc", number: 93 } };
    expect(label(on)).toBe("Switch III · long press CC 93");
    expect(diffConfigs(edited(on), base())).toBe("Switch III · long press off");
  });

  it("edits a long press as the switch's hold", () => {
    const on = edited({ type: "long", sw: 3, patch: { kind: "cc", number: 93 } });
    const pc = edit(on, { type: "long", sw: 3, patch: { kind: "pc", number: 4 } });
    expect(diffConfigs(on, pc)).toBe("Switch III hold · CC 93 → PC 4");
    const ch = edit(on, { type: "long", sw: 3, patch: { channel: 5 } });
    expect(diffConfigs(on, ch)).toBe("Switch III hold · channel 1 → 5");
  });

  it("names a colour change", () =>
    expect(label({ type: "colour", sw: 0, colour: { r: 1, g: 2, b: 3 } })).toBe(
      "Switch I · LED colour",
    ));
});

describe("diffConfigs: combos", () => {
  const one = () => edited({ type: "addCombo" });

  it("adds and removes", () => {
    expect(diffConfigs(base(), one())).toBe("Combo I + II added");
    expect(diffConfigs(one(), base())).toBe("Combo I + II removed");
  });

  it("removes the right one from the middle", () => {
    const three = edited({ type: "addCombo" }, { type: "addCombo" }, { type: "addCombo" });
    const two = edit(three, { type: "removeCombo", index: 1 });
    expect(diffConfigs(three, two)).toBe("Combo II + A removed");
  });

  it("names a new pair", () =>
    expect(diffConfigs(one(), edit(one(), { type: "combo", index: 0, patch: { b: 2 } }))).toBe(
      "Combo I + II → I + A",
    ));

  it("names its action by the pair", () =>
    expect(
      diffConfigs(
        one(),
        edit(one(), { type: "combo", index: 0, patch: {}, action: { kind: "note", number: 62 } }),
      ),
    ).toBe("Combo I + II · CC 100 → Note D4"));

  it("counts several combos at once", () => {
    const two = edited({ type: "addCombo" }, { type: "addCombo" });
    expect(diffConfigs(base(), two)).toBe("2 combos added");
    expect(diffConfigs(two, base())).toBe("2 combos removed");
  });
});

describe("diffConfigs: expression and settings", () => {
  it("names calibration", () => {
    expect(label({ type: "exp", n: 0, patch: { min: 1200 } })).toBe("Exp 1 · heel set");
    expect(label({ type: "exp", n: 1, patch: { max: 50000 } })).toBe("Exp 2 · toe set");
    expect(label({ type: "exp", n: 0, patch: { min: 1, max: 2 } })).toBe(
      "Exp 1 · heel and toe set",
    );
  });

  it("names the other expression fields", () => {
    expect(label({ type: "exp", n: 0, patch: { enabled: false } })).toBe("Exp 1 · off");
    expect(label({ type: "exp", n: 1, patch: { invert: true } })).toBe("Exp 2 · inverted");
    expect(label({ type: "exp", n: 0, patch: { cc: 4 } })).toBe("Exp 1 · CC 11 → 4");
    expect(label({ type: "exp", n: 0, patch: { channel: 3 } })).toBe("Exp 1 · channel 1 → 3");
  });

  it("names the settings by their new value", () => {
    expect(label({ type: "ledMode", mode: "feedback" })).toBe("LED mode · MIDI feedback");
    expect(diffConfigs(edited({ type: "ledMode", mode: "feedback" }), base())).toBe(
      "LED mode · local",
    );
    expect(label({ type: "longPressMs", value: 650 })).toBe("Long press · 650 ms");
    expect(label({ type: "brightness", value: 80 })).toBe("Brightness · 80%");
  });
});

describe("diffConfigs: several changes", () => {
  it("never mentions the pedal", () => {
    const c = base();
    c.pedal = { address: "AA", name: "SparkX" };
    expect(diffConfigs(base(), c)).toBe("No change");
  });

  it("gives the first change and a count", () =>
    expect(
      label(
        { type: "colour", sw: 0, colour: { r: 1, g: 2, b: 3 } },
        { type: "brightness", value: 40 },
        { type: "ledMode", mode: "feedback" },
      ),
    ).toBe("Switch I · LED colour + 2 more"));

  it("calls a return to the defaults a reset", () => {
    const changed = edited(
      { type: "tap", sw: 0, patch: { kind: "note", number: 60 } },
      { type: "addCombo" },
      { type: "brightness", value: 40 },
    );
    changed.pedal = { address: "AA", name: "SparkX" };
    const fresh = { ...base(), pedal: changed.pedal };
    expect(diffConfigs(changed, fresh)).toBe("Mapping reset");
  });

  it("lists changes in editor order", () =>
    expect(
      configChanges(
        base(),
        edited(
          { type: "longPressMs", value: 700 },
          { type: "exp", n: 1, patch: { cc: 1 } },
          { type: "tap", sw: 5, patch: { channel: 2 } },
        ),
      ),
    ).toEqual(["Switch B · channel 1 → 2", "Exp 2 · CC 7 → 1", "Long press · 700 ms"]));
});
