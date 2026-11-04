// PEDAL VIEW ZOOM. The view is a scale and a translation applied to the fitted stage:
// a stage point q shows at screen point t + s·q (stage-relative CSS px). s = 1 is the
// fitted view with t = 0; it never goes below that.

export interface View {
  s: number;
  x: number;
  y: number;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const FITTED: View = { s: 1, x: 0, y: 0 };
export const ZOOM = { min: 1, max: 4 };

export const isFitted = (v: View) => v.s <= 1.001;

/** Scales by `factor` keeping the stage point under `p` (screen px) where it is. */
export function zoomAt(v: View, p: { x: number; y: number }, factor: number): View {
  const s = Math.min(ZOOM.max, Math.max(ZOOM.min, v.s * factor));
  const k = s / v.s;
  return { s, x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k };
}

/** One axis: keeps [a, b] (the content, scaled and moved) covering [lo, hi]. */
function clampAxis(t: number, s: number, a: number, b: number, lo: number, hi: number) {
  const min = hi - b * s; // the content's far edge at the region's far edge
  const max = lo - a * s; // its near edge at the region's near edge
  return Math.min(Math.max(t, Math.min(min, max)), Math.max(min, max));
}

/** Keeps the zoomed pedal covering the place it fills when fitted (`content`, in stage
 *  px), so it cannot be dragged out of view; fitted, that pins it to t = 0. */
export function clampView(v: View, content: Rect): View {
  if (isFitted(v)) return FITTED;
  return {
    s: v.s,
    x: clampAxis(v.x, v.s, content.x0, content.x1, content.x0, content.x1),
    y: clampAxis(v.y, v.s, content.y0, content.y1, content.y0, content.y1),
  };
}

/** A wheel event's vertical travel in px: lines and pages turned into px, and one
 *  notch capped so a fast wheel does not leap. */
export function wheelPixels(e: { deltaY: number; deltaMode: number }): number {
  const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
  return Math.max(-120, Math.min(120, px));
}

/** The zoom factor for a wheel event: a mouse notch (about 100 px) is ~1.2×, trackpad
 *  scrolls are small and smooth, and a pinch (ctrlKey, in tiny px steps) is steeper. */
export function wheelFactor(e: { deltaY: number; deltaMode: number; ctrlKey: boolean }): number {
  const px = wheelPixels(e);
  return Math.exp(-px * (e.ctrlKey ? 0.01 : 0.0018));
}

/** The view at scale `s` centred on a point given as fractions of `content` (for a
 *  ?zoom=s,fx,fy screenshot), clamped. */
export function viewAt(
  s: number,
  fx: number,
  fy: number,
  content: Rect,
  size: { w: number; h: number },
): View {
  const scale = Math.min(ZOOM.max, Math.max(ZOOM.min, s));
  const qx = content.x0 + (content.x1 - content.x0) * fx;
  const qy = content.y0 + (content.y1 - content.y0) * fy;
  return clampView({ s: scale, x: size.w / 2 - qx * scale, y: size.h / 2 - qy * scale }, content);
}

/** Pans by a screen delta. */
export const panBy = (v: View, dx: number, dy: number): View => ({
  ...v,
  x: v.x + dx,
  y: v.y + dy,
});
