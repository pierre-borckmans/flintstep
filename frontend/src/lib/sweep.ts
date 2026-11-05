// CALIBRATION BY SWEEPING. Go records every raw value while the user rocks the pedal
// (internal/bridge/capture.go) and reports the sweep in State.expCapture; this decides
// when it is over, how far along it looks, and turns the result into an edit. The
// recorder at the bottom is Go's twin, for the browser mock.

import type { Capture, ExpConfig, SweepResult } from "../types";
import { RAW_MAX } from "./exp";

/** bridge.MinSweepSpan: the smallest span that calibrates. */
export const MIN_SWEEP_SPAN = 4000;
/** bridge.SweepMarginPercent: kept inside each extreme, so 0 and 127 are reached. */
export const SWEEP_MARGIN_PERCENT = 1;
/** bridge.SweepRest: a ready sweep this still ends on its own. */
export const SWEEP_REST_MS = 1200;
/** bridge.SweepTimeout: the longest a sweep runs. */
export const SWEEP_TIMEOUT_MS = 15_000;
const WIDE_SWEEP_PERCENT = 70;
const MAX_SAMPLES = 4096;

/** FinishExpSweep's refusal, in Go's words. */
export const TOO_SMALL = "the pedal barely moved: rock it all the way back and forth";

/** No sweep: what State.expCapture holds for an idle input. */
export const IDLE_CAPTURE: Capture = {
  on: false,
  low: -1,
  high: -1,
  rawLow: -1,
  rawHigh: -1,
  samples: 0,
  reversals: 0,
  ready: false,
  startedAt: 0,
  movedAt: 0,
  extremeAt: 0,
};

export type SweepVerdict = "wait" | "finish" | "timeout";

/** Whether a sweep should end now: "finish" once it is ready and has sat still for
 *  SWEEP_REST_MS, "timeout" after SWEEP_TIMEOUT_MS whatever it has, "wait" otherwise. */
export function sweepVerdict(c: Capture, now: number): SweepVerdict {
  if (!c.on) return "wait";
  if (now - c.startedAt >= SWEEP_TIMEOUT_MS) return "timeout";
  const still = now - Math.max(c.movedAt, c.extremeAt);
  return c.ready && still >= SWEEP_REST_MS ? "finish" : "wait";
}

/** How far along a sweep looks, 0..1: the span covered (40 %), a turn back (40 %), then
 *  sitting still (20 %). */
export function sweepProgress(c: Capture, now: number): number {
  if (!c.on) return 0;
  const span = c.low < 0 ? 0 : c.high - c.low;
  const wide = span * 100 >= RAW_MAX * WIDE_SWEEP_PERCENT;
  let p = 0.4 * Math.min(1, span / MIN_SWEEP_SPAN);
  p += c.reversals > 0 || wide ? 0.4 : 0;
  if (c.ready) {
    const still = now - Math.max(c.movedAt, c.extremeAt);
    p += 0.2 * Math.min(1, Math.max(0, still / SWEEP_REST_MS));
  }
  return Math.min(1, p);
}

/** What the card says while a sweep runs. */
export function sweepPrompt(c: Capture): string {
  const span = c.low < 0 ? 0 : c.high - c.low;
  if (c.ready) return "Got it. Let the pedal rest to finish.";
  if (span >= MIN_SWEEP_SPAN) return "Now all the way back the other way.";
  return "Rock the pedal all the way back and forth";
}

const marginOf = (span: number) => Math.round((span * SWEEP_MARGIN_PERCENT) / 100);

/** bridge.SweepCalibration: heel at the low end and toe at the high one, each the margin
 *  inside. Null when the span is too small. */
export function sweepCalibration(low: number, high: number): SweepResult | null {
  if (low < 0 || high < low || high - low < MIN_SWEEP_SPAN) return null;
  const m = marginOf(high - low);
  return { low, high, heel: low + m, toe: high - m };
}

/** The edit a finished sweep makes: heel = min, toe = max. Invert is left alone: it is
 *  the user's, and which way the pedal goes is its job. */
export function sweepPatch(r: SweepResult): Pick<ExpConfig, "min" | "max"> {
  return { min: r.heel, max: r.toe };
}

/** Learning the range (bridge widen.go proposed low..high): the calibration widened to
 *  cover it, each end where it was or further out, never in. Heel and toe keep their
 *  order (a pedal whose toe reads lower keeps min > max). Null when nothing widens. */
export function widenCalibration(
  x: Pick<ExpConfig, "min" | "max">,
  low: number,
  high: number,
): Pick<ExpConfig, "min" | "max"> | null {
  if (x.min === x.max) return null;
  const lo = Math.min(x.min, x.max);
  const hi = Math.max(x.min, x.max);
  const nlo = Math.max(0, Math.min(lo, low));
  const nhi = Math.min(RAW_MAX, Math.max(hi, high));
  if (nlo === lo && nhi === hi) return null;
  return x.min <= x.max ? { min: nlo, max: nhi } : { min: nhi, max: nlo };
}

/** Lowest and highest raw values seen on an input this session, -1 for none. */
export interface Seen {
  low: number;
  high: number;
}

/** A gentle hint when the calibration looks wrong, or null. A short calibrated travel,
 *  or a pedal seen well past the heel or toe (by 5 % of the travel), means the ends
 *  are clamped: the case of a heel set with the pedal half way up. */
