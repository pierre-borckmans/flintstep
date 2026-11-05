// A PATH AS POINTS, so part of it can be drawn. The cables retract into their jacks as a
// pedal is unplugged: the DOM drew that with stroke-dasharray over a pathLength of 1,
// and a GPU stroke has no dashes. So the cable's path (lib/exppedal's cableBehind /
// cableBeside, which emit M, L, Q and C) is flattened to a polyline once, and each frame
// draws the first `t` of its length.

import type { Pt } from "../lib/exppedal";

const STEPS = 16;

/** Flatten an absolute M/L/Q/C path to a polyline. */
export function flatten(d: string): Pt[] {
  const tokens = d.match(/[MLQC]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const pts: Pt[] = [];
  let i = 0;
  let cmd = "";
  let at: Pt = { x: 0, y: 0 };
  const num = () => Number(tokens[i++]);
  const pt = () => ({ x: num(), y: num() });
  while (i < tokens.length) {
    if (/[MLQC]/i.test(tokens[i])) cmd = tokens[i++].toUpperCase();
    if (cmd === "M") {
      at = pt();
      pts.push(at);
      cmd = "L";
    } else if (cmd === "L") {
      at = pt();
      pts.push(at);
    } else if (cmd === "Q") {
      const c = pt();
      const e = pt();
      for (let s = 1; s <= STEPS; s++) {
        const t = s / STEPS;
        const m = 1 - t;
        pts.push({
          x: m * m * at.x + 2 * m * t * c.x + t * t * e.x,
          y: m * m * at.y + 2 * m * t * c.y + t * t * e.y,
        });
      }
      at = e;
    } else if (cmd === "C") {
      const c1 = pt();
      const c2 = pt();
      const e = pt();
      for (let s = 1; s <= STEPS * 2; s++) {
        const t = s / (STEPS * 2);
        const m = 1 - t;
        pts.push({
          x: m * m * m * at.x + 3 * m * m * t * c1.x + 3 * m * t * t * c2.x + t * t * t * e.x,
          y: m * m * m * at.y + 3 * m * m * t * c1.y + 3 * m * t * t * c2.y + t * t * t * e.y,
        });
      }
      at = e;
    } else {
      i++; // not ours: skip rather than loop for ever
    }
  }
  return pts;
}

/** The first `t` (0..1) of a polyline's length. */
export function head(pts: Pt[], t: number): Pt[] {
  if (pts.length < 2 || t >= 1) return pts;
  if (t <= 0) return pts.slice(0, 1);
  const seg = pts.slice(1).map((p, k) => Math.hypot(p.x - pts[k].x, p.y - pts[k].y));
  let left = seg.reduce((a, b) => a + b, 0) * t;
  const out = [pts[0]];
  for (let k = 0; k < seg.length; k++) {
    if (left >= seg[k]) {
      out.push(pts[k + 1]);
      left -= seg[k];
      continue;
    }
    const f = seg[k] > 0 ? left / seg[k] : 0;
    out.push({
      x: pts[k].x + (pts[k + 1].x - pts[k].x) * f,
      y: pts[k].y + (pts[k + 1].y - pts[k].y) * f,
    });
    break;
  }
  return out;
}
