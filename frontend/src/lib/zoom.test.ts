import { describe, expect, it } from "vitest";
import {
  clampView,
  FITTED,
  isFitted,
  panBy,
  viewAt,
  wheelFactor,
  wheelPixels,
  ZOOM,
  zoomAt,
} from "./zoom";

const content = { x0: 100, y0: 50, x1: 700, y1: 450 };
const screen = (v: { s: number; x: number; y: number }, q: { x: number; y: number }) => ({
  x: v.x + v.s * q.x,
  y: v.y + v.s * q.y,
});

describe("zoomAt", () => {
  it("keeps the point under the pointer still", () => {
    const p = { x: 230, y: 170 };
    const v = zoomAt(FITTED, p, 2);
    expect(v.s).toBe(2);
    // the stage point that was under p (p itself at fitted) is still there
    expect(screen(v, p)).toEqual(p);
    const w = zoomAt(v, { x: 400, y: 300 }, 1.5);
    const q = { x: (400 - v.x) / v.s, y: (300 - v.y) / v.s };
    const at = screen(w, q);
    expect(at.x).toBeCloseTo(400);
    expect(at.y).toBeCloseTo(300);
  });

  it("stays within the limits", () => {
    expect(zoomAt(FITTED, { x: 0, y: 0 }, 0.5).s).toBe(ZOOM.min);
    expect(zoomAt({ s: 3, x: 0, y: 0 }, { x: 0, y: 0 }, 10).s).toBe(ZOOM.max);
  });
});

describe("clampView", () => {
  it("pins the fitted view to no translation", () => {
    expect(clampView({ s: 1, x: 40, y: -9 }, content)).toEqual(FITTED);
    expect(clampView({ s: 1.0005, x: 40, y: -9 }, content)).toEqual(FITTED);
  });

  it("keeps the zoomed pedal covering its fitted place", () => {
    // dragged far right and down: the pedal's left/top edge stops at the fitted edge
    const v = clampView({ s: 2, x: 5000, y: 5000 }, content);
    expect(v.x + 2 * content.x0).toBe(content.x0);
    expect(v.y + 2 * content.y0).toBe(content.y0);
    // dragged far left and up: the right/bottom edge stops at the fitted edge
    const w = clampView({ s: 2, x: -5000, y: -5000 }, content);
    expect(w.x + 2 * content.x1).toBe(content.x1);
    expect(w.y + 2 * content.y1).toBe(content.y1);
  });

  it("leaves a view inside the bounds alone", () => {
    const v = { s: 2, x: -300, y: -200 };
    expect(clampView(v, content)).toEqual(v);
  });
});

describe("wheel", () => {
  it("turns lines and pages into pixels, capped", () => {
    expect(wheelPixels({ deltaY: 3, deltaMode: 1 })).toBe(48);
    expect(wheelPixels({ deltaY: 1, deltaMode: 2 })).toBe(120);
    expect(wheelPixels({ deltaY: -500, deltaMode: 0 })).toBe(-120);
    expect(wheelPixels({ deltaY: 4, deltaMode: 0 })).toBe(4);
  });

  it("zooms in on scroll up, about 1.2x per mouse notch", () => {
    const notch = wheelFactor({ deltaY: -100, deltaMode: 0, ctrlKey: false });
    expect(notch).toBeGreaterThan(1.15);
    expect(notch).toBeLessThan(1.25);
    expect(wheelFactor({ deltaY: 100, deltaMode: 0, ctrlKey: false })).toBeLessThan(1);
  });

  it("makes a pinch steeper than a scroll of the same size", () => {
    const pinch = wheelFactor({ deltaY: -5, deltaMode: 0, ctrlKey: true });
    const scroll = wheelFactor({ deltaY: -5, deltaMode: 0, ctrlKey: false });
    expect(pinch).toBeGreaterThan(scroll);
    expect(pinch).toBeCloseTo(Math.exp(0.05));
  });
});

describe("viewAt and panBy", () => {
  it("centres the requested point of the pedal", () => {
    const size = { w: 800, h: 500 };
    const v = viewAt(2, 0.5, 0.5, content, size);
    expect(screen(v, { x: 400, y: 250 })).toEqual({ x: 400, y: 250 });
    expect(isFitted(viewAt(0.5, 0.5, 0.5, content, size))).toBe(true);
  });

  it("clamps a point near the edge", () => {
    const v = viewAt(2, 0, 0, content, { w: 800, h: 500 });
    expect(v.x + 2 * content.x0).toBe(content.x0);
  });

  it("pans by a screen delta", () =>
    expect(panBy({ s: 2, x: 1, y: 2 }, 10, -5)).toEqual({ s: 2, x: 11, y: -3 }));
});