export function calibrationHint(x: Pick<ExpConfig, "min" | "max">, seen: Seen): string | null {
  if (x.min === x.max || (x.min === 0 && x.max === RAW_MAX)) return null;
  const span = Math.abs(x.max - x.min);
  if (span < MIN_SWEEP_SPAN) return "The calibrated travel is very short: press Calibrate";
  if (seen.low < 0) return null;
  const slack = span * 0.05;
  const heelLow = x.min < x.max;
  const pastLow = seen.low < Math.min(x.min, x.max) - slack;
  const pastHigh = seen.high > Math.max(x.min, x.max) + slack;
  if (pastLow) return `${heelLow ? "Heel" : "Toe"} looks high: press Calibrate`;
  if (pastHigh) return `${heelLow ? "Toe" : "Heel"} looks low: press Calibrate`;
  return null;
}

/** bridge.sweepExtremes: the plain lowest and highest values. No glitch filter: a real
 *  pedal's heel is often a single sample (it changes fastest there and sends nothing at
 *  rest), and the filter used to throw it away. */
export function sweepExtremes(samples: readonly number[]): [number, number] {
  if (samples.length === 0) return [-1, -1];
  return [Math.min(...samples), Math.max(...samples)];
}

/** Go's sweep recorder (bridge capture.go), for the mock. */
export function createRecorder(startedAt: number) {
  const samples: number[] = [];
  let rawLow = -1;
  let rawHigh = -1;
  let reversals = 0;
  let dir = 0;
  let peak = 0;
  let anchor = 0;
  let movedAt = startedAt;
  let extremeAt = startedAt;
  return {
    add(raw: number, now: number) {
      if (raw < 0) return;
      if (samples.length < MAX_SAMPLES) samples.push(raw);
      if (samples.length === 1) {
        rawLow = rawHigh = peak = anchor = raw;
        return;
      }
      if (raw < rawLow) [rawLow, extremeAt] = [raw, now];
      if (raw > rawHigh) [rawHigh, extremeAt] = [raw, now];
      const span = rawHigh - rawLow;
      if (Math.abs(raw - anchor) > Math.max(300, Math.floor((span * 3) / 200))) {
        anchor = raw;
        movedAt = now;
      }
      const back = Math.max(300, Math.floor((span * 15) / 100));
      if (dir === 0) {
        if (raw > peak + back) [dir, peak] = [1, raw];
        else if (raw < peak - back) [dir, peak] = [-1, raw];
      } else if (dir * (raw - peak) > 0) peak = raw;
      else if (dir * (peak - raw) > back) {
        if (span >= MIN_SWEEP_SPAN) reversals++;
        [dir, peak] = [-dir, raw];
      }
    },
    view(): Capture {
      const [low, high] = sweepExtremes(samples);
      const span = high - low;
      return {
        on: true,
        low,
        high,
        rawLow,
        rawHigh,
        samples: samples.length,
        reversals,
        ready:
          low >= 0 &&
          span >= MIN_SWEEP_SPAN &&
          (reversals > 0 || span * 100 >= RAW_MAX * WIDE_SWEEP_PERCENT),
        startedAt,
        movedAt,
        extremeAt,
      };
    },
  };
}

/** bridge widen.go, for the mock: proposes a wider range once `need` values within
 *  `windowMs` of each other went past an end by more than the margin. The proposal is
 *  the second furthest value, the margin back inside. */
export function createWidener(need = 3, windowMs = 3000) {
  type Side = { count: number; far: number; next: number; at: number };
  const fresh = (): Side => ({ count: 0, far: 0, next: 0, at: 0 });
  let plo = -1;
  let phi = -1;
  let low = fresh();
  let high = fresh();
  const note = (s: Side, raw: number, now: number, way: number) => {
    if (s.count > 0 && now - s.at > windowMs) Object.assign(s, fresh());
    if (s.count === 0) [s.far, s.next] = [raw, raw];
    else if (way * (raw - s.far) > 0) [s.far, s.next] = [raw, s.far];
    else if (way * (raw - s.next) > 0 || s.count === 1) s.next = raw;
    s.count++;
    s.at = now;
    return s.count >= need;
  };
  return {
    /** Forgets the proposals: the calibration changed. */
    reset() {
      plo = -1;
      phi = -1;
      low = fresh();
      high = fresh();
    },
    add(x: Pick<ExpConfig, "min" | "max">, raw: number, now: number): [number, number] | null {
      if (x.min === x.max || raw < 0) return null;
      let lo = Math.min(x.min, x.max);
      let hi = Math.max(x.min, x.max);
      if (plo >= 0) lo = Math.min(lo, plo);
      if (phi >= 0) hi = Math.max(hi, phi);
      const m = marginOf(hi - lo);
      if (raw < lo - m) {
        if (!note(low, raw, now, -1)) return null;
        const v = low.next + m;
        low = fresh();
        if (v < lo) {
          plo = v;
          return [v, hi];
        }
      } else if (raw > hi + m) {
        if (!note(high, raw, now, 1)) return null;
        const v = high.next - m;
        high = fresh();
        if (v > hi) {
          phi = v;
          return [lo, v];
        }
      }
      return null;
    },
  };
}
