import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserTimers, createAutosave } from "./autosave";
import { createSaveRouter, type PresetIO } from "./saveinto";

/** Go's preset library in miniature: a value per preset, SaveConfig into the active
 *  one, and a log of the calls in order. */
function fakeGo(presets: Record<string, number>, active: string) {
  const values = { ...presets };
  const calls: string[] = [];
  const io: PresetIO<number> = {
    active: async () => active,
    select: async (id) => {
      calls.push(`select ${id}`);
      active = id;
    },
    save: async (v) => {
      calls.push(`save ${v} into ${active}`);
      values[active] = v;
    },
  };
  return {
    io,
    values,
    calls,
    active: () => active,
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
  it("saves straight into the preset when Go runs it", async () => {
    const go = fakeGo({ a: 0, b: 0 }, "a");
    const r = createSaveRouter(go.io);
    await r.saveInto("a", 5);
    expect(go.values).toEqual({ a: 5, b: 0 });
    expect(go.calls).toEqual(["save 5 into a"]);
  });

  it("saves an edit into its own preset after Go switched, then goes back", async () => {
    const go = fakeGo({ a: 0, b: 0 }, "a");
    const r = createSaveRouter(go.io);
    go.menu("b");
    await r.saveInto("a", 5);
    expect(go.values).toEqual({ a: 5, b: 0 });
    expect(go.active()).toBe("b");
    expect(go.calls).toEqual(["select a", "save 5 into a", "select b"]);
  });

  it("goes back to the running preset even when the save fails", async () => {
    const go = fakeGo({ a: 0, b: 0 }, "b");
    go.io.save = async () => {
      throw new Error("invalid");
    };
    const r = createSaveRouter(go.io);
    await expect(r.saveInto("a", 5)).rejects.toThrow("invalid");
    expect(go.active()).toBe("b");
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

  it("a pending edit from A saves into A when Go switches to B before the delay ends", async () => {
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

  it("a flush before the switch saves into A without leaving it", async () => {
    const go = fakeGo({ a: 0, b: 0 }, "a");
    const r = createSaveRouter(go.io);
    const a = autosaveFor(r, "a");
    a.change(4);
    await a.flush();
    await r.run(() => go.io.select("b"));
    expect(go.values).toEqual({ a: 4, b: 0 });
    expect(go.calls).toEqual(["save 4 into a", "select b"]);
  });
});
