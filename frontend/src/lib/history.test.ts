import { describe, expect, it } from "vitest";
import {
  canRedo,
  canUndo,
  current,
  type History,
  type HistoryRules,
  jump,
  push,
  redo,
  redoLabel,
  start,
  undo,
  undoLabel,
} from "./history";

const rules: HistoryRules<number> = {
  same: (a, b) => a === b,
  describe: (a, b) => `${a}→${b}`,
  coalesceMs: 1000,
  cap: 5,
};

const states = (h: History<number>) => h.entries.map((e) => e.state);
const labels = (h: History<number>) => h.entries.map((e) => e.label);

/** Pushes values one second apart under distinct keys: nothing coalesces. */
const many = (h: History<number>, ...vs: number[]) =>
  vs.reduce((acc, v, i) => push(acc, rules, v, { at: (i + 1) * 5000, key: `k${v}` }), h);

describe("push", () => {
  it("adds labelled entries and moves the cursor", () => {
    const h = many(start(0, 0), 1, 2);
    expect(states(h)).toEqual([0, 1, 2]);
    expect(labels(h)).toEqual(["Session start", "0→1", "1→2"]);
    expect(current(h)).toBe(2);
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);
  });

  it("ignores a change to the same state", () => {
    const h = many(start(0, 0), 1);
    expect(push(h, rules, 1, { at: 9e9 })).toBe(h);
  });

  it("takes an explicit label", () =>
    expect(push(start(0, 0), rules, 7, { at: 1, label: "Reset" }).entries[1].label).toBe("Reset"));

  it("drops the redo tail", () => {
    let h = many(start(0, 0), 1, 2, 3);
    h = undo(undo(h));
    h = push(h, rules, 9, { at: 99_000, key: "x" });
    expect(states(h)).toEqual([0, 1, 9]);
    expect(canRedo(h)).toBe(false);
  });

  it("caps the changes kept, the oldest kept state becoming the base", () => {
    const h = many(start(0, 0), 1, 2, 3, 4, 5, 6, 7);
    expect(states(h)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(h.cursor).toBe(5);
    let u = h;
    for (let i = 0; i < 10; i++) u = undo(u);
    expect(current(u)).toBe(2);
  });
});

describe("coalescing", () => {
  it("merges quick edits to one key into one entry, relabelled from the start", () => {
    let h = start(80, 0);
    h = push(h, rules, 1, { at: 100, key: "cc" });
    h = push(h, rules, 12, { at: 300, key: "cc" });
    h = push(h, rules, 127, { at: 500, key: "cc" });
    expect(states(h)).toEqual([80, 127]);
    expect(labels(h)[1]).toBe("80→127");
    expect(h.entries[1].at).toBe(500);
  });

  it("keeps merging while the gaps stay short, however long the burst", () => {
    let h = start(0, 0);
    for (let i = 1; i <= 20; i++) h = push(h, rules, i, { at: i * 800, key: "slider" });
    expect(states(h)).toEqual([0, 20]);
  });

  it("starts a new entry after a pause", () => {
    let h = start(0, 0);
    h = push(h, rules, 1, { at: 100, key: "cc" });
    h = push(h, rules, 2, { at: 1200, key: "cc" });
    expect(states(h)).toEqual([0, 1, 2]);
  });

  it("does not merge different keys or keyless changes", () => {
    let h = start(0, 0);
    h = push(h, rules, 1, { at: 100, key: "a" });
    h = push(h, rules, 2, { at: 200, key: "b" });
    h = push(h, rules, 3, { at: 300 });
    h = push(h, rules, 4, { at: 400 });
    expect(states(h)).toEqual([0, 1, 2, 3, 4]);
  });

  it("drops the entry when the burst ends where it began", () => {
    let h = many(start(0, 0), 5);
    h = push(h, rules, 50, { at: 60_000, key: "slider" });
    h = push(h, rules, 70, { at: 60_100, key: "slider" });
    h = push(h, rules, 5, { at: 60_200, key: "slider" });
    expect(states(h)).toEqual([0, 5]);
    // and the next edit to that key is a fresh entry, not merged into the one before
    h = push(h, rules, 6, { at: 60_300, key: "slider" });
    expect(states(h)).toEqual([0, 5, 6]);
  });

  it("never merges into an entry after undo, redo or jump", () => {
    let h = start(0, 0);
    h = push(h, rules, 1, { at: 100, key: "cc" });
    h = push(h, rules, 2, { at: 200, key: "cc2" });
    h = redo(undo(h));
    h = push(h, rules, 3, { at: 300, key: "cc2" });
    expect(states(h)).toEqual([0, 1, 2, 3]);
    h = jump(h, 3);
    h = push(h, rules, 4, { at: 400, key: "cc2" });
    expect(states(h)).toEqual([0, 1, 2, 3, 4]);
  });

  it("never merges into the base entry", () => {
    const h = push(start(0, 0, "x"), rules, 1, { at: 1, key: null });
    expect(states(h)).toEqual([0, 1]);
  });
});

describe("undo, redo, jump", () => {
  it("walks back and forth", () => {
    let h = many(start(0, 0), 1, 2);
    expect(undoLabel(h)).toBe("1→2");
    expect(redoLabel(h)).toBeNull();
    h = undo(h);
    expect(current(h)).toBe(1);
    expect(redoLabel(h)).toBe("1→2");
    h = undo(h);
    expect(current(h)).toBe(0);
    expect(undoLabel(h)).toBeNull();
    expect(undo(h)).toBe(h);
    h = redo(redo(h));
    expect(current(h)).toBe(2);
    expect(redo(h)).toBe(h);
  });

  it("jumps to any entry and keeps the others", () => {
    let h = many(start(0, 0), 1, 2, 3);
    h = jump(h, 1);
    expect(current(h)).toBe(1);
    expect(states(h)).toEqual([0, 1, 2, 3]);
    h = jump(h, 3);
    expect(current(h)).toBe(3);
    expect(jump(h, 9).cursor).toBe(3);
    expect(jump(h, -1).cursor).toBe(3);
  });
});
