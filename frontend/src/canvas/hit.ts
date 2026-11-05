// WHAT IS UNDER A POINT, worked out rather than listened for (Beam's usePointer). No hit
// areas and no interactive display objects: the layout is a pure function of the data,
// so the same geometry that placed everything says what a point lands on, and a switch
// cannot be somewhere other than where it can be clicked.
//
// Points are in LAYOUT units — the layout's own coordinates (lib/exppedal), which is
// the world with the layout's centring taken off.

import { ART_ASPECT, LABEL, type Layout, SPARK, type UnitBox } from "../lib/exppedal";
import {
  type Box,
  H,
  inBox,
  indicatorBox,
  JACK_X,
  nutAt,
  powerBox,
  switchBox,
  W,
} from "../lib/sparkgeom";
import type { HoverTarget } from "./store";

/** The caption rows: 72 px above and below the case, pt-1 above the top one. */
export const CAPTION_ROW = 72;
export const CAPTION_H = 32;
const PT = 4;

/** The case's place in layout px: its top-left corner and px per viewBox unit. */
export function caseFrame(l: Layout) {
  const k = l.spark.w / W;
  return { x: l.spark.x + SPARK.padX, y: l.spark.y + SPARK.caseTop, k, h: H * k };
}

/** Caption n's box (the switch's mapping, above or below the case). */
export function captionBox(l: Layout, n: number): Box {
  const c = caseFrame(l);
  const w = l.spark.w / 3;
  const top = n < 3;
  const rowTop = top ? l.spark.y + PT : c.y + c.h;
  return {
    x: c.x + (n % 3) * w,
    y: top ? rowTop : rowTop + CAPTION_ROW - CAPTION_H,
    w,
    h: CAPTION_H,
  };
}

/** Where jack n's plug and label sit, along the top caption row's bottom edge. */
export function jackBox(l: Layout, n: number): Box {
  const c = caseFrame(l);
  return { x: c.x + JACK_X[n] * l.spark.w - 8, y: c.y - 30, w: 52, h: 30 };
}

/** An expression pedal's whole box (its art, gauge and readout) and its art alone. */
export function unitBoxes(u: UnitBox): { all: Box; art: Box } {
  const artH = u.w * ART_ASPECT;
  return {
    all: { x: u.x - 8, y: u.y - 6, w: u.w + 16, h: artH + LABEL + 10 },
    art: { x: u.x, y: u.y, w: u.w, h: artH },
  };
}

const scaled = (b: Box, c: { x: number; y: number; k: number }): Box => ({
  x: c.x + b.x * c.k,
  y: c.y + b.y * c.k,
  w: b.w * c.k,
  h: b.h * c.k,
});

export interface Probe {
  layout: Layout;
  /** Which expression pedals are on the canvas (presence past half-way). */
  present: [boolean, boolean];
  /** Which of them are simulated, so their treadle can be pressed. */
  simulated: boolean[];
  /** Match my pedal: the nuts turn by hand. */
  turnable: boolean;
  /** The AMP and APP lamps can be selected. */
  indicators: boolean;
}

/** What the point (x, y) lands on, or null for the bare stage. */
export function probe(p: Probe, x: number, y: number): HoverTarget | null {
  const l = p.layout;
  for (const n of [0, 1] as const) {
    if (!p.present[n]) continue;
    const b = unitBoxes(l.units[n]);
    if (inBox(b.all, x, y))
      return { kind: "exp", n, treadle: !!p.simulated[n] && inBox(b.art, x, y) };
  }
  const c = caseFrame(l);
  for (let n = 0; n < 6; n++) {
    if (p.turnable) {
      const nut = nutAt(n);
      if (Math.hypot(x - (c.x + nut.x * c.k), y - (c.y + nut.y * c.k)) <= nut.r * c.k) {
        return { kind: "nut", n };
      }
    }
    if (inBox(scaled(switchBox(n), c), x, y)) return { kind: "switch", n };
  }
  if (p.indicators) {
    for (const i of [0, 1] as const) {
      if (inBox(scaled(indicatorBox(i), c), x, y)) return { kind: "indicator", i };
    }
  }
  if (inBox(scaled(powerBox(), c), x, y)) return { kind: "power" };
  for (let n = 0; n < 6; n++) {
    if (inBox(captionBox(l, n), x, y)) return { kind: "caption", n };
  }
  for (const n of [0, 1] as const) {
    if (inBox(jackBox(l, n), x, y)) return { kind: "jack", n };
  }
  return null;
}

/** A target's box in layout px, for its tooltip. */
export function targetBox(l: Layout, t: HoverTarget): Box {
  const c = caseFrame(l);
  switch (t.kind) {
    case "switch":
    case "nut":
      return scaled(switchBox(t.n), c);
    case "caption":
      return captionBox(l, t.n);
    case "indicator":
      return scaled(indicatorBox(t.i), c);
    case "power":
      return scaled(powerBox(), c);
    case "exp":
      return unitBoxes(l.units[t.n]).all;
    case "jack":
      return jackBox(l, t.n);
  }
}
