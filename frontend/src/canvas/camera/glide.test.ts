import { describe, expect, it } from "vitest";
import type { Camera } from "./camera";
import { easeOutCubic, type Glide, glideAt, makeGlide, velocityAt } from "./glide";

const A: Camera = { x: 0, y: 0, scale: 1 };
const B: Camera = { x: 100, y: -50, scale: 0.5 };
const g = (ms = 300, start = 1000): Glide => makeGlide(A, B, ms, start);

describe("glideAt", () => {
  it("is at the start when it starts and at the end when it ends", () => {
    expect(glideAt(g(), 1000).cam).toEqual(A);
    expect(glideAt(g(), 1300)).toEqual({ cam: B, done: true });
  });

  it("clamps at both ends, so a dropped frame cannot overshoot", () => {
    // Read late — the answer is the destination, not something past it.
    expect(glideAt(g(), 9999)).toEqual({ cam: B, done: true });
    // Read early — the first frame, not an extrapolation backwards.
    expect(glideAt(g(), 0).cam).toEqual(A);
  });

  it("moves every axis together, which is what makes it one movement", () => {
    // The DOM version's worst bug was two properties animating as two travels. Here they
    // are one interpolation, so their progress cannot diverge.
    const { cam } = glideAt(g(), 1150);
    const px = (cam.x - A.x) / (B.x - A.x);
    const py = (cam.y - A.y) / (B.y - A.y);
    const ps = (cam.scale - A.scale) / (B.scale - A.scale);
    expect(py).toBeCloseTo(px, 12);
    expect(ps).toBeCloseTo(px, 12);
  });

  it("eases out: past halfway by the time it is halfway through", () => {
    const { cam } = glideAt(g(), 1150);
    expect((cam.x - A.x) / (B.x - A.x)).toBeGreaterThan(0.5);
  });

  it("is monotonic — it never backs up", () => {
    let prev = -Infinity;
    for (let t = 1000; t <= 1300; t += 10) {
      const x = glideAt(g(), t).cam.x;
      expect(x).toBeGreaterThanOrEqual(prev);
      prev = x;
    }
  });

  it("a zero-length glide is already done, which is how you say 'go there now'", () => {
    expect(glideAt(g(0), 1000)).toEqual({ cam: B, done: true });
    expect(glideAt({ ...g(), ms: -1 }, 1000)).toEqual({ cam: B, done: true });
  });
});

describe("interruption", () => {
  it("a fresh glide is still exactly easeOutCubic", () => {
    // The Hermite has to reproduce the old curve when there is no history, or every
    // uninterrupted movement in the app would quietly change feel.
    for (const at of [1030, 1075, 1150, 1220, 1290]) {
      const t = (at - 1000) / 300;
      expect(glideAt(g(), at).cam.x).toBeCloseTo(easeOutCubic(t) * B.x, 9);
    }
  });

  it("carries the speed it was travelling at", () => {
    const first = g();
    const cut = 1200;
    const v = velocityAt(first, cut);
    const here = glideAt(first, cut).cam;
    const next = makeGlide(here, { x: 220, y: 0, scale: 0.5 }, 300, cut, v);
    // One frame either side of the join, at 60fps. A restart would show up as a step
    // change in speed here; this is what "no lurch" means as a number.
    const before = (glideAt(first, cut).cam.x - glideAt(first, cut - 16).cam.x) / 16;
    const after = (glideAt(next, cut + 16).cam.x - glideAt(next, cut).cam.x) / 16;
    expect(after).toBeCloseTo(before, 1);
  });

  it("without the carry it would lurch, which is the thing being fixed", () => {
    const first = g();
    const cut = 1280; // nearly landed, so it is crawling
    const here = glideAt(first, cut).cam;
    const restarted = makeGlide(here, { x: 120, y: -50, scale: 0.5 }, 300, cut);
    const crawling = (glideAt(first, cut).cam.x - glideAt(first, cut - 16).cam.x) / 16;
    const sprinting = (glideAt(restarted, cut + 16).cam.x - here.x) / 16;
    expect(sprinting).toBeGreaterThan(crawling * 3);
  });

  it("still lands on time and at rest", () => {
    const cut = 1100;
    const v = velocityAt(g(), cut);
    const next = makeGlide(glideAt(g(), cut).cam, B, 300, cut, v);
    expect(glideAt(next, cut + 300)).toEqual({ cam: B, done: true });
    expect(velocityAt(next, cut + 300)).toEqual({ x: 0, y: 0, scale: 0 });
  });
});

describe("easeOutCubic", () => {
  it("spans 0 to 1 and leaves fast", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.25)).toBeGreaterThan(0.5);
  });
});
