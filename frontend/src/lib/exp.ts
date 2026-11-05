import type { CurveKind, CurvePoint, ExpConfig, ExpCurve } from "../types";

export const RAW_MAX = 65535;

// ---- response curves ------------------------------------------------------------
// internal/mapping/curve.go, number for number; curves.golden.json pins the two together.

/** mapping.curveSteep: the exponent at amount ±1. */
const STEEP = 5;
/** mapping.presetAmount: Gentle on the custom scale (Fast is its negative). */
export const PRESET_AMOUNT = 0.6;
/** mapping.sStrength / sCentre: the default S, what "s" was before it had controls. */
export const S_STRENGTH = 0.6;
export const S_CENTRE = 0.5;
/** mapping.sPower: the S shape's exponent each side of the centre. */
const S_POWER = 3;
/** mapping.MaxCurvePoints / minPointGap. */
export const MAX_CURVE_POINTS = 8;
export const MIN_POINT_GAP = 0.02;

export const LINEAR: ExpCurve = { kind: "linear", amount: 0 };
export const CURVE_KINDS: CurveKind[] = ["linear", "gentle", "fast", "s", "custom"];
export const isCurveKind = (k: unknown): k is CurveKind => CURVE_KINDS.includes(k as CurveKind);

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const clampAmount = (a: number) => (Number.isFinite(a) ? Math.min(1, Math.max(-1, a)) : 0);

/** (e^(k·t) - 1) / (e^k - 1): mapping.expCurve. */
function expCurve(t: number, k: number): number {
  if (Math.abs(k) < 1e-9) return t;
  return Math.expm1(k * t) / Math.expm1(k);
}

const clampF = (v: number, lo: number, hi: number, def: number) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;

/** The S curve's controls as they apply: zeros for both are the default S. */
export function sControls(c: Pick<ExpCurve, "strength" | "centre">): {
  strength: number;
  centre: number;
} {
  const s = c.strength ?? 0;
  const ce = c.centre ?? 0;
  if (s === 0 && ce === 0) return { strength: S_STRENGTH, centre: S_CENTRE };
  return {
    strength: clampF(s, 0, 1, S_STRENGTH),
    centre: clampF(ce === 0 ? S_CENTRE : ce, 0.1, 0.9, S_CENTRE),
  };
}

/** mapping.sCurve. */
function sCurve(t: number, m: number, c: number): number {
  const s = t <= c ? c * (t / c) ** S_POWER : 1 - (1 - c) * ((1 - t) / (1 - c)) ** S_POWER;
  return (1 - m) * t + m * s;
}

/** mapping.monotone: Fritsch-Carlson monotone cubic through (0,0), the points, (1,1). */
export function monotone(t: number, pts: readonly CurvePoint[]): number {
  const xs = [0, ...pts.map((p) => p.x), 1];
  const ys = [0, ...pts.map((p) => p.y), 1];
  const n = xs.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m: number[] = new Array(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) {
      const k = 3 / Math.sqrt(h);
      m[i] = k * a * d[i];
      m[i + 1] = k * b * d[i];
    }
  }
  let i = 0;
  while (i < n - 2 && t > xs[i + 1]) i++;
  const h = xs[i + 1] - xs[i];
  const u = (t - xs[i]) / h;
  const h00 = (1 + 2 * u) * (1 - u) * (1 - u);
  const h10 = u * (1 - u) * (1 - u);
  const h01 = u * u * (3 - 2 * u);
  const h11 = u * u * (u - 1);
  return h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1];
}

/** mapping.normalizePoints: sorted, inside 0..1 and MIN_POINT_GAP apart, y clamped and
 *  never going back down, at most MAX_CURVE_POINTS. */
