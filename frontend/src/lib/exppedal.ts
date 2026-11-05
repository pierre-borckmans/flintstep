// EXPRESSION PEDALS ON THE CANVAS. The maths behind the pedals drawn next to the Spark:
// how far the treadle tilts, where the gauge puts its marks, where the pedals sit
// (behind the Spark or beside it), how big everything can be in the space there is,
// and the cable from each jack. All in CSS px of the viewer's fitted layout, as
// functions of w, the Spark's case width; nothing here touches the DOM.

import { TRIGGER } from "./trigger";

/** The drawn Spark (components/Pedal.tsx): the case's height per unit of width, the
 *  block round it (px-2, pt-1/pb-1, a 72px caption row above and below), and the EXP
 *  jacks on its back edge as fractions of the case width. */
export const SPARK = {
  aspect: 0.557,
  padX: 8,
  /** From the block's top to the case's top: pt-1 and the top caption row. */
  caseTop: 76,
  /** Everything round the case, top and bottom: pt-1, pb-1 and both caption rows. */
  padY: 152,
  jackX: [0.323, 0.683] as const,
  /** Where a cable goes into the plug drawn on the jack, above the case's top. */
  plug: 12,
};

/** The fitted object keeps this much spare height, as it always has. */
const SLACK_Y = 16;

/** One expression pedal: its drawing is UNIT of the Spark's case width and ART_ASPECT
 *  as tall as it is wide; the gauge and readout under it are LABEL px tall whatever the
 *  size, so they stay legible when the pedal is small. */
export const UNIT = 0.4;
export const ART_ASPECT = 0.3;
export const LABEL = 56;

/** The drawing's own coordinates (viewBox x 0..1000, y y0..y0+h), drawn toe to
 *  the right: the pivot the treadle turns round, and the socket on the heel end where
 *  the cable goes in. */
export const ART = {
  w: 1000,
  y0: 92,
  h: 300,
  pivot: { x: 112, y: 284 },
  socket: { x: 22, y: 332 },
  /** The base's ends. */
  base: { x0: 40, x1: 900 },
};

/** Treadle angle in degrees, toe up positive: rocked back on the heel the toe rises,
 *  pushed down it rests nearly flat on the base. A little more swing than a real pedal
 *  so the position reads at a glance. */
export const TILT = { heel: 9, toe: -0.5 };

/** The treadle's angle for a calibrated position (0 heel .. 1 toe, expFraction). */
export function tiltDeg(f: number): number {
  const c = Math.min(1, Math.max(0, f));
  return TILT.heel + (TILT.toe - TILT.heel) * c;
}

/** The position a treadle dragged by dy px (down positive) from f0 lands on: up is
 *  toward the toe, and `span` px of travel goes from heel to toe. */
export function dragFraction(f0: number, dy: number, span: number): number {
  if (span <= 0) return f0;
  return Math.min(1, Math.max(0, f0 - dy / span));
}

/** The gauge's marks, each as a fraction 0..1 along it from heel to toe. It reads the
 *  value (0..127) the input sends, and on the same track the raw reading and the heel
 *  and toe calibration as fractions of the jack's whole range: the span between H and T
 *  is what gets stretched to the full gauge. */
export interface GaugeMarks {
  value: number | null;
  raw: number | null;
  heel: number;
  toe: number;
  /** The trigger's threshold and where a held trigger lets go, or null with none. */
  threshold: number | null;
  release: number | null;
}

export function gaugeMarks(o: {
  fraction: number | null;
  rawFraction: number | null;
  heelRaw: number;
  toeRaw: number;
  threshold: number | null;
}): GaugeMarks {
  const th = o.threshold;
  return {
    value: o.fraction,
    raw: o.rawFraction,
    heel: o.heelRaw,
    toe: o.toeRaw,
    threshold: th === null ? null : th / 100,
    release: th === null ? null : Math.max(0, th - TRIGGER.hysteresis) / 100,
  };
}

/** "CC 11 · 64", with the channel when it is not 1, or "CC 11 · --" with no reading. */
export function readout(cc: number, channel: number, value: number | null): string {
  const v = value === null ? "--" : String(value);
  return channel === 1 ? `CC ${cc} · ${v}` : `Ch ${channel} · CC ${cc} · ${v}`;
}

// ---- layout ---------------------------------------------------------------------

export type Placement = "behind" | "beside";
export type PlacementPref = "auto" | Placement;

export const EXPPOS_KEY = "sparkx.exppedals.placement";

export function parsePlacement(raw: string | null | undefined): PlacementPref {
  return raw === "behind" || raw === "beside" || raw === "auto" ? raw : "auto";
}

export interface Pt {
  x: number;
  y: number;
}

