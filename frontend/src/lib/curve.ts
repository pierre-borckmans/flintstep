import type { CurveKind, ExpCurve } from "../types";
import { applyCurve, clampAmount, PRESET_AMOUNT } from "./exp";

// RESPONSE CURVE UI. The words, the graph's path, the drag that shapes Custom, and the
// hint a calibration sweep can give. The maths of the curves is exp.ts (Go's twin).

export const CURVE_LABEL: Record<CurveKind, string> = {
  linear: "Linear",
  gentle: "Gentle start",
  fast: "Fast start",
  s: "S-curve",
  custom: "Custom",
};

/** The segmented control's short labels. */
export const CURVE_SHORT: Record<CurveKind, string> = {
  linear: "Linear",
  gentle: "Gentle",
  fast: "Fast",
  s: "S",
  custom: "Custom",
};

export const CURVE_TIP: Record<CurveKind, string> = {
  linear: "Linear: the value follows the pedal's reading as it is.",
  gentle:
    "Gentle start: finer control near the heel. Good for pedals that jump at the bottom and crawl at the top.",
  fast: "Fast start: quick off the heel, finer control near the toe.",
  s: "S-curve: fine at both ends, quicker through the middle.",
  custom: "Custom: drag up or down on the graph to shape it. Up is gentler at the heel.",
};

/** "linear", "gentle", ..., "custom 0.35": the history label's words. */
export function curveWords(c: ExpCurve): string {
  return c.kind === "custom"
    ? `custom ${formatAmount(c.amount)}`
    : CURVE_LABEL[c.kind].toLowerCase();
}

export function formatAmount(a: number): string {
  const v = Math.round(a * 100) / 100;
  return v === 0 ? "0" : v.toFixed(2).replace(/0$/, "");
}

/** The curve after picking `kind`. Going to Custom from Gentle or Fast with no shape of
 *  its own starts where that preset is, so the graph does not jump back to a line. */
export function pickCurve(c: ExpCurve, kind: CurveKind): ExpCurve {
  if (kind !== "custom" || c.amount !== 0) return { ...c, kind };
  const seed = c.kind === "gentle" ? PRESET_AMOUNT : c.kind === "fast" ? -PRESET_AMOUNT : 0;
  return { kind, amount: seed };
}

/** Amount per px of vertical drag on the graph: its whole height spans -1..1 twice
 *  over would be too twitchy; one height is a full swing of 1. */
export const AMOUNT_PER_PX = 1 / 80;

/** The amount after dragging `dy` px (down positive, as pointer events count) from
 *  `start`, rounded to 0.01 so the label and history read clean. Up makes it gentler. */
export function dragAmount(start: number, dy: number, fine = false): number {
  const v = clampAmount(start - dy * AMOUNT_PER_PX * (fine ? 0.25 : 1));
  return Math.round(v * 100) / 100;
}

/** The amount after a key on the focused graph, or null for keys it ignores. */
export function keyAmount(a: number, key: string, shift = false): number | null {
  const step = shift ? 0.1 : 0.05;
  const r = (v: number) => Math.round(clampAmount(v) * 100) / 100;
  switch (key) {
    case "ArrowUp":
    case "ArrowRight":
      return r(a + step);
    case "ArrowDown":
    case "ArrowLeft":
      return r(a - step);
    case "PageUp":
      return r(a + 0.25);
    case "PageDown":
      return r(a - 0.25);
    case "Home":
      return -1;
    case "End":
      return 1;
    case "0":
      return 0;
    default:
      return null;
  }
}

/** An SVG path of the curve in a w × h box (heel bottom-left, toe top-right). */
export function curvePath(c: ExpCurve, w: number, h: number, steps = 48): string {
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = t * w;
    const y = h - applyCurve(c, t) * h;
    d += `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return d;
}

// ---- the sweep's suggestion -----------------------------------------------------

/** Which end a pedal races through, from a calibration sweep. */
export interface TaperHint {
  /** The curve that evens it out. */
  curve: "gentle" | "fast";
  /** The physical end where the reading changes fast. */
  end: "heel" | "toe";
}

/** How lopsided the time spent in the two halves of the reading must be to count as a
 *  taper. A foot rocks a pedal about as long through its heel half as its toe half, so a
 *  linear pot sits near 1; a pot whose reading reaches half way in the first fifth of
 *  the travel sits near 2.3, a real audio taper higher still. */
const TAPER_RATIO = 1.6;
/** Moving time needed before trusting it, ms: a couple of full rocks. */
const MIN_MOVING_MS = 1200;
/** A gap longer than this between two readings is the pedal resting, not moving. */
const MAX_STEP_MS = 250;

/** Whether a sweep's samples ([ms, raw], oldest first) show the reading racing through
 *  one end, and the curve that evens it out. The travel is the calibrated one (heel 0 ..
 *  toe 1, before invert). A foot spends about as long in the heel half of the travel as
 *  in the toe half; the reading's halves split the time evenly only if the pot is linear.
 *  If the reading spends much less time under its middle, it changes fast near the heel.
 *  Rests (no new reading for a while, or the same one again) do not count. Null
 *  when the sweep did not cover both ends, was too short, or the pedal is even enough.
 *  With Invert on the curve sees the travel the other way round, so the suggestion
 *  swaps. */
export function taperHint(
  samples: [number, number][],
  heel: number,
  toe: number,
  invert = false,
): TaperHint | null {
  if (heel === toe) return null;
  let low = 0;
  let high = 0;
  let lo = 1;
  let hi = 0;
  for (let i = 1; i < samples.length; i++) {
    const [t0, v0] = samples[i - 1];
    const [t1, v1] = samples[i];
    const dt = t1 - t0;
    if (dt <= 0 || dt > MAX_STEP_MS || v0 === v1) continue;
    const u = ((v0 + v1) / 2 - heel) / (toe - heel);
    lo = Math.min(lo, u);
    hi = Math.max(hi, u);
    if (u < 0.5) low += dt;
    else high += dt;
  }
  if (lo > 0.15 || hi < 0.85 || low + high < MIN_MOVING_MS || low <= 0 || high <= 0) return null;
  let end: "heel" | "toe";
  if (high / low >= TAPER_RATIO) end = "heel";
  else if (low / high >= TAPER_RATIO) end = "toe";
  else return null;
  // Fast near the heel wants fine control there: Gentle, unless inverted.
  const gentle = (end === "heel") !== invert;
  return { curve: gentle ? "gentle" : "fast", end };
}

/** The suggestion's line. */
export function taperText(h: TaperHint): string {
  return `This pedal changes fast near the ${h.end}: try ${CURVE_LABEL[h.curve]}`;
}
