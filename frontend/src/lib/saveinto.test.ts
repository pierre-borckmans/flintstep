import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserTimers, createAutosave } from "./autosave";
import { createSaveRouter, type PresetIO } from "./saveinto";

/** Go's preset library in miniature: a value per preset, SaveConfigInto any of them,
 *  SelectPreset, and a log of the calls in order. */
function fakeGo(presets: Record<string, number>, active: string) {
  const values = { ...presets };
  const calls: string[] = [];
  const io: PresetIO<number> = {
    saveInto: async (id, v) => {
      calls.push(`SaveConfigInto ${id} ${v}`);
      values[id] = v;
    },
  };
  return {
    io,
    values,
    calls,
    active: () => active,
    /** SelectPreset, called from the window. */
    select: async (id: string) => {
      calls.push(`SelectPreset ${id}`);
      active = id;
    },
    /** The menu-bar menu: Go switches on its own. */
    menu: (id: string) => {
      active = id;
    },
  };
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe("save router", () => {
  it("saves into the preset it is tagged with", async () => {
    const go = fakeGo({ a: 0, b: 0 }, "b");
    const r = createSaveRouter(go.io);
    await r.saveInto("a", 5);
    expect(go.values).toEqual({ a: 5, b: 0 });
    expect(go.active()).toBe("b");
    expect(go.calls).toEqual(["SaveConfigInto a 5"]);
  });

  it("passes a refused save on", async () => {
    const go = fakeGo({ a: 0 }, "a");
    go.io.saveInto = async () => {
      throw new Error("invalid");
    };
    const r = createSaveRouter(go.io);
    await expect(r.saveInto("a", 5)).rejects.toThrow("invalid");
  });

  it("runs one task at a time, saves and other calls alike", async () => {
    const go = fakeGo({ a: 0, b: 0 }, "a");
    const r = createSaveRouter(go.io);
    const order: string[] = [];
    let release!: () => void;
    const slow = r.run(
      () =>
        new Promise<void>((ok) => {
          order.push("slow start");
          release = () => {
            order.push("slow end");
            ok();
          };
        }),
    );
    const save = r.saveInto("a", 1).then(() => order.push("save"));
    await settle();
    expect(r.busy()).toBe(true);
    expect(order).toEqual(["slow start"]);
    release();
    await slow;
    await save;
    expect(order).toEqual(["slow start", "slow end", "save"]);
    await r.idle();
    expect(r.busy()).toBe(false);
  });

  it("a failed task does not stop the next", async () => {
    const go = fakeGo({ a: 0 }, "a");
    const r = createSaveRouter(go.io);
    await expect(r.run(() => Promise.reject(new Error("x")))).rejects.toThrow("x");
    await r.saveInto("a", 2);
    expect(go.values.a).toBe(2);
  });
});

describe("autosave tagged with its preset", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const autosaveFor = (r: ReturnType<typeof createSaveRouter<number>>, preset: string) =>
    createAutosave<number>({
      saved: 0,
      save: (v) => r.saveInto(preset, v),
      validate: () => null,
      same: (x, y) => x === y,
      delayMs: 300,
      timers: browserTimers,
      onStatus: () => {},
      errorText: String,
    });

  it("a pending edit from A saves into A when B became active 100 ms after the edit", async () => {
    const go = fakeGo({ a: 0, b: 0 }, "a");
    const r = createSaveRouter(go.io);
    const a = autosaveFor(r, "a");
    a.change(7);
    await vi.advanceTimersByTimeAsync(100);
    go.menu("b"); // the menu-bar switch, 100 ms after the edit
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(go.values).toEqual({ a: 7, b: 0 });
    expect(go.active()).toBe("b");
    expect(go.calls).toEqual(["SaveConfigInto a 7"]);
    expect(go.calls.some((c) => c.startsWith("SelectPreset"))).toBe(false);
    expect(a.status().kind).toBe("saved");
  });

  it("edits in A then in B each land in their own preset", async () => {
    const go = fakeGo({ a: 0, b: 0 }, "a");
    const r = createSaveRouter(go.io);
    const a = autosaveFor(r, "a");
    const b = autosaveFor(r, "b");
    a.change(3);
    go.menu("b");
    b.change(9);
    await vi.advanceTimersByTimeAsync(400);
    await r.idle();
    expect(go.values).toEqual({ a: 3, b: 9 });
    expect(go.active()).toBe("b");
  });

  it("a flush before a switch from the window saves into A first", async () => {
    const go = fakeGo({ a: 0, b: 0 }, "a");
    const r = createSaveRouter(go.io);
    const a = autosaveFor(r, "a");
    a.change(4);
    await a.flush();
    await r.run(() => go.select("b"));
    expect(go.values).toEqual({ a: 4, b: 0 });
    expect(go.calls).toEqual(["SaveConfigInto a 4", "SelectPreset b"]);
  });
});
