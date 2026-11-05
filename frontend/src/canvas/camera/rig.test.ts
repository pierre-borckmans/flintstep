import { describe, expect, it } from "vitest";
import { contentBounds, toScreen, toWorld } from "./camera";
import { CameraRig } from "./rig";

/** Run a rig's glides to completion. */
function settle(rig: CameraRig): void {
  for (let i = 0; i < 200 && rig.gliding; i++) rig.tick(performance.now() + 10_000);
}

/** A rig framing a 736 x 436 layout centred on the origin in an 800 x 500 canvas: with
 *  its 32 px of padding it fits exactly, at scale 1. */
function viewer(): CameraRig {
  const rig = new CameraRig();
  rig.setView({ w: 800, h: 500 });
  rig.setContent(contentBounds({ x: -368, y: -218, w: 736, h: 436 }));
  return rig;
}

describe("the fitted view", () => {
  it("is the fit scale with the layout's centre in the middle of the canvas", () => {
    const rig = viewer();
    expect(rig.current).toEqual({ x: 400, y: 250, scale: 1 });
    expect(rig.isFitted()).toBe(true);
    expect(rig.minScale).toBe(1);
    expect(rig.maxScale).toBe(4);
  });

  it("stands back below 1 when the layout is bigger than the canvas", () => {
    const rig = new CameraRig();
    rig.setView({ w: 800, h: 500 });
    rig.setContent(contentBounds({ x: -500, y: -200, w: 1000, h: 400 }));
    expect(rig.current.scale).toBeCloseTo(800 / 1064, 3);
  });
});

describe("zoom", () => {
  it("anchors on the cursor and stops at 4x the fitted view", () => {
    const rig = viewer();
    const at = { x: 300, y: 200 };
    const under = toWorld(rig.current, at);
    rig.zoomAt(at, 2.5);
    expect(rig.current.scale).toBe(2.5);
    const back = toScreen(rig.current, under);
    expect(back.x).toBeCloseTo(at.x);
    expect(back.y).toBeCloseTo(at.y);
    rig.zoomAt(at, 40);
    expect(rig.current.scale).toBe(4);
  });

  it("never zooms out past fitted", () => {
    const rig = viewer();
    rig.zoomAt({ x: 10, y: 10 }, 0.3);
    expect(rig.current).toEqual({ x: 400, y: 250, scale: 1 });
  });

  it("glides a mouse notch from where the last one was headed, so notches add up", () => {
    const rig = viewer();
    rig.zoomAt({ x: 400, y: 250 }, 1.2, 140);
    rig.zoomAt({ x: 400, y: 250 }, rig.target.scale * 1.2, 140);
    expect(rig.target.scale).toBeCloseTo(1.44, 3);
    settle(rig);
    expect(rig.current.scale).toBeCloseTo(1.44, 3);
  });
});

describe("pan", () => {
  it("does nothing while fitted: the layout is centred", () => {
    const rig = viewer();
    rig.panBy(120, -60);
    expect(rig.current).toEqual({ x: 400, y: 250, scale: 1 });
  });

  it("is clamped to the padded layout when zoomed", () => {
    const rig = viewer();
    rig.zoomAt({ x: 400, y: 250 }, 2);
    rig.panBy(5000, 5000);
    // the padded box's top-left corner at the room's top-left
    expect(rig.current.x).toBeCloseTo((368 + 32) * 2);
    expect(rig.current.y).toBeCloseTo((218 + 32) * 2);
  });

  it("flings, and the glide lands legal", () => {
    const rig = viewer();
    rig.zoomAt({ x: 400, y: 250 }, 3);
    rig.glideBy(-9000, 0, 340);
    expect(rig.gliding).toBe(true);
    settle(rig);
    expect(rig.current.x).toBeCloseTo(800 - (368 + 32) * 3);
  });
});

describe("fit and the room", () => {
  it("double-click / reset glides back to fitted", () => {
    const rig = viewer();
    rig.zoomAt({ x: 100, y: 100 }, 3);
    expect(rig.isFitted()).toBe(false);
    rig.fit(220);
    expect(rig.isFitted()).toBe(true); // headed there already
    settle(rig);
    expect(rig.current).toEqual({ x: 400, y: 250, scale: 1 });
  });

  it("glides to fit a new layout (a pedal plugged in), whatever the zoom was", () => {
    const rig = viewer();
    rig.zoomAt({ x: 400, y: 250 }, 2);
    rig.setContent(contentBounds({ x: -468, y: -218, w: 936, h: 436 }), 340);
    expect(rig.gliding).toBe(true);
    expect(rig.isFitted()).toBe(true);
    settle(rig);
    expect(rig.current.scale).toBeCloseTo(800 / 1000, 3);
  });

  it("ignores the same box again", () => {
    const rig = viewer();
    rig.zoomAt({ x: 400, y: 250 }, 2);
    rig.setContent(contentBounds({ x: -368, y: -218, w: 736, h: 436 }), 340);
    expect(rig.current.scale).toBe(2);
    expect(rig.gliding).toBe(false);
  });

  it("tells subscribers when it moves, and not when it does not", () => {
    const rig = viewer();
    let n = 0;
    rig.subscribe(() => n++);
    rig.panBy(0, 0);
    expect(n).toBe(0);
    rig.zoomAt({ x: 400, y: 250 }, 2);
    expect(n).toBe(1);
  });
});

describe("a resize is a camera fit", () => {
  it("keeps a fitted view fitted, scaling the same layout", () => {
    const rig = viewer();
    rig.setView({ w: 1000, h: 600 });
    expect(rig.gliding).toBe(false);
    expect(rig.isFitted()).toBe(true);
    // Height binds: 600 / 500 of the padded box.
    expect(rig.current.scale).toBeCloseTo(1.2, 3);
    expect(rig.current.x).toBe(500);
    expect(rig.current.y).toBe(300);
  });

  it("keeps a zoomed view's zoom relative to the fit, on the same world point", () => {
    const rig = viewer();
    rig.zoomAt({ x: 300, y: 200 }, 3);
    const mid = toWorld(rig.current, { x: 400, y: 250 });
    rig.setView({ w: 1000, h: 600 });
    expect(rig.current.scale / rig.minScale).toBeCloseTo(3, 2);
    const now = toWorld(rig.current, { x: 500, y: 300 });
    expect(now.x).toBeCloseTo(mid.x, 0);
    expect(now.y).toBeCloseTo(mid.y, 0);
  });

  it("frames the canvas before the renderer hears about the new size", () => {
    const rig = viewer();
    let seen = 0;
    rig.subscribeView(() => {
      seen = rig.current.x;
    });
    rig.setView({ w: 1000, h: 500 });
    expect(seen).toBe(500);
  });

  it("shrinks the fitted pedal with the canvas, and back", () => {
    const rig = viewer();
    rig.setView({ w: 400, h: 500 });
    expect(rig.current.scale).toBeCloseTo(0.5, 3);
    rig.setView({ w: 800, h: 500 });
    expect(rig.current).toEqual({ x: 400, y: 250, scale: 1 });
  });
});
