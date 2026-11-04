import { describe, expect, it } from "vitest";
import type { ExpTrigger } from "../types";
import {
  defaultTrigger,
  explainTrigger,
  idleTrigger,
  nudge,
  offDelayText,
  pickMode,
  releaseAt,
  stepTrigger,
  type TriggerState,
  thresholdAt,
  triggerAction,
  triggerLit,
} from "./trigger";

describe("defaultTrigger", () => {
  it("is Go's defaultTrigger: off, CC 102+n momentary, 4 %, 400 ms", () => {
    expect(defaultTrigger(0)).toEqual({
      mode: "off",
      action: { kind: "cc", channel: 1, number: 102, value: 127, mode: "momentary" },
      threshold: 4,
      offDelayMs: 400,
    });
    expect(defaultTrigger(1).action.number).toBe(103);
  });
});

describe("pickMode", () => {
  it("auto-engage works with one click", () => {
    const t = pickMode(defaultTrigger(0), "engage", 0);
    expect(t).toEqual({ ...defaultTrigger(0), mode: "engage" });
  });
  it("toe click moves the threshold to the toe and makes the CC a toggle", () => {
    const t = pickMode(defaultTrigger(1), "toe", 1);
    expect(t.threshold).toBe(96);
    expect(t.action).toEqual(triggerAction(1, "toe"));
    expect(t.action.mode).toBe("toggle");
  });
  it("back to auto-engage puts the threshold at the heel again", () => {
    const toe = pickMode(defaultTrigger(0), "toe", 0);
    const back = pickMode(toe, "engage", 0);
    expect(back.threshold).toBe(4);
    expect(back.action.mode).toBe("momentary");
  });
  it("keeps a threshold that already fits the mode", () => {
    const t = pickMode({ ...defaultTrigger(0), threshold: 12 }, "engage", 0);
    expect(t.threshold).toBe(12);
    expect(pickMode({ ...defaultTrigger(0), threshold: 88 }, "toe", 0).threshold).toBe(88);
  });
  it("keeps an action the user chose", () => {
    const note = { kind: "note", channel: 2, number: 60, value: 90, mode: "momentary" } as const;
    const t = pickMode({ ...defaultTrigger(0), action: note }, "toe", 0);
    expect(t.action).toEqual(note);
  });
  it("turning it off keeps the settings for next time", () => {
    const on: ExpTrigger = { ...defaultTrigger(0), mode: "toe", threshold: 90 };
    expect(pickMode(on, "off", 0)).toEqual({ ...on, mode: "off" });
  });
  it("gives a trigger with an off action something to send", () => {
    const t = pickMode(
      { ...defaultTrigger(0), action: { ...triggerAction(0), kind: "off" } },
      "engage",
      0,
    );
    expect(t.action.kind).toBe("cc");
  });
});

describe("threshold drag maths", () => {
  it("maps the pointer on the bar to percent", () => {
    expect(thresholdAt(50, 200)).toBe(25);
    expect(thresholdAt(199, 200)).toBe(99);
    expect(thresholdAt(101.2, 200)).toBe(51);
  });
  it("clamps to 1..99", () => {
    expect(thresholdAt(-30, 200)).toBe(1);
    expect(thresholdAt(0, 200)).toBe(1);
    expect(thresholdAt(400, 200)).toBe(99);
    expect(thresholdAt(10, 0)).toBe(1);
  });
  it("nudges with the keys", () => {
    expect(nudge(50, "ArrowRight")).toBe(51);
    expect(nudge(50, "ArrowUp")).toBe(51);
    expect(nudge(50, "ArrowLeft")).toBe(49);
    expect(nudge(50, "ArrowDown", true)).toBe(45);
    expect(nudge(50, "ArrowRight", true)).toBe(55);
    expect(nudge(50, "PageUp")).toBe(60);
    expect(nudge(50, "Home")).toBe(1);
    expect(nudge(50, "End")).toBe(99);
    expect(nudge(98, "ArrowRight", true)).toBe(99);
    expect(nudge(2, "ArrowLeft", true)).toBe(1);
    expect(nudge(50, "a")).toBeNull();
  });
  it("lets go 3 % under the threshold, never under the heel", () => {
    expect(releaseAt(96)).toBe(93);
    expect(releaseAt(2)).toBe(0);
  });
});

describe("words", () => {
  it("explains each mode with its numbers", () => {
    expect(explainTrigger({ ...defaultTrigger(0), mode: "engage", threshold: 6 })).toContain("6%");
    expect(explainTrigger({ ...defaultTrigger(0), mode: "toe", threshold: 92 })).toContain("89%");
    expect(explainTrigger(defaultTrigger(0))).toContain("Only the CC");
  });
  it("says what the off delay does", () => {
    expect(offDelayText(400)).toBe("Stays on for 400 ms after you return to the heel");
    expect(offDelayText(0)).toBe("Switches off the moment you return to the heel");
  });
});

// The mock's copy of mapping.Engine's trigger: the same cases as engine trigger_test.go.
describe("stepTrigger", () => {
  const engage: ExpTrigger = { ...defaultTrigger(0), mode: "engage" };
  const run = (t: ExpTrigger, feeds: [number, number | null][]) => {
    let s: TriggerState = idleTrigger();
    const out: string[] = [];
    for (const [ms, pct] of feeds) {
      const r = stepTrigger(s, t, pct, ms);
      s = r.state;
      if (r.release) out.push(`${ms}:off`);
      if (r.press) out.push(`${ms}:on`);
    }
    return { out, s };
  };
  it("engages on the rise and holds through a heel touch", () => {
    const { out } = run(engage, [
      [0, 0],
      [10, 5],
      [100, 0],
      [350, 30],
      [600, null],
      [1100, 0],
      [1499, null],
      [1500, null],
    ]);
    expect(out).toEqual(["10:on", "1500:off"]);
  });
  it("does not chatter at the boundary", () => {
    const { out } = run({ ...engage, offDelayMs: 0 }, [
      [0, 4.2],
      [10, 3.8],
      [20, 4.3],
      [30, 1.5],
      [40, 0.5],
    ]);
    expect(out).toEqual(["0:on", "40:off"]);
  });
  it("toe click toggles on each push", () => {
    const toe = pickMode(defaultTrigger(0), "toe", 0);
    const { out, s } = run(toe, [
      [0, 100],
      [10, 50],
      [20, 100],
      [30, 50],
      [40, 100],
    ]);
    expect(out).toEqual(["0:on", "10:off", "20:on", "30:off", "40:on"]);
    expect(triggerLit(s, toe)).toBe(true);
  });
});
