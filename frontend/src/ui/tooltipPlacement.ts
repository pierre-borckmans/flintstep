// WHERE A TOOLTIP GOES. Pure maths, so it can be tested without a DOM: given the
// trigger's box, the chip's size and the window's, pick a side and a position that keeps
// the whole chip on screen. The window can be as small as 780x560, and a chip near an
// edge has to shift along it or flip to the other side rather than be cut off.

export type Side = "top" | "bottom";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface PlaceInput {
  /** The trigger, in viewport coordinates. */
  anchor: Box;
  /** The chip's laid-out size. */
  tip: Size;
  viewport: Size;
  /** The side to use when it fits. Above by default. */
  prefer?: Side;
  /** Between the trigger and the chip. */
  gap?: number;
  /** The closest the chip may come to the window's edge. */
  margin?: number;
  /** The closest the arrow's centre may come to the chip's own ends. */
  arrowInset?: number;
}

export interface Placement {
  side: Side;
  /** The chip's top-left corner. */
  x: number;
  y: number;
  /** The arrow's centre, from the chip's left edge. */
  arrowX: number;
}

export const GAP = 8;
export const MARGIN = 6;
export const ARROW_INSET = 10;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

export function placeTooltip({
  anchor,
  tip,
  viewport,
  prefer = "top",
  gap = GAP,
  margin = MARGIN,
  arrowInset = ARROW_INSET,
}: PlaceInput): Placement {
  const need = tip.height + gap;
  const room: Record<Side, number> = {
    top: anchor.y - margin,
    bottom: viewport.height - (anchor.y + anchor.height) - margin,
  };
  const other: Side = prefer === "top" ? "bottom" : "top";
  // The preferred side if it fits, else the other if that fits, else whichever has more.
  const side =
    room[prefer] >= need
      ? prefer
      : room[other] >= need
        ? other
        : room[prefer] >= room[other]
          ? prefer
          : other;

  let y = side === "top" ? anchor.y - gap - tip.height : anchor.y + anchor.height + gap;
  // Neither side fits: keep it inside the window, over the trigger if it has to be.
  y = clamp(y, margin, Math.max(margin, viewport.height - margin - tip.height));

  const centre = anchor.x + anchor.width / 2;
  const x = clamp(
    centre - tip.width / 2,
    margin,
    Math.max(margin, viewport.width - margin - tip.width),
  );
  // The arrow points at the trigger's centre, but never past the chip's rounded ends.
  const arrowX = clamp(centre - x, arrowInset, Math.max(arrowInset, tip.width - arrowInset));

  return { side, x: Math.round(x), y: Math.round(y), arrowX: Math.round(arrowX) };
}