export interface UnitBox {
  x: number;
  y: number;
  /** The drawing's width; it is ART_ASPECT as tall, and LABEL px of readout follow. */
  w: number;
  /** Drawn heel on the right, toe to the left (EXP 1 behind the Spark). */
  mirror: boolean;
}

export interface Layout {
  /** The whole fitted object. */
  box: { w: number; h: number };
  /** The Spark's block (components/Pedal), its case `w` wide. */
  spark: { x: number; y: number; w: number };
  units: [UnitBox, UnitBox];
}

const GAP_BEHIND = 18;
const GAP_STACK = 18;
/** Room between the Spark's right edge and the pedals beside it, for the cables. */
const besideGap = (w: number) => 0.05 * w + 28;

export const unitHeight = (w: number) => UNIT * w * ART_ASPECT + LABEL;

/** Where everything sits for a Spark case w px wide. `present` says which jacks show a
 *  pedal; with none the box is the Spark alone. A pedal not present is still given the
 *  place it would have, so it can fade in or out there. */
export function layout(placement: Placement, present: [boolean, boolean], w: number): Layout {
  const any = present[0] || present[1];
  const sparkW = w + 2 * SPARK.padX;
  const sparkH = SPARK.aspect * w + SPARK.padY;
  const aw = UNIT * w;
  const uh = unitHeight(w);
  if (placement === "behind") {
    const row = any ? uh + GAP_BEHIND : 0;
    const cx = [0.25, 0.75];
    return {
      box: { w: sparkW, h: row + sparkH },
      spark: { x: 0, y: row, w },
      units: [0, 1].map((n) => ({
        x: SPARK.padX + cx[n] * w - aw / 2,
        y: 0,
        w: aw,
        mirror: n === 0,
      })) as [UnitBox, UnitBox],
    };
  }
  // Beside: a column to the right, EXP 1 above EXP 2, one alone centred, all on the
  // case's middle.
  // With none, both wait in their two-pedal places, so plugging both in spreads nothing.
  const both = present[0] === present[1];
  const stack = both ? 2 * uh + GAP_STACK : uh;
  const colX = sparkW + besideGap(w);
  const boxH = Math.max(sparkH, stack);
  const sparkY = (boxH - sparkH) / 2;
  const mid = sparkY + SPARK.caseTop + (SPARK.aspect * w) / 2;
  const top = Math.max(0, Math.min(boxH - stack, mid - stack / 2));
  const ys: [number, number] = both ? [top, top + uh + GAP_STACK] : [top, top]; // one alone: centred
  return {
    box: { w: any ? colX + aw : sparkW, h: boxH },
    spark: { x: 0, y: sparkY, w },
    units: [0, 1].map((n) => ({ x: colX, y: ys[n], w: aw, mirror: false })) as [UnitBox, UnitBox],
  };
}

/** The biggest Spark case width whose layout fits in `avail` (the viewer's inside, px). */
export function fitWidth(
  placement: Placement,
  present: [boolean, boolean],
  avail: { w: number; h: number },
): number {
  const fits = (w: number) => {
    const b = layout(placement, present, w).box;
    return b.w <= avail.w && b.h <= avail.h - SLACK_Y;
  };
  let lo = 0;
  let hi = Math.max(0, avail.w);
  if (!fits(lo)) return 0;
  for (let i = 0; i < 40 && hi - lo > 0.05; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo * 10) / 10;
}

/** How much bigger the other placement must make the Spark before auto switches to it,
 *  so a resize near the boundary does not flip back and forth. */
export const HYSTERESIS = 1.05;

/** Auto: the placement that gives the Spark the larger fitted size, keeping `current`
 *  unless the other is clearly better. With no pedal there is nothing to choose. */
export function choosePlacement(
  avail: { w: number; h: number },
  present: [boolean, boolean],
  current: Placement,
): Placement {
  if (!present[0] && !present[1]) return current;
  const other: Placement = current === "behind" ? "beside" : "behind";
  const now = fitWidth(current, present, avail);
  const alt = fitWidth(other, present, avail);
  return alt > now * HYSTERESIS ? other : current;
}

// ---- cables ----------------------------------------------------------------------

/** Where a cable goes into the Spark's jack n. */
export function jackPoint(l: Layout, n: number): Pt {
  return {
    x: l.spark.x + SPARK.padX + SPARK.jackX[n] * l.spark.w,
    y: l.spark.y + SPARK.caseTop - SPARK.plug,
  };
}

/** Where a cable goes into a pedal's socket, on its heel end. */
export function socketPoint(u: UnitBox): Pt {
  const k = u.w / ART.w;
  const x = ART.socket.x * k;
  return { x: u.mirror ? u.x + u.w - x : u.x + x, y: u.y + (ART.socket.y - ART.y0) * k };
}

