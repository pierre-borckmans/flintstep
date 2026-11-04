import { describe, expect, it } from "vitest";
import { hasOwnUndo, historyKey } from "./shortcuts";

type Mods = { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean };
const key = (key: string, m: Mods = {}) =>
  historyKey({
    key,
    metaKey: !!m.meta,
    ctrlKey: !!m.ctrl,
    shiftKey: !!m.shift,
    altKey: !!m.alt,
  });

describe("historyKey", () => {
  it("reads undo and redo", () => {
    expect(key("z", { meta: true })).toBe("undo");
    expect(key("Z", { meta: true, shift: true })).toBe("redo");
    expect(key("y", { meta: true })).toBe("redo");
    expect(key("z", { ctrl: true })).toBe("undo");
  });
  it("ignores everything else", () => {
    expect(key("z")).toBeNull();
    expect(key("z", { shift: true })).toBeNull();
    expect(key("z", { meta: true, alt: true })).toBeNull();
    expect(key("s", { meta: true })).toBeNull();
    expect(key("y", { meta: true, shift: true })).toBeNull();
  });
});

describe("hasOwnUndo", () => {
  it("is true where text is typed", () => {
    expect(hasOwnUndo({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(hasOwnUndo({ tagName: "input" })).toBe(true);
    expect(hasOwnUndo({ tagName: "INPUT", type: "number" })).toBe(true);
    expect(hasOwnUndo({ tagName: "TEXTAREA" })).toBe(true);
    expect(hasOwnUndo({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });
  it("is false for controls without text", () => {
    expect(hasOwnUndo(null)).toBe(false);
    expect(hasOwnUndo({ tagName: "BUTTON" })).toBe(false);
    expect(hasOwnUndo({ tagName: "INPUT", type: "range" })).toBe(false);
    expect(hasOwnUndo({ tagName: "INPUT", type: "color" })).toBe(false);
    expect(hasOwnUndo({ tagName: "SELECT" })).toBe(false);
    expect(hasOwnUndo({ tagName: "BODY" })).toBe(false);
  });
});
