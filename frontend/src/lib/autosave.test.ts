import { describe, expect, it } from "vitest";
import { type AutosaveOptions, createAutosave, type SaveStatus, type Timers } from "./autosave";

/** A clock the test moves by hand. */
function fakeTimers() {
  let now = 0;
  let id = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    set(fn, ms) {
      due.set(++id, { at: now + ms, fn });
      return id;
    },
    clear: (h) => due.delete(h as number),
  };
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...due.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      due.delete(next[0]);
      now = next[1].at;
      next[1].fn();
      await settle();
    }
    now = end;
    await settle();
  };
  return { timers, advance, pending: () => due.size };
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** A backend whose saves the test resolves or rejects one by one. */
function rig(opts: Partial<AutosaveOptions<number>> = {}) {
  const clock = fakeTimers();
  const calls: number[] = [];
  const replies: { ok: () => void; fail: (e: unknown) => void }[] = [];
  const statuses: SaveStatus[] = [];
  let auto = false;
  const a = createAutosave<number>({
    saved: 0,
    save: (v) => {
      calls.push(v);
      if (auto) return Promise.resolve();
      return new Promise((ok, fail) => replies.push({ ok: () => ok(), fail }));
    },
    validate: (v) => (v < 0 ? "must not be negative" : null),
    same: (x, y) => x === y,
    delayMs: 300,
    timers: clock.timers,
    onStatus: (s) => statuses.push(s),
    errorText: (e) => String(e),
    ...opts,
  });
  const reply = async (ok = true, err: unknown = "boom") => {
    const r = replies.shift();
    if (!r) throw new Error("no save in flight");
    if (ok) r.ok();
    else r.fail(err);
    await settle();
  };
  return {
    a,
    clock,
    calls,
    statuses,
    reply,
    kinds: () => statuses.map((s) => s.kind),
    autoReply: () => {
      auto = true;
    },
  };
}

