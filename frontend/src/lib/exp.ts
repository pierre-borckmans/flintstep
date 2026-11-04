import type { ExpConfig } from "../types";

export const RAW_MAX = 65535;

/** Where a raw reading sits between heel (min) and toe (max), 0..1, after invert.
 *  Null with no reading. Mirrors the engine's calibration minus its hysteresis. */
export function expFraction(
  raw: number,
  cfg: Pick<ExpConfig, "min" | "max" | "invert">,
): number | null {
  if (raw < 0) return null;
  const span = cfg.max - cfg.min;
  let f = span > 0 ? (raw - cfg.min) / span : 0;
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
