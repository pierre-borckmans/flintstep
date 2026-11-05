import { describe, expect, it } from "vitest";
import { type Calm, calmStart, HOLD_MS, SHOW_AFTER_MS, type Shown, settle } from "./savestatus";

/** Feeds actual states at times and returns what shows after each, following wake-ups
 *  the way the hook's timer would. */
function run(events: [number, Shown][], until: number): [number, Shown][] {
  let c: Calm = calmStart;
  let actual: Shown = "saved";
  let wake: number | null = null;
  const out: [number, Shown][] = [];
  const ev = [...events];
  for (let t = 0; t <= until; t++) {
    let touched = false;
    while (ev.length && ev[0][0] === t) {
      actual = ev.shift()![1];
      touched = true;
    }
    if (touched || wake === t) {
      const r = settle(c, actual, t);
      if (r.calm.shown !== c.shown) out.push([t, r.calm.shown]);
      c = r.calm;
      wake = r.wakeIn === null ? null : t + r.wakeIn;
    }
  }
  return out;
}

describe("settle", () => {
  it("never shows Saving for a quick save", () => {
    expect(
      run(
        [
          [0, "saving"],
          [100, "saved"],
        ],
        1000,
      ),
    ).toEqual([]);
  });
  it("shows Saving after a moment and holds it", () => {
    expect(
      run(
        [
          [0, "saving"],
          [160, "saved"],
        ],
        1000,
      ),
    ).toEqual([
      [SHOW_AFTER_MS, "saving"],
      [SHOW_AFTER_MS + HOLD_MS, "saved"],
    ]);
  });
  it("keeps Saving through a long save", () => {
    expect(
      run(
        [
          [0, "saving"],
          [900, "saved"],
        ],
        1500,
      ),
    ).toEqual([
      [SHOW_AFTER_MS, "saving"],
      [900, "saved"],
    ]);
  });
  it("shows a fault at once, and clears it when saved", () => {
    expect(
      run(
        [
          [10, "fault"],
          [500, "saved"],
        ],
        1000,
      ),
    ).toEqual([
      [10, "fault"],
      [500, "saved"],
    ]);
  });
  it("does not flicker through a burst of short saves", () => {
    const burst: [number, Shown][] = [];
    for (let t = 0; t < 600; t += 60) burst.push([t, "saving"], [t + 30, "saved"]);
    expect(run(burst, 1500)).toEqual([]);
  });
});
