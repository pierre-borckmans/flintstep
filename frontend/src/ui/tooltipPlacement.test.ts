import { describe, expect, it } from "vitest";
import { placeTooltip } from "./tooltipPlacement";

const viewport = { width: 780, height: 560 };
const tip = { width: 120, height: 28 };

describe("placeTooltip", () => {
  it("sits centred above the trigger when there is room", () => {
    const p = placeTooltip({ anchor: { x: 300, y: 300, width: 40, height: 20 }, tip, viewport });
    expect(p).toEqual({ side: "top", x: 260, y: 264, arrowX: 60 });
  });

  it("flips below when the top of the window is too close", () => {
    const p = placeTooltip({ anchor: { x: 300, y: 20, width: 40, height: 20 }, tip, viewport });
    expect(p.side).toBe("bottom");
    expect(p.y).toBe(48);
  });

  it("goes below when asked to (the header) and flips above at the bottom edge", () => {
    const below = placeTooltip({
      anchor: { x: 300, y: 14, width: 30, height: 28 },
      tip,
      viewport,
      prefer: "bottom",
    });
    expect(below).toMatchObject({ side: "bottom", y: 50 });
    const flipped = placeTooltip({
      anchor: { x: 300, y: 530, width: 30, height: 20 },
      tip,
      viewport,
      prefer: "bottom",
    });
    expect(flipped).toMatchObject({ side: "top", y: 494 });
  });

  it("shifts along the edge instead of running off it, and the arrow still points home", () => {
    const right = placeTooltip({
      anchor: { x: 740, y: 300, width: 16, height: 16 },
      tip,
      viewport,
    });
    expect(right.x).toBe(780 - 6 - 120);
    expect(right.arrowX).toBe(748 - right.x);
    const left = placeTooltip({ anchor: { x: 0, y: 300, width: 10, height: 16 }, tip, viewport });
    expect(left.x).toBe(6);
    // The trigger's centre (5) is left of the chip: the arrow stops at its inset.
    expect(left.arrowX).toBe(10);
  });

  it("keeps a chip taller than either side inside the window", () => {
    const tall = { width: 200, height: 300 };
    const p = placeTooltip({
      anchor: { x: 300, y: 280, width: 40, height: 40 },
      tip: tall,
      viewport,
    });
    // 274 px above, 234 below: neither fits, so the roomier preferred side, clamped.
    expect(p.side).toBe("top");
    expect(p.y).toBeGreaterThanOrEqual(6);
    expect(p.y + tall.height).toBeLessThanOrEqual(560 - 6);
  });

  it("picks the roomier side when neither fits", () => {
    const tall = { width: 200, height: 300 };
    const p = placeTooltip({
      anchor: { x: 300, y: 150, width: 40, height: 40 },
      tip: tall,
      viewport,
    });
    // 144 px above, 364 below.
    expect(p).toMatchObject({ side: "bottom", y: 198 });
  });

  it("pins a chip wider than the window to the left margin", () => {
    const p = placeTooltip({
      anchor: { x: 100, y: 300, width: 20, height: 20 },
      tip: { width: 900, height: 28 },
      viewport,
    });
    expect(p.x).toBe(6);
  });
});
