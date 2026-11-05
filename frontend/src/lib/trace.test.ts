import { describe, expect, it } from "vitest";
import {
  clearRing,
  createRing,
  eachSample,
  lastSample,
  pushSample,
  tracePoints,
  windowed,
} from "./trace";

const all = (r: ReturnType<typeof createRing>) => {
  const out: [number, number][] = [];
  eachSample(r, (t, v) => out.push([t, v]));
  return out;
};

describe("ring buffer", () => {
  it("keeps samples oldest first until full, then overwrites the oldest", () => {
    const r = createRing(3);
    expect(lastSample(r)).toBeNull();
    pushSample(r, 1, 10);
    pushSample(r, 2, 20);
    expect(all(r)).toEqual([
      [1, 10],
      [2, 20],
    ]);
    pushSample(r, 3, 30);
    pushSample(r, 4, 40);
    pushSample(r, 5, 50);
    expect(r.size).toBe(3);
    expect(all(r)).toEqual([
      [3, 30],
      [4, 40],
      [5, 50],
    ]);
    expect(lastSample(r)).toEqual({ t: 5, v: 50 });
  });

  it("drops a sample older than the newest", () => {
    const r = createRing(4);
    pushSample(r, 10, 1);
    pushSample(r, 5, 2);
    pushSample(r, 10, 3); // the same time is fine
    expect(all(r)).toEqual([
      [10, 1],
      [10, 3],
    ]);
  });

  it("clears", () => {
    const r = createRing(2);
    pushSample(r, 1, 1);
    clearRing(r);
    expect(r.size).toBe(0);
    expect(lastSample(r)).toBeNull();
  });
});

describe("windowed", () => {
  it("enters from the left edge and carries the last value to now", () => {
    const r = createRing(8);
    pushSample(r, 0, 100); // before the window
    pushSample(r, 500, 200);
    pushSample(r, 9000, 300);
    pushSample(r, 9500, 400);
    expect(windowed(r, 10_000, 8000)).toEqual([
      [2000, 200],
      [9000, 300],
      [9500, 400],
      [10_000, 400],
    ]);
  });

  it("is a flat line for a pedal at rest", () => {
    const r = createRing(8);
    pushSample(r, 0, 1234);
    expect(windowed(r, 20_000, 8000)).toEqual([
      [12_000, 1234],
      [20_000, 1234],
    ]);
  });

  it("is empty with no samples", () => {
    expect(windowed(createRing(4), 1000)).toEqual([]);
  });
});

describe("tracePoints", () => {
  it("maps time across and value up, clamped to the box", () => {
    const pts = tracePoints(
      [
        [2000, 0],
        [6000, 50],
        [10_000, 200],
      ],
      10_000,
      80,
      40,
      0,
      100,
      8000,
    );
    expect(pts).toEqual([
      [0, 40],
      [40, 20],
      [80, 0],
    ]);
  });
});
