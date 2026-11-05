import { describe, expect, it } from "vitest";
import { contentBounds, toScreen, toWorld } from "./camera";
import { CameraRig } from "./rig";

/** Run a rig's glides to completion. */
function settle(rig: CameraRig): void {
  for (let i = 0; i < 200 && rig.gliding; i++) rig.tick(performance.now() + 10_000);
}

/** A rig framing a fitted layout: 700 x 400 centred on the origin, in an 800 x 500 room
 *  (the viewer's 64 px of room round it plus a little slack). */
function viewer(): CameraRig {
  const rig = new CameraRig();
  rig.setView({ w: 800, h: 500 });
  rig.setContent(contentBounds({ x: -350, y: -200, w: 700, h: 400 }));
  return rig;
}

describe("the fitted view", () => {
  it("is scale 1 with the layout's centre in the middle of the room", () => {
    const rig = viewer();
    expect(rig.current).toEqual({ x: 400, y: 250, scale: 1 });
    expect(rig.isFitted()).toBe(true);
    expect(rig.minScale).toBe(1);
    expect(rig.maxScale).toBe(4);
  });

  it("stands back below 1 when the layout does not fit (a mid-spring box)", () => {
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
    expect(rig.current.x).toBeCloseTo((350 + 32) * 2);
    expect(rig.current.y).toBeCloseTo((200 + 32) * 2);
  });

  it("flings, and the glide lands legal", () => {
    const rig = viewer();
    rig.zoomAt({ x: 400, y: 250 }, 3);
    rig.glideBy(-9000, 0, 340);
    expect(rig.gliding).toBe(true);
    settle(rig);
    expect(rig.current.x).toBeCloseTo(800 - (350 + 32) * 3);
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

  it("a new canvas size is a new world: back to fitted, at once", () => {
    const rig = viewer();
    rig.zoomAt({ x: 100, y: 100 }, 3);
    rig.setView({ w: 1000, h: 600 });
    expect(rig.gliding).toBe(false);
    expect(rig.current).toEqual({ x: 500, y: 300, scale: 1 });
  });

  it("frames the first content outright and keeps the camera the user's after that", () => {
    const rig = viewer();
    rig.zoomAt({ x: 400, y: 250 }, 2);
    rig.setContent(contentBounds({ x: -360, y: -210, w: 720, h: 420 }));
    expect(rig.current.scale).toBe(2);
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