export function normalizePoints(
  input: readonly CurvePoint[] | undefined,
): CurvePoint[] | undefined {
  if (!input || input.length === 0) return undefined;
  const ps = input
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: p.x, y: Math.min(1, Math.max(0, p.y)) }))
    .sort((a, b) => a.x - b.x);
  const out: CurvePoint[] = [];
  let px = 0;
  let py = 0;
  for (const p of ps) {
    if (p.x < MIN_POINT_GAP || p.x > 1 - MIN_POINT_GAP || p.x - px < MIN_POINT_GAP) continue;
    const q = { x: p.x, y: Math.max(p.y, py) };
    out.push(q);
    px = q.x;
    py = q.y;
    if (out.length === MAX_CURVE_POINTS) break;
  }
  return out.length ? out : undefined;
}

/** mapping.ExpCurve.Apply: travel t (clamped to 0..1) through the curve. No curve, or
 *  one this version does not know, is linear, as Go's Normalize makes it. */
export function applyCurve(c: ExpCurve | undefined, t: number): number {
  if (!(t > 0)) return 0;
  if (t >= 1) return 1;
  switch (c?.kind) {
    case "gentle":
      return clamp01(expCurve(t, PRESET_AMOUNT * STEEP));
    case "fast":
      return clamp01(expCurve(t, -PRESET_AMOUNT * STEEP));
    case "s": {
      const { strength, centre } = sControls(c);
      return clamp01(sCurve(t, strength, centre));
    }
    case "custom":
      if (c.points && c.points.length > 0) return clamp01(monotone(t, c.points));
      return clamp01(expCurve(t, clampAmount(c.amount) * STEEP));
    default:
      return t;
  }
}

/** mapping.ExpCurve.normalize. */
export function normalizeCurve(c: Partial<ExpCurve> | undefined): ExpCurve {
  const out: ExpCurve = {
    kind: isCurveKind(c?.kind) ? c.kind : "linear",
    amount: clampAmount(c?.amount ?? 0),
  };
  const st = c?.strength ?? 0;
  const ce = c?.centre ?? 0;
  if (st !== 0 || ce !== 0) {
    out.strength = clampF(st, 0, 1, S_STRENGTH);
    out.centre = clampF(ce === 0 ? S_CENTRE : ce, 0.1, 0.9, S_CENTRE);
  }
  const pts = normalizePoints(c?.points);
  if (pts) out.points = pts;
  return out;
}

// ---- calibration ----------------------------------------------------------------

type Cal = Pick<ExpConfig, "min" | "max" | "invert"> & { curve?: ExpCurve };

/** Where a raw reading sits between heel (min) and toe (max), 0..1, after invert and
 *  before the curve: the pedal's travel. Null with no reading. min is always the heel
 *  and max the toe, whichever reads higher, so a pedal whose toe reads lower has
 *  min > max and still goes 0 at the heel to 1 at the toe. Mirrors the engine's
 *  calibration (mapping.Engine.Exp) minus its hysteresis, including its fallback to
 *  the whole jack for a one-point calibration. */
export function expFraction(raw: number, cfg: Cal): number | null {
  if (raw < 0) return null;
  let heel = cfg.min;
  let toe = cfg.max;
  if (heel === toe) {
    heel = 0;
    toe = RAW_MAX;
  }
  let f = (raw - heel) / (toe - heel);
  f = Math.min(1, Math.max(0, f));
  return cfg.invert ? 1 - f : f;
}

/** The value going out as a fraction, 0..1: the travel through the curve. Thresholds
 *  and the value bar are measured on this. Null with no reading. */
export function expOutput(raw: number, cfg: Cal): number | null {
  const f = expFraction(raw, cfg);
  return f === null ? null : applyCurve(cfg.curve, f);
}

/** The CC value 0..127 the input sends for a raw reading, or null with none. */
export function expValue(raw: number, cfg: Cal): number | null {
  const f = expOutput(raw, cfg);
  return f === null ? null : Math.round(f * 127);
}

/** A raw value as a fraction of the jack's whole range, for drawing it on a track. */
export function rawFraction(raw: number): number {
  return Math.min(1, Math.max(0, raw / RAW_MAX));
}
