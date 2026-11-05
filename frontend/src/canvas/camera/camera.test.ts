import { describe, expect, it } from "vitest";
import {
  type Camera,
  centerCamera,
  clampCamera,
  clampScale,
  contentBounds,
  fitScale,
  MAX_ZOOM,
  panBy,
  toScreen,
  toWorld,
  wheelFactor,
  wheelPixels,
  zoomAt,
} from "./camera";

const cam: Camera = { x: 120, y: -40, scale: 1.7 };

describe("screen ↔ world", () => {
  it("round-trips both ways", () => {
    const p = { x: 333, y: 87 };
    const back = toScreen(cam, toWorld(cam, p));
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });

  it("puts world (0,0) at the translation", () =>
    expect(toScreen(cam, { x: 0, y: 0 })).toEqual({ x: 120, y: -40 }));
});

describe("zoomAt", () => {
  it("keeps the point under the pointer still", () => {
    const p = { x: 230, y: 170 };
    const under = toWorld(cam, p);
    const z = zoomAt(cam, p, 3);
    const at = toScreen(z, under);
    expect(z.scale).toBe(3);
    expect(at.x).toBeCloseTo(p.x);
    expect(at.y).toBeCloseTo(p.y);
  });

  it("still anchors when the requested scale is clamped away", () => {
    const p = { x: 50, y: 60 };
    const under = toWorld(cam, p);
    const z = zoomAt(cam, p, 99, 1, 4);
    expect(z.scale).toBe(4);
    expect(toScreen(z, under).x).toBeCloseTo(p.x);
  });

  it("stays within the limits", () => {
    expect(zoomAt(cam, { x: 0, y: 0 }, 0.2, 1, 4).scale).toBe(1);
    expect(zoomAt(cam, { x: 0, y: 0 }, 10).scale).toBe(MAX_ZOOM);
  });
});

describe("clampScale", () => {
  it("snaps float dust so a long gesture can still land on exactly 1", () => {
    expect(clampScale(0.9999999999998, 0.5)).toBe(1);
  });
});

describe("pan", () => {
  it("moves by exactly the screen delta and never touches the scale", () =>
    expect(panBy({ scale: 2, x: 1, y: 2 }, 10, -5)).toEqual({ scale: 2, x: 11, y: -3 }));
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

  it("is symmetric: in by n and out by n is where you started", () => {
    const k =
      wheelFactor({ deltaY: -40, deltaMode: 0, ctrlKey: false }) *
      wheelFactor({ deltaY: 40, deltaMode: 0, ctrlKey: false });
    expect(k).toBeCloseTo(1, 10);
  });
});

describe("clampCamera", () => {
  const view = { w: 800, h: 500 };
  const content = contentBounds({ x: -300, y: -200, w: 600, h: 400 });

  it("centres content that fits, wherever the camera was", () => {
    const c = clampCamera({ scale: 1, x: 999, y: -999 }, view, content);
    expect(c).toEqual({ scale: 1, x: 400, y: 250 });
  });

  it("keeps the view inside content that overflows", () => {
    // 664 x 464 padded, at 2x: 1328 x 928 against 800 x 500
    const far = clampCamera({ scale: 2, x: 5000, y: 5000 }, view, content);
    expect(far.x + content.x * 2).toBe(0);
    expect(far.y + content.y * 2).toBe(0);
    const near = clampCamera({ scale: 2, x: -5000, y: -5000 }, view, content);
    expect(near.x + (content.x + content.w) * 2).toBe(view.w);
    expect(near.y + (content.y + content.h) * 2).toBe(view.h);
  });

  it("leaves an in-bounds camera exactly where it is, and is idempotent", () => {
    const c = { scale: 2, x: 380, y: 260 };
    expect(clampCamera(c, view, content)).toEqual(c);
    const once = clampCamera({ scale: 3, x: 12, y: 9000 }, view, content);
    expect(clampCamera(once, view, content)).toEqual(once);
  });
});

describe("fit", () => {
  it("frames the whole content, smaller axis wins, centred", () => {
    const view = { w: 800, h: 500 };
    const content = { x: -500, y: -100, w: 1000, h: 200 };
    const s = fitScale(view, content);
    expect(s).toBeCloseTo(0.8, 3);
    const c = centerCamera(view, content, s);
    expect(toScreen(c, { x: 0, y: 0 })).toEqual({ x: 400, y: 250 });
  });
});
