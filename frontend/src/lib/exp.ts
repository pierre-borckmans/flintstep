import type { ExpConfig } from "../types";

export const RAW_MAX = 65535;

/** Where a raw reading sits between heel (min) and toe (max), 0..1, after invert.
 *  Null with no reading. min is always the heel and max the toe, whichever reads
 *  higher, so a pedal whose toe reads lower has min > max and still goes 0 at the heel
 *  to 1 at the toe. Mirrors the engine's calibration (mapping.Engine.Exp) minus its
 *  hysteresis, including its fallback to the whole jack for a one-point calibration. */
export function expFraction(
  raw: number,
  cfg: Pick<ExpConfig, "min" | "max" | "invert">,
): number | null {
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

/** The CC value 0..127 the input sends for a raw reading, or null with none. */
export function expValue(
  raw: number,
  cfg: Pick<ExpConfig, "min" | "max" | "invert">,
): number | null {
  const f = expFraction(raw, cfg);
  return f === null ? null : Math.round(f * 127);
}

/** A raw value as a fraction of the jack's whole range, for drawing it on a track. */
export function rawFraction(raw: number): number {
  return Math.min(1, Math.max(0, raw / RAW_MAX));
}
