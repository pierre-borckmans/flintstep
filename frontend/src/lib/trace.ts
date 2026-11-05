// THE LIVE RAW TRACE. Each Expression card draws the last few seconds of its input's
// raw values. The values land in a fixed ring buffer (no allocation per sample); the
// card reads them back as points to draw.

/** How much the trace shows, ms. */
export const TRACE_MS = 8000;

/** A fixed-size ring of (time, value) samples, oldest overwritten first. */
export interface Ring {
  readonly cap: number;
  readonly t: Float64Array;
  readonly v: Float64Array;
  /** Index the next sample goes to. */
  head: number;
  /** Samples held, at most cap. */
  size: number;
}

export function createRing(cap: number): Ring {
  return { cap, t: new Float64Array(cap), v: new Float64Array(cap), head: 0, size: 0 };
}

/** Adds a sample. One older than the newest is dropped: time only runs forwards. */
export function pushSample(r: Ring, t: number, v: number): void {
  if (r.size > 0) {
    const last = (r.head - 1 + r.cap) % r.cap;
    if (t < r.t[last]) return;
  }
  r.t[r.head] = t;
  r.v[r.head] = v;
  r.head = (r.head + 1) % r.cap;
  r.size = Math.min(r.cap, r.size + 1);
}

export function clearRing(r: Ring): void {
  r.head = 0;
  r.size = 0;
}

/** The newest sample, or null. */
export function lastSample(r: Ring): { t: number; v: number } | null {
  if (r.size === 0) return null;
  const i = (r.head - 1 + r.cap) % r.cap;
  return { t: r.t[i], v: r.v[i] };
}

/** Calls f for each sample from oldest to newest. */
export function eachSample(r: Ring, f: (t: number, v: number) => void): void {
  const start = (r.head - r.size + r.cap) % r.cap;
  for (let k = 0; k < r.size; k++) {
    const i = (start + k) % r.cap;
    f(r.t[i], r.v[i]);
  }
}

/** The samples in the window ending at `now`, oldest first, as [t, v] pairs, plus the
 *  last one before the window (so the line enters from the left edge) and the newest
 *  value carried on to `now`: the pedal only reports while it moves, so a resting
 *  pedal is a flat line, not a gap. */
export function windowed(r: Ring, now: number, span = TRACE_MS): [number, number][] {
  const from = now - span;
  const out: [number, number][] = [];
  let before: [number, number] | null = null;
  eachSample(r, (t, v) => {
    if (t < from) before = [t, v];
    else out.push([t, v]);
  });
  if (before) out.unshift([from, (before as [number, number])[1]]);
  const last = out[out.length - 1];
  if (last && last[0] < now) out.push([now, last[1]]);
  return out;
}

/** The polyline for samples in a w × h box: time maps left (now -
 *  span) to right (now), value lo..hi maps bottom to top, clamped to the box. */
export function tracePoints(
  samples: readonly [number, number][],
  now: number,
  w: number,
  h: number,
  lo: number,
  hi: number,
  span = TRACE_MS,
): [number, number][] {
  const range = hi - lo || 1;
  return samples.map(([t, v]) => {
    const x = ((t - (now - span)) / span) * w;
    const y = h - ((Math.min(hi, Math.max(lo, v)) - lo) / range) * h;
    return [Math.max(0, Math.min(w, x)), y];
  });
}