const f1 = (v: number) => Math.round(v * 10) / 10;

/** Behind: from the jack straight back (up), sweeping round into the socket, which
 *  faces away from the pedal; a cubic with a little sag. */
export function cableBehind(jack: Pt, socket: Pt, out: number): string {
  const lead = 34;
  return `M${f1(jack.x)} ${f1(jack.y)} C${f1(jack.x)} ${f1(jack.y - 46)} ${f1(socket.x + out * lead)} ${f1(socket.y + 18)} ${f1(socket.x)} ${f1(socket.y)}`;
}

/** Beside: up off the jack into the band above the case, along it to the right past the
 *  case's corner, down to the pedal's height and into its socket, every corner rounded.
 *  `lane` (0 or 1) keeps two cables apart: EXP 1 runs higher and turns down further
 *  out, so it never crosses EXP 2. */
export function cableBeside(l: Layout, n: number, socket: Pt): string {
  const jack = jackPoint(l, n);
  const caseTop = l.spark.y + SPARK.caseTop;
  const caseRight = l.spark.x + SPARK.padX + l.spark.w;
  const runY = caseTop - (n === 0 ? 30 : 18);
  const gap = socket.x - caseRight;
  const downX = caseRight + gap * (n === 0 ? 0.62 : 0.34);
  return rounded(
    [jack, { x: jack.x, y: runY }, { x: downX, y: runY }, { x: downX, y: socket.y }, socket],
    14,
  );
}

/** A polyline with each inner corner rounded (a quadratic through the corner), the
 *  radius shrunk where the segments are short. */
export function rounded(pts: Pt[], r: number): string {
  if (pts.length < 2) return "";
  let d = `M${f1(pts[0].x)} ${f1(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const la = Math.hypot(b.x - a.x, b.y - a.y);
    const lc = Math.hypot(c.x - b.x, c.y - b.y);
    const k = Math.min(r, la / 2, lc / 2);
    if (k <= 0.01) {
      d += ` L${f1(b.x)} ${f1(b.y)}`;
      continue;
    }
    const p = { x: b.x + ((a.x - b.x) / la) * k, y: b.y + ((a.y - b.y) / la) * k };
    const q = { x: b.x + ((c.x - b.x) / lc) * k, y: b.y + ((c.y - b.y) / lc) * k };
    d += ` L${f1(p.x)} ${f1(p.y)} Q${f1(b.x)} ${f1(b.y)} ${f1(q.x)} ${f1(q.y)}`;
  }
  const z = pts[pts.length - 1];
  return `${d} L${f1(z.x)} ${f1(z.y)}`;
}

// ---- motion ----------------------------------------------------------------------

/** One step of a critically damped spring toward `target` (exact, so any frame time is
 *  stable): no overshoot, no jitter, and it settles in about 4/omega seconds. */
export function springStep(
  x: number,
  v: number,
  target: number,
  dt: number,
  omega: number,
): { x: number; v: number } {
  const d = x - target;
  const b = v + omega * d;
  const e = Math.exp(-omega * dt);
  return { x: target + (d + b * dt) * e, v: (b - omega * (d + b * dt)) * e };
}

/** Linear interpolation of two layouts: what the viewer draws mid-way between them. */
export function lerpLayout(a: Layout, b: Layout, t: number): Layout {
  const m = (p: number, q: number) => p + (q - p) * t;
  const unit = (u: UnitBox, v: UnitBox): UnitBox => ({
    x: m(u.x, v.x),
    y: m(u.y, v.y),
    w: m(u.w, v.w),
    mirror: t < 0.5 ? u.mirror : v.mirror,
  });
  return {
    box: { w: m(a.box.w, b.box.w), h: m(a.box.h, b.box.h) },
    spark: { x: m(a.spark.x, b.spark.x), y: m(a.spark.y, b.spark.y), w: m(a.spark.w, b.spark.w) },
    units: [unit(a.units[0], b.units[0]), unit(a.units[1], b.units[1])],
  };
}

/** A layout as a flat list of numbers (for springs) and back. */
export function flatten(l: Layout): number[] {
  return [
    l.box.w,
    l.box.h,
    l.spark.x,
    l.spark.y,
    l.spark.w,
    ...l.units.flatMap((u) => [u.x, u.y, u.w]),
  ];
}

export function unflatten(v: number[], mirror: [boolean, boolean]): Layout {
  return {
    box: { w: v[0], h: v[1] },
    spark: { x: v[2], y: v[3], w: v[4] },
    units: [
      { x: v[5], y: v[6], w: v[7], mirror: mirror[0] },
      { x: v[8], y: v[9], w: v[10], mirror: mirror[1] },
    ],
  };
}
