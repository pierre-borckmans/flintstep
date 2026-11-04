// THE HEX NUTS under the footswitch caps. On the real pedal each one stops wherever it was
// tightened, so this is a toy: the nuts can sit aligned, shuffled from a seed, or match the
// user's own pedal. Purely visual: it lives in localStorage, never in the config, the
// auto-save or the undo history. Everything here is pure; the store is in useNuts.ts.

export type NutMode = "aligned" | "shuffled" | "custom";

export type NutState = {
  mode: NutMode;
  /** Shuffled mode's seed, a uint32. */
  seed: number;
  /** Match-my-pedal angles, one per switch, each in [0, 60). */
  custom: number[];
};

export const NUT_COUNT = 6;
/** A hexagon looks the same every 60 degrees. */
export const NUT_PERIOD = 60;
export const NUT_KEY = "sparkx.nuts";

const MODES: readonly NutMode[] = ["aligned", "shuffled", "custom"];

/** Tenths of a degree is as fine as anyone can see. */
export const round1 = (deg: number) => Math.round(deg * 10) / 10;

/** Any angle to [0, 60), rounded to a tenth; nonsense reads as 0. */
export function normalise(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const r = round1(((deg % NUT_PERIOD) + NUT_PERIOD) % NUT_PERIOD);
  return r >= NUT_PERIOD ? 0 : r + 0; // + 0 turns -0 into 0
}

/** mulberry32: a tiny deterministic PRNG, returns floats in [0, 1). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The six angles a seed gives, whole degrees in [0, 60). */
export function seededAngles(seed: number, n = NUT_COUNT): number[] {
  const r = prng(seed);
  return Array.from({ length: n }, () => Math.floor(r() * NUT_PERIOD));
}

/** A fresh seed, never the current one. */
export function nextSeed(current: number, rand: () => number = Math.random): number {
  for (;;) {
    const s = Math.floor(rand() * 4294967296) >>> 0;
    if (s !== current) return s;
  }
}

export const ALIGNED: readonly number[] = Array(NUT_COUNT).fill(0);

/** The angles on screen for a state. */
export function shownAngles(s: NutState): number[] {
  if (s.mode === "shuffled") return seededAngles(s.seed);
  if (s.mode === "custom") return s.custom.slice();
  return ALIGNED.slice();
}

/** Switching mode; into Match my pedal it starts from whatever was showing. */
export function withMode(s: NutState, mode: NutMode): NutState {
  if (mode === s.mode) return s;
  if (mode === "custom") return { ...s, mode, custom: shownAngles(s) };
  return { ...s, mode };
}

export function withAngle(s: NutState, i: number, deg: number): NutState {
  const custom = s.custom.slice();
  custom[i] = normalise(deg);
  return { ...s, custom };
}

/** Degrees per scrolled pixel, and per pixel with Shift held. */
const WHEEL = { coarse: 0.15, fine: 0.03, line: 16, page: 400, max: 15 };

/** A wheel or trackpad event to a rotation step in degrees: down or right turns it
 *  clockwise. Lines and pages count as pixels; one event never turns it more than 15°. Shift
 *  can turn a vertical wheel into a horizontal one, so the bigger axis wins. */
export function wheelStep(
  e: { deltaX: number; deltaY: number; deltaMode: number },
  fine: boolean,
): number {
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  const px = d * (e.deltaMode === 1 ? WHEEL.line : e.deltaMode === 2 ? WHEEL.page : 1);
  const deg = px * (fine ? WHEEL.fine : WHEEL.coarse);
  return Math.max(-WHEEL.max, Math.min(WHEEL.max, deg));
}

/** The bearing of (px, py) from (cx, cy), in degrees, clockwise on screen. */
export function bearing(cx: number, cy: number, px: number, py: number): number {
  return (Math.atan2(py - cy, px - cx) * 180) / Math.PI;
}

/** The shortest turn from a to b, in (-180, 180]. */
export function turn(a: number, b: number): number {
  const d = (((b - a) % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
}

/** The equivalent of target (mod 60) nearest to from, so a nut animating from 55° to 5°
 *  turns 10° forward instead of 50° back. */
export function nearest(from: number, target: number): number {
  const d = (((target - from) % NUT_PERIOD) + NUT_PERIOD) % NUT_PERIOD;
  return from + (d > NUT_PERIOD / 2 ? d - NUT_PERIOD : d);
}

export const easeOutCubic = (t: number) => 1 - (1 - Math.min(Math.max(t, 0), 1)) ** 3;

/** A readout: whole degrees, or tenths when there are any. */
export const degText = (deg: number) => `${Number.isInteger(deg) ? deg : deg.toFixed(1)}°`;

export function defaultNuts(seed = 1): NutState {
  return { mode: "aligned", seed: seed >>> 0, custom: ALIGNED.slice() };
}

/** Reads what was stored, keeping whatever is valid and defaulting the rest. */
export function parseNuts(raw: string | null | undefined, fallbackSeed = 1): NutState {
  const d = defaultNuts(fallbackSeed);
  if (!raw) return d;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return d;
  }
  if (!v || typeof v !== "object") return d;
  const o = v as Record<string, unknown>;
  const mode = MODES.includes(o.mode as NutMode) ? (o.mode as NutMode) : d.mode;
  const seed =
    typeof o.seed === "number" && Number.isInteger(o.seed) && o.seed >= 0 && o.seed < 2 ** 32
      ? o.seed
      : d.seed;
  const arr: unknown[] | null = Array.isArray(o.custom) ? o.custom : null;
  const custom = arr
    ? Array.from({ length: NUT_COUNT }, (_, i) => {
        const a = arr[i];
        return typeof a === "number" ? normalise(a) : 0;
      })
    : d.custom;
  return { mode, seed, custom };
}

export const serialiseNuts = (s: NutState) =>
  JSON.stringify({ mode: s.mode, seed: s.seed, custom: s.custom });

/** Browser dev only: ?nuts=aligned|shuffled|custom, with ?nutseed=N or ?nutangles=a,b,...
 *  for screenshots. Returns null when there's nothing to override. */
export function nutsFromQuery(q: URLSearchParams, base: NutState): NutState | null {
  const mode = q.get("nuts") as NutMode | null;
  if (!mode || !MODES.includes(mode)) return null;
  const seed = Number(q.get("nutseed"));
  const angles = (q.get("nutangles") ?? "").split(",").filter(Boolean).map(Number);
  return {
    mode,
    seed: q.has("nutseed") && Number.isInteger(seed) ? seed >>> 0 : base.seed,
    custom: angles.length
      ? Array.from({ length: NUT_COUNT }, (_, i) => normalise(angles[i] ?? 0))
      : base.custom,
  };
}
