import { describe, expect, it } from "vitest";
import * as H from "./history";
import * as S from "./stacks";

const rules: S.StackRules<number> = {
  same: (a, b) => a === b,
  describe: (a, b) => `${a}→${b}`,
  coalesceMs: 0,
  cap: 100,
  stacks: 3,
};

/** One edit on the active preset's stack. */
const edit = (s: S.Stacks<number>, v: number, at = v) =>
  S.update(s, H.push(S.active(s), rules, v, { at }));
const states = (s: S.Stacks<number>) => S.active(s).entries.map((e) => e.state);

describe("per-preset stacks", () => {
  it("starts with an empty stack for the active preset", () => {
    const s = S.open<number>("a", 10, 0);
    expect(s.active).toBe("a");
    expect(states(s)).toEqual([10]);
    expect(H.canUndo(S.active(s))).toBe(false);
  });

  it("a switch gives the other preset its own stack, and coming back restores the first with its cursor", () => {
    let s = S.open<number>("a", 10, 0);
    s = edit(s, 11);
    s = edit(s, 12);
    s = edit(s, 13);
    s = S.update(s, H.undo(S.active(s))); // cursor on 12, 13 still to redo
    s = S.enter(s, rules, "b", 20, 100);
    expect(s.active).toBe("b");
    expect(states(s)).toEqual([20]);
    s = edit(s, 21);
    s = S.enter(s, rules, "a", 12, 200);
    expect(states(s)).toEqual([10, 11, 12, 13]);
    expect(S.active(s).cursor).toBe(2);
    expect(H.redoLabel(S.active(s))).toBe("12→13");
  });

  it("undo never crosses into another preset", () => {
    let s = S.open<number>("a", 10, 0);
    s = edit(s, 11);
    s = S.enter(s, rules, "b", 20, 50);
    s = edit(s, 21);
    s = edit(s, 22);
    for (let i = 0; i < 10; i++) s = S.update(s, H.undo(S.active(s)));
    expect(s.active).toBe("b");
    expect(H.current(S.active(s))).toBe(20);
    expect(H.canUndo(S.active(s))).toBe(false);
    // a's stack is untouched
    s = S.enter(s, rules, "a", 11, 99);
    expect(H.current(S.active(s))).toBe(11);
    expect(states(s)).toEqual([10, 11]);
  });

  it("entering a preset whose mapping changed elsewhere adds that change as an entry", () => {
    let s = S.open<number>("a", 10, 0);
    s = edit(s, 11);
    s = S.enter(s, rules, "b", 20, 50);
    s = S.enter(s, rules, "a", 15, 60);
    expect(states(s)).toEqual([10, 11, 15]);
    // unless the caller holds the stack's state as the edit still to save
    s = S.enter(s, rules, "b", 20, 70);
    s = edit(s, 21);
    s = S.enter(s, rules, "a", 15, 80);
    s = S.enter(s, rules, "b", 20, 90, { keep: true });
    expect(H.current(S.active(s))).toBe(21);
  });

  it("entering the active preset again changes nothing", () => {
    let s = S.open<number>("a", 10, 0);
    s = edit(s, 11);
    expect(S.enter(s, rules, "a", 11, 5)).toBe(s);
  });

  it("forget drops a preset's stack: a new, duplicated or imported id starts empty", () => {
    let s = S.open<number>("a", 10, 0);
    s = S.enter(s, rules, "n", 1, 1);
    s = edit(s, 2);
    s = S.enter(s, rules, "a", 10, 3);
    s = S.forget(s, "n");
    expect(s.byId.has("n")).toBe(false);
    s = S.enter(s, rules, "n", 2, 4);
    expect(states(s)).toEqual([2]);
  });

  it("forget on the active preset leaves it a fresh stack on its current state", () => {
    let s = S.open<number>("a", 10, 0);
    s = edit(s, 11);
    s = S.forget(s, "a", 5);
    expect(states(s)).toEqual([11]);
  });

  it("a rename keeps the stack: it is keyed by id", () => {
    let s = S.open<number>("a", 10, 0);
    s = edit(s, 11);
    s = S.retain(s, new Set(["a", "b"]));
    expect(states(s)).toEqual([10, 11]);
  });

  it("retain drops the stacks of presets that are gone", () => {
    let s = S.open<number>("a", 10, 0);
    s = S.enter(s, rules, "b", 20, 1);
    s = S.enter(s, rules, "c", 30, 2);
    s = S.retain(s, new Set(["a", "c"]));
    expect([...s.byId.keys()].sort()).toEqual(["a", "c"]);
  });

  it("keeps only the most recently used stacks, never dropping the active one", () => {
    let s = S.open<number>("a", 10, 0);
    s = edit(s, 11);
    s = S.enter(s, rules, "b", 20, 1);
    s = S.enter(s, rules, "c", 30, 2);
    s = S.enter(s, rules, "a", 11, 3); // a is fresh again: b is now the oldest
    s = S.enter(s, rules, "d", 40, 4);
    expect([...s.byId.keys()].sort()).toEqual(["a", "c", "d"]);
    s = S.enter(s, rules, "a", 11, 5);
    expect(states(s)).toEqual([10, 11]);
    // b was dropped: it comes back empty
    s = S.enter(s, rules, "b", 20, 6);
    expect(states(s)).toEqual([20]);
  });

  it("caps each stack's entries on its own", () => {
    const small = { ...rules, cap: 2 };
    let s = S.open<number>("a", 0, 0);
    for (let v = 1; v <= 5; v++) s = S.update(s, H.push(S.active(s), small, v, { at: v }));
    expect(states(s)).toEqual([3, 4, 5]);
  });

  it("keeps gesture coalescing per preset", () => {
    let s = S.open<number>("a", 0, 0);
    const scrub = (v: number, at: number) =>
      S.update(s, H.push(S.active(s), rules, v, { at, key: "cc", gesture: 1 }));
    s = scrub(1, 10);
    s = scrub(2, 5000);
    s = S.enter(s, rules, "b", 20, 6000);
    s = S.update(s, H.push(S.active(s), rules, 21, { at: 6100, key: "cc", gesture: 1 }));
    expect(states(s)).toEqual([20, 21]);
    s = S.enter(s, rules, "a", 2, 7000);
    // back in a, the same gesture id does not merge into the old entry: a switch closes it
    s = S.update(s, H.push(S.active(s), rules, 3, { at: 7100, key: "cc", gesture: 1 }));
    expect(states(s)).toEqual([0, 2, 3]);
  });
});
