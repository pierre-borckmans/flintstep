import type { CurveKind, CurvePoint, ExpCurve } from "../types";
import {
  applyCurve,
  MAX_CURVE_POINTS,
  MIN_POINT_GAP,
  normalizePoints,
  PRESET_AMOUNT,
  sControls,
} from "./exp";

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
  s: "S-curve: fine at both ends, quicker through the middle. Strength sets how much; Centre moves the steep part along the travel.",
  custom:
    "Custom: drag the points. Click an empty spot to add one, double-click a point to remove it. The curve never goes back down.",
};

/** "linear", "gentle", ..., "custom 0.35": the history label's words. */
export function curveWords(c: ExpCurve): string {
  if (c.kind === "custom") {
    return c.points?.length
      ? `custom, ${c.points.length} points`
      : `custom ${formatAmount(c.amount)}`;
  }
  if (c.kind === "s" && (c.strength || c.centre)) {
    const { strength, centre } = sControls(c);
    return `S ${Math.round(strength * 100)}% at ${Math.round(centre * 100)}%`;
  }
  return CURVE_LABEL[c.kind].toLowerCase();
}

/** Three points sampled from a curve: how Custom starts from whatever was picked, so
 *  the graph does not jump. */
export function seedPoints(c: ExpCurve): CurvePoint[] {
  return [0.25, 0.5, 0.75].map((x) => ({ x, y: Math.round(applyCurve(c, x) * 1000) / 1000 }));
}

/** Custom's points as the editor shows them: its own, or seeded from its amount. */
export function editPoints(c: ExpCurve): CurvePoint[] {
  return c.points?.length ? c.points : seedPoints({ kind: "custom", amount: c.amount });
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Moves point i to (x, y), kept between its neighbours (MIN_POINT_GAP away) and
 *  inside the box; the rest stay, then the whole set is made non-decreasing. */
export function movePoint(
  pts: readonly CurvePoint[],
  i: number,
  x: number,
  y: number,
): CurvePoint[] {
  const lo = (i > 0 ? pts[i - 1].x : 0) + MIN_POINT_GAP;
  const hi = (i < pts.length - 1 ? pts[i + 1].x : 1) - MIN_POINT_GAP;
  const next = pts.map((p, j) =>
    j === i ? { x: r3(Math.min(hi, Math.max(lo, x))), y: r3(Math.min(1, Math.max(0, y))) } : p,
  );
  return normalizePoints(next) ?? [];
}

/** Adds a point at (x, y) unless one is too close or the curve is full; returns the
 *  new list and the new point's index (-1 when nothing was added). */
export function addPoint(pts: readonly CurvePoint[], x: number, y: number): [CurvePoint[], number] {
  if (pts.length >= MAX_CURVE_POINTS || x < MIN_POINT_GAP || x > 1 - MIN_POINT_GAP)
    return [[...pts], -1];
  if (pts.some((p) => Math.abs(p.x - x) < MIN_POINT_GAP)) return [[...pts], -1];
  const next = normalizePoints([...pts, { x: r3(x), y: r3(y) }]) ?? [];
  return [next, next.findIndex((p) => Math.abs(p.x - r3(x)) < 1e-9)];
}

export function removePoint(pts: readonly CurvePoint[], i: number): CurvePoint[] {
  return pts.filter((_, j) => j !== i);
}

export function formatAmount(a: number): string {
  const v = Math.round(a * 100) / 100;
  return v === 0 ? "0" : v.toFixed(2).replace(/0$/, "");
}

/** The curve after picking `kind`. Going to Custom from Gentle or Fast with no shape of
 *  its own starts where that preset is, so the graph does not jump back to a line. */
export function pickCurve(c: ExpCurve, kind: CurveKind): ExpCurve {
  if (kind !== "custom") return { ...c, kind };
  // Custom keeps its own points if it has some; otherwise it starts as three points on
  // the curve that was picked (or on its old amount), so the graph does not jump.
  if (c.points?.length) return { ...c, kind };
  const from: ExpCurve =
    c.kind === "custom" || c.kind === "linear"
      ? { kind: "custom", amount: c.amount }
      : c.kind === "gentle"
        ? { kind: "custom", amount: PRESET_AMOUNT }
        : c.kind === "fast"
          ? { kind: "custom", amount: -PRESET_AMOUNT }
          : c;
  return { ...c, kind, points: seedPoints(from) };
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