describe("autosave", () => {
  it("saves once, after the edits stop", async () => {
    const r = rig();
    r.a.change(1);
    await r.clock.advance(100);
    r.a.change(12);
    await r.clock.advance(100);
    r.a.change(127);
    await r.clock.advance(299);
    expect(r.calls).toEqual([]);
    expect(r.a.status().kind).toBe("pending");
    await r.clock.advance(1);
    expect(r.calls).toEqual([127]);
    expect(r.a.status().kind).toBe("saving");
    await r.reply();
    expect(r.a.status().kind).toBe("saved");
    expect(r.kinds()).toEqual(["pending", "saving", "saved"]);
  });

  it("does nothing for a change back to what is saved", async () => {
    const r = rig();
    r.a.change(5);
    r.a.change(0);
    await r.clock.advance(1000);
    expect(r.calls).toEqual([]);
    expect(r.a.status().kind).toBe("saved");
  });

  it("holds an invalid config back and saves once it is valid again", async () => {
    const r = rig();
    r.a.change(-1);
    expect(r.a.status()).toEqual({ kind: "invalid", error: "must not be negative" });
    await r.clock.advance(1000);
    expect(r.calls).toEqual([]);
    r.a.change(3);
    await r.clock.advance(300);
    expect(r.calls).toEqual([3]);
  });

  it("an invalid edit cancels the save waiting before it", async () => {
    const r = rig();
    r.a.change(3);
    r.a.change(-3);
    await r.clock.advance(1000);
    expect(r.calls).toEqual([]);
    expect(r.clock.pending()).toBe(0);
  });

  it("keeps a rejected edit, shows the error and retries on the next change", async () => {
    const r = rig();
    r.a.change(9);
    await r.clock.advance(300);
    await r.reply(false, "channel must be 1 to 16");
    expect(r.a.status()).toEqual({ kind: "failed", error: "channel must be 1 to 16" });
    await r.clock.advance(5000);
    expect(r.calls).toEqual([9]);
    r.a.change(10);
    await r.clock.advance(300);
    expect(r.calls).toEqual([9, 10]);
    await r.reply();
    expect(r.a.status().kind).toBe("saved");
  });

  it("a save that throws synchronously is a failure too", async () => {
    const r = rig({
      save: () => {
        throw new Error("gone");
      },
      errorText: (e) => (e as Error).message,
    });
    r.a.change(1);
    await r.clock.advance(300);
    expect(r.a.status()).toEqual({ kind: "failed", error: "gone" });
  });

  it("runs one save at a time and saves what came during it afterwards", async () => {
    const r = rig();
    r.a.change(1);
    await r.clock.advance(300);
    r.a.change(2);
    await r.clock.advance(300); // the timer fires while 1 is still in flight
    expect(r.calls).toEqual([1]);
    expect(r.a.status().kind).toBe("saving");
    await r.reply();
    expect(r.calls).toEqual([1, 2]);
    await r.reply();
    expect(r.a.status().kind).toBe("saved");
  });

  it("waits out the debounce when an edit lands during a save", async () => {
    const r = rig();
    r.a.change(1);
    await r.clock.advance(300);
    r.a.change(2);
    await r.reply();
    expect(r.calls).toEqual([1]);
    expect(r.a.status().kind).toBe("pending");
    await r.clock.advance(300);
    expect(r.calls).toEqual([1, 2]);
  });

  it("does not save again when the edit returns to what is in flight", async () => {
    const r = rig();
    r.a.change(1);
    await r.clock.advance(300);
    r.a.change(2);
    r.a.change(1);
    await r.reply();
    await r.clock.advance(1000);
    expect(r.calls).toEqual([1]);
    expect(r.a.status().kind).toBe("saved");
  });

  describe("flush", () => {
    it("sends a waiting save straight away, synchronously", async () => {
      const r = rig();
      r.autoReply();
      r.a.change(4);
      const done = r.a.flush();
      expect(r.calls).toEqual([4]); // before any await: beforeunload cannot wait
      await done;
      expect(r.a.status().kind).toBe("saved");
      await r.clock.advance(1000);
      expect(r.calls).toEqual([4]);
    });

    it("waits for the save in flight and then the edit after it", async () => {
      const r = rig();
      r.a.change(1);
      await r.clock.advance(300);
      r.a.change(2);
      let done = false;
      const f = r.a.flush().then(() => {
        done = true;
      });
      await r.reply();
      expect(r.calls).toEqual([1, 2]);
      expect(done).toBe(false);
      await r.reply();
      await f;
      expect(done).toBe(true);
    });

    it("does nothing when everything is saved", async () => {
      const r = rig();
      await r.a.flush();
      expect(r.calls).toEqual([]);
    });

    it("never saves an invalid config", async () => {
      const r = rig();
      r.a.change(-1);
      await r.a.flush();
      expect(r.calls).toEqual([]);
    });

    it("retries a failed save once, and stops", async () => {
      const r = rig();
      r.a.change(1);
      await r.clock.advance(300);
      await r.reply(false);
      const f = r.a.flush();
      expect(r.calls).toEqual([1, 1]);
      await r.reply(false);
      await f;
      expect(r.a.status().kind).toBe("failed");
    });
  });

  it("adopt: a value the app saved itself needs no save", async () => {
    const r = rig();
    r.a.change(3); // waiting, then overtaken by what the app saved
    r.a.adopt(7);
    r.a.change(7);
    await r.clock.advance(1000);
    expect(r.calls).toEqual([]);
    expect(r.a.status().kind).toBe("saved");
    r.a.change(0);
    await r.clock.advance(300);
    expect(r.calls).toEqual([0]);
  });

  it("dispose stops a waiting save", async () => {
    const r = rig();
    r.a.change(1);
    r.a.dispose();
    await r.clock.advance(1000);
    expect(r.calls).toEqual([]);
  });
});
