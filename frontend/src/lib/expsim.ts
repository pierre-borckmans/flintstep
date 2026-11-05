// SIMULATED EXPRESSION PEDAL. The maths behind the "Simulate pedal" row and the mock's
// simulation, kept here so it is tested without React. Go's twin is internal/bridge/sim.go.

import { RAW_MAX } from "./exp";

/** One heel → toe → heel sweep, ms (bridge.SweepPeriod). */
export const SWEEP_PERIOD_MS = 4000;

const clamp01 = (f: number) => Math.min(1, Math.max(0, f));

/** A 0..1 position as a raw jack value, linearly (bridge.FractionRaw). The user's heel
 *  and toe calibration then applies to it as to a real pedal's reading. */
export function fractionRaw(f: number): number {
  return Math.round(clamp01(f) * RAW_MAX);
}

/** Where a sweep that started at the heel is after `ms`: an eased (cosine) heel → toe →
 *  heel every SWEEP_PERIOD_MS. */
export function sweepFraction(ms: number): number {
  const p = (((ms % SWEEP_PERIOD_MS) + SWEEP_PERIOD_MS) % SWEEP_PERIOD_MS) / SWEEP_PERIOD_MS;
  return (1 - Math.cos(2 * Math.PI * p)) / 2;
}

/** How far into a sweep it is at fraction `f` on the way up, so a sweep starts from where
 *  the pedal is instead of jumping to the heel. */
export function sweepOffset(f: number): number {
  return (Math.acos(1 - 2 * clamp01(f)) / (2 * Math.PI)) * SWEEP_PERIOD_MS;
}

/** The position under a pointer at `clientX` on a track spanning `left`..`left+width`. */
export function pointerFraction(clientX: number, left: number, width: number): number {
  if (width <= 0) return 0;
  return clamp01((clientX - left) / width);
}

/** The position a key gives the focused slider, or null for keys it does not handle.
 *  Arrows move 1 %, shift 10 %; Page keys 10 %; Home/End go to the heel/toe. */
export function simKey(key: string, f: number, shift = false): number | null {
  const step = shift ? 0.1 : 0.01;
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return clamp01(f + step);
    case "ArrowLeft":
    case "ArrowDown":
      return clamp01(f - step);
    case "PageUp":
      return clamp01(f + 0.1);
    case "PageDown":
      return clamp01(f - 0.1);
    case "Home":
      return 0;
    case "End":
      return 1;
  }
  return null;
}

/** What an input's cable status line says. */
export function cableLabel(cable: boolean, simulated: boolean): string {
  if (simulated) return "simulated";
  return cable ? "cable in" : "no cable";
}
