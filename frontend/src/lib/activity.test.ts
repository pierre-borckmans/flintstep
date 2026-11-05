import { describe, expect, it } from "vitest";
import type { Activity } from "../types";
import { canCoalesce, describeRow, type LogEntry, originChip, pushActivity } from "./activity";
import { defaultConfig } from "./config";

const act = (p: Partial<Activity>): Activity => ({
  dir: "out",
  bytes: [0xb0, 81, 127],
  label: "",
  at: 1000,
  source: "switch",
  index: 1,
  pair: [0, 0],
  ...p,
});

const exp = (v: number, at: number, p: Partial<Activity> = {}) =>
  act({ source: "exp", index: 0, bytes: [0xb0, 11, v], at, ...p });

describe("originChip", () => {
  const cfg = defaultConfig();
  it("names switches, long presses and combos", () => {
    expect(originChip(act({}), cfg)).toMatchObject({
      text: "II",
      target: { kind: "switch", n: 1 },
    });
    expect(originChip(act({ source: "long", index: 5 }), cfg).text).toBe("B hold");
    expect(originChip(act({ source: "combo", index: 0, pair: [0, 1] }), cfg)).toMatchObject({
      text: "I+II",
      title: "Combo I + II",
      target: { kind: "switch", n: 0 },
    });
  });
  it("names expression inputs and their triggers by mode", () => {
    expect(originChip(exp(10, 0), cfg)).toMatchObject({
      text: "EXP 1",
      target: { kind: "exp", n: 0 },
    });
    const c = defaultConfig();
    c.exp[1].trigger.mode = "toe";
    expect(originChip(act({ source: "trigger", index: 1 }), c).text).toBe("EXP 2 toe");
    c.exp[1].trigger.mode = "engage";
    expect(originChip(act({ source: "trigger", index: 1 }), c).text).toBe("EXP 2 auto");
  });
  it("points feedback at the switch whose lamp it drives", () => {
    const fb = act({ dir: "in", source: "feedback", index: -1, bytes: [0xb0, 83, 127] });
    expect(originChip(fb, cfg)).toMatchObject({
      text: "III ← DAW",
      target: { kind: "switch", n: 3 },
    });
    const other = { ...fb, bytes: [0xb0, 1, 127] };
    expect(originChip(other, cfg).text).toBe("LED ← DAW");
  });
  it("marks a forced release with what it let go of", () => {
    const r = act({ source: "release", of: "trigger", index: 0, bytes: [0xb0, 102, 0] });
    expect(originChip(r, cfg)).toMatchObject({
      text: "EXP 1 drop",
      tone: "release",
      target: { kind: "exp", n: 0 },
    });
    expect(originChip(act({ source: "release", of: "switch", index: 4 }), cfg).text).toBe(
      "IV drop",
    );
  });
  it("still says something without an origin", () => {
    const old = act({ source: undefined as never, dir: "in" });
    expect(originChip(old, null)).toMatchObject({ text: "DAW", target: null });
  });
});

describe("describeRow", () => {
  it("shows a switch's CC as on and off", () => {
    expect(describeRow(act({}), null)).toMatchObject({
      type: "cc",
      typeText: "CC",
      number: "81",
      value: "on",
      valueTone: "on",
      bar: null,
      channel: "",
    });
    expect(describeRow(act({ bytes: [0xb0, 81, 0] }), null).value).toBe("off");
    expect(describeRow(act({ bytes: [0xb0, 81, 100] }), null)).toMatchObject({
      value: "100",
      bar: 100 / 127,
    });
  });
  it("shows the DAW echoing a switch as on and off", () => {
    const fb = act({ dir: "in", source: "feedback", index: -1, bytes: [0xb0, 84, 0] });
    expect(describeRow(fb, defaultConfig()).value).toBe("off");
    expect(describeRow({ ...fb, bytes: [0xb0, 1, 0] }, defaultConfig()).value).toBe("0");
  });
  it("shows an expression CC as a value with a bar, and the channel when not 1", () => {
    expect(describeRow(exp(127, 0, { bytes: [0xb2, 7, 127] }), null)).toMatchObject({
      value: "127",
      bar: 1,
      channel: "ch 3",
    });
  });
  it("names notes and their velocity", () => {
    expect(describeRow(act({ bytes: [0x90, 60, 90] }), null)).toMatchObject({
      type: "note",
      typeText: "Note",
      number: "C4",
      numberSub: "60",
      value: "v90",
      bar: 90 / 127,
    });
    expect(describeRow(act({ bytes: [0x80, 60, 0] }), null).value).toBe("off");
    expect(describeRow(act({ bytes: [0x90, 60, 0] }), null).value).toBe("off");
  });
  it("shows a program change's number and no value", () => {
    expect(describeRow(act({ bytes: [0xc3, 5] }), null)).toMatchObject({
      type: "pc",
      number: "5",
      value: "",
      bar: null,
      channel: "ch 4",
      hex: "c3 05",
    });
  });
});

describe("coalescing", () => {
  it("merges a sweep from one input on one controller", () => {
    expect(canCoalesce(exp(10, 0), exp(20, 90))).toBe(true);
    expect(canCoalesce(exp(10, 0), exp(20, 401))).toBe(false);
    expect(canCoalesce(exp(10, 0), exp(20, 90, { index: 1 }))).toBe(false);
    expect(canCoalesce(exp(10, 0), exp(20, 90, { bytes: [0xb0, 12, 20] }))).toBe(false);
    expect(canCoalesce(exp(10, 0), exp(20, 90, { bytes: [0xb1, 11, 20] }))).toBe(false);
  });
  it("never merges switch presses", () => {
    expect(canCoalesce(act({}), act({ bytes: [0xb0, 81, 0], at: 1100 }))).toBe(false);
  });
  it("merges feedback CCs but not notes", () => {
    const fb = (b: number[], at: number) =>
      act({ dir: "in", source: "feedback", index: -1, bytes: b, at });
    expect(canCoalesce(fb([0xb0, 1, 3], 0), fb([0xb0, 1, 4], 50))).toBe(true);
    expect(canCoalesce(fb([0x90, 60, 3], 0), fb([0x90, 60, 4], 50))).toBe(false);
  });
  it("keeps the latest value, counts, and caps the log", () => {
    let log: LogEntry[] = [];
    let seq = 0;
    log = pushActivity(log, act({ at: 0 }), ++seq, 3);
    for (let i = 0; i < 12; i++) log = pushActivity(log, exp(i * 10, 100 + i * 90), ++seq, 3);
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ id: 2, seq: 13, count: 12, firstAt: 100, at: 1090 });
    expect(log[0].bytes[2]).toBe(110);
    log = pushActivity(log, act({ at: 2000 }), ++seq, 3);
    log = pushActivity(log, act({ at: 2100 }), ++seq, 3);
    expect(log.map((e) => e.id)).toEqual([15, 14, 2]);
  });
});
