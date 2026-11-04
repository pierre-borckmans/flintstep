import { describe, expect, it } from "vitest";
import type { Action } from "../types";
import { actionCaption, comboName, longCaption } from "./caption";

const a = (p: Partial<Action>): Action => ({
  kind: "cc",
  channel: 1,
  number: 80,
  value: 127,
  mode: "momentary",
  ...p,
});

describe("actionCaption", () => {
  it("describes CC with its mode", () => {
    expect(actionCaption(a({}))).toBe("CC 80 · momentary");
    expect(actionCaption(a({ mode: "toggle", number: 85 }))).toBe("CC 85 · toggle");
  });
  it("names notes", () => expect(actionCaption(a({ kind: "note", number: 60 }))).toBe("Note C4"));
  it("shows programs", () => expect(actionCaption(a({ kind: "pc", number: 5 }))).toBe("PC 5"));
  it("adds the channel only when it is not 1", () =>
    expect(actionCaption(a({ channel: 10 }))).toBe("CC 80 · momentary · ch 10"));
  it("drops momentary in the short form", () => {
    expect(actionCaption(a({}), true)).toBe("CC 80");
    expect(actionCaption(a({ mode: "toggle" }), true)).toBe("CC 80 · toggle");
  });
  it("says Off", () => expect(actionCaption(a({ kind: "off" }))).toBe("Off"));
});

describe("longCaption", () => {
  it("is empty without a long press", () => expect(longCaption(a({ kind: "off" }))).toBe(""));
  it("prefixes hold", () => expect(longCaption(a({ kind: "pc", number: 3 }))).toBe("hold: PC 3"));
});

it("names combos by switch", () => expect(comboName({ a: 0, b: 2 })).toBe("I + A"));
