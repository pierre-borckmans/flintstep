import type { CurveKind, ExpConfig, ExpCurve } from "../types";

export const RAW_MAX = 65535;

// ---- response curves ------------------------------------------------------------
// internal/mapping/curve.go, number for number; curves.golden.json pins the two together.

/** mapping.curveSteep: the exponent at amount ±1. */
const STEEP = 5;
/** mapping.presetAmount: Gentle on the custom scale (Fast is its negative). */
export const PRESET_AMOUNT = 0.6;
/** mapping.sBlend: how much smoothstep the S curve takes. */
const S_BLEND = 0.6;

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
    case "s":
      return clamp01((1 - S_BLEND) * t + S_BLEND * t * t * (3 - 2 * t));
    case "custom":
      return clamp01(expCurve(t, clampAmount(c.amount) * STEEP));
    default:
      return t;
  }
}

/** mapping.ExpCurve.normalize. */
export function normalizeCurve(c: Partial<ExpCurve> | undefined): ExpCurve {
  return {
    kind: isCurveKind(c?.kind) ? c.kind : "linear",
    amount: clampAmount(c?.amount ?? 0),
  };
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
