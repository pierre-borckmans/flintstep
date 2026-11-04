// SCRUB FIELDS. A number you drag: the maths of turning pointer travel, keys and typed
// text into a value, kept here so it is tested without React.

/** A scrub in progress, passed along with each value it produces: every step of one
 *  drag shares `id`, and the last carries `done`. The bridge keeps the whole drag in one
 *  history entry and saves once, at the end. */
export interface Gesture {
  id: number;
  done: boolean;
}

let lastGesture = 0;
export const nextGesture = () => ++lastGesture;

export interface Range {
  min: number;
  max: number;
  /** Default 1. */
  step?: number;
}

export interface Mods {
  /** Shift: one step per 12 px instead of 4. */
  fine?: boolean;
  /** Alt/Option: ten steps at a time. */
  coarse?: boolean;
}

/** Pointer travel per step, in CSS px. */
export const PX_PER_STEP = 4;
export const FINE_PX_PER_STEP = 12;
/** Movement under this many px is a click, not a drag. */
export const SCRUB_THRESHOLD = 3;

/** Rounds to the range's step (counted from min) and clamps into it. */
export function clampStep(v: number, r: Range): number {
  const step = r.step ?? 1;
  const snapped = r.min + Math.round((v - r.min) / step) * step;
  // tidy float noise from fractional steps
  const tidy = Math.round(snapped * 1e6) / 1e6;
  return Math.min(r.max, Math.max(r.min, tidy));
}

/** Whole steps in `px` of travel (right or up is positive), toward zero. */
export function stepsFor(px: number, mods: Mods = {}): number {
  const per = mods.fine ? FINE_PX_PER_STEP : PX_PER_STEP;
  const n = Math.trunc(px / per);
  return (mods.coarse ? n * 10 : n) || 0;
}

/** The value after `px` of travel from `start`. */
export function scrubValue(start: number, px: number, r: Range, mods: Mods = {}): number {
  return clampStep(start + stepsFor(px, mods) * (r.step ?? 1), r);
}

/** Pointer movement as travel: horizontal right, or vertical up, whichever is larger. */
export const travel = (dx: number, dy: number) => (Math.abs(dx) >= Math.abs(dy) ? dx : -dy);

/** The value a key gives a focused field, or null for keys it does not handle. */
export function keyValue(
  key: string,
  v: number,
  r: Range,
  mods: { shift?: boolean } = {},
): number | null {
  const step = r.step ?? 1;
  const big = step * 10;
  switch (key) {
    case "ArrowUp":
    case "ArrowRight":
      return clampStep(v + (mods.shift ? big : step), r);
    case "ArrowDown":
    case "ArrowLeft":
      return clampStep(v - (mods.shift ? big : step), r);
    case "PageUp":
      return clampStep(v + big, r);
    case "PageDown":
      return clampStep(v - big, r);
    case "Home":
      return r.min;
    case "End":
      return r.max;
    default:
      return null;
  }
}

/** Typed text as a value in range, or null (the field then reverts). `parse` reads
 *  another unit first (note names); plain numbers always work. */
export function parseValue(
  text: string,
  r: Range,
  parse?: (s: string) => number | null,
): number | null {
  const t = text.trim();
  const custom = parse ? parse(t) : null;
  const v = custom ?? (/^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null);
  if (v === null || !Number.isFinite(v) || v < r.min || v > r.max) return null;
  return clampStep(v, r);
}

/** Where `v` sits in the range, 0..1, for the fill bar. */
export const fraction = (v: number, r: Range) =>
  r.max === r.min ? 0 : Math.min(1, Math.max(0, (v - r.min) / (r.max - r.min)));

/** Wheel travel to steps, keeping the remainder so slow trackpad scrolls still step:
 *  returns the steps now and what is left over. Up is positive. */
export function wheelSteps(acc: number, deltaY: number, perStep = 24): [number, number] {
  const total = acc - deltaY;
  const n = Math.trunc(total / perStep);
  return [n, total - n * perStep];
}
