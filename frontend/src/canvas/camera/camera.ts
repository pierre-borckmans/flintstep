// The pedal view's camera: three numbers, and everything on screen derived from them.
//
//   screen = world * scale + translate
//
// Pure arithmetic — no DOM, no React. The rig (./rig) owns the state and the listeners.
// Ported from Beam's board camera; what differs is the zoom range (the fitted pedal up
// to 4x) and the wheel, which zooms here rather than pans.

export interface Pt {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

/** A box in world coordinates. */
export interface Rect extends Pt, Size {}

/** Translation (screen px) + scale. `x`/`y` are where world (0,0) lands on screen. */
export interface Camera {
  x: number;
  y: number;
  scale: number;
}

/** The backstop for a degenerate content box. The real floor is the fitted scale — see
 *  rig's `minScale`. */
export const MIN_ZOOM = 0.1;

/** How far in you may go, as a multiple of the fitted view. */
export const MAX_ZOOM = 4;

/** The camera before anything has moved it. */
export const IDENTITY: Camera = { x: 0, y: 0, scale: 1 };

/** Clamp into the zoom range, snapped to 3 decimals — a trackpad emits hundreds of wheel
 *  events per gesture, and the unsnapped product drifts to 0.9999999999998, which never
 *  compares equal to the 1 the fitted test looks for. */
export function clampScale(s: number, min: number = MIN_ZOOM, max: number = MAX_ZOOM): number {
  return Math.min(max, Math.max(min, +s.toFixed(3)));
}

/** World point → screen point (relative to the viewport's top-left). */
export function toScreen(cam: Camera, p: Pt): Pt {
  return { x: p.x * cam.scale + cam.x, y: p.y * cam.scale + cam.y };
}

/** Screen point (relative to the viewport's top-left) → world point. */
export function toWorld(cam: Camera, p: Pt): Pt {
  return { x: (p.x - cam.x) / cam.scale, y: (p.y - cam.y) / cam.scale };
}

/** Move the camera by a screen-space delta. Pan is only ever this. */
export function panBy(cam: Camera, dx: number, dy: number): Camera {
  return { scale: cam.scale, x: cam.x + dx, y: cam.y + dy };
}

/**
 * Zoom about the screen point `at`, so whatever world point sits under it stays there.
 *
 * Keeping world point p under screen point c means p = (c - t)/s = (c - t')/s', so
 * t' = c - (c - t) * s'/s. The ratio uses the CLAMPED scale, so the anchor still holds
 * exactly at either end of the range: the camera stops rather than sliding.
 */
export function zoomAt(
  cam: Camera,
  at: Pt,
  scale: number,
  min: number = MIN_ZOOM,
  max: number = MAX_ZOOM,
): Camera {
  const s = clampScale(scale, min, max);
  const k = s / cam.scale;
  return { scale: s, x: at.x - (at.x - cam.x) * k, y: at.y - (at.y - cam.y) * k };
}

/** A wheel event's vertical travel in px: lines and pages turned into px, and one notch
 *  capped so a fast wheel does not leap. WKWebView sends px for the trackpad but a mouse
 *  wheel can report lines, and a line-mode delta of 3 taken as 3px feels broken. */
export function wheelPixels(e: { deltaY: number; deltaMode: number }): number {
  const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
  return Math.max(-120, Math.min(120, px));
}

/** The zoom factor for a wheel event: a mouse notch (about 100 px) is ~1.2×, trackpad
 *  scrolls are small and smooth, and a pinch (ctrlKey, in tiny px steps) is steeper.
 *  Exponential, so in by n and out by n comes back to where it started. */
export function wheelFactor(e: { deltaY: number; deltaMode: number; ctrlKey: boolean }): number {
  return Math.exp(-wheelPixels(e) * (e.ctrlKey ? 0.01 : 0.0018));
}

/** Breathing room in world px round the pedal and its pedals: the viewer's old 32px
 *  padding, which is also how far past the drawing a zoomed camera may pan. */
export const PAD = 32;

/** The pannable world box: the drawing's box, padded on all four sides. */
export function contentBounds(box: Size & Partial<Pt>, pad = PAD): Rect {
  return {
    x: (box.x ?? 0) - pad,
    y: (box.y ?? 0) - pad,
    w: box.w + pad * 2,
    h: box.h + pad * 2,
  };
}

/**
 * One axis of the pan clamp, with two genuinely different rules. `lo`/`hi` are the
 * content's extent in SCREEN px at the current scale, before the translation.
 *
 *   - content LONGER than the view → clamp into [b, a], so the view stays inside the
 *     content: no strip of nowhere at an edge.
 *   - content SHORTER → centre it. Every position shows the same thing, and letting it
 *     float means the pedal slides about as an anchored zoom shrinks the legal interval.
 *
 * Per axis, so a layout that fits across but not down centres horizontally and still
 * pans vertically.
 */
function clampAxis(t: number, view: number, lo: number, hi: number): number {
  const a = -lo; // content's leading edge against the view's
  const b = view - hi; // content's trailing edge against the view's
  if (a > b) return Math.min(Math.max(t, b), a);
  return (view - (hi - lo)) / 2 - lo;
}

/** Pull a camera back inside its bounds, centring any axis whose content fits.
 *  Idempotent, and safe to run after any gesture. */
export function clampCamera(cam: Camera, view: Size, content: Rect): Camera {
  const s = cam.scale;
  return {
    scale: s,
    x: clampAxis(cam.x, view.w, content.x * s, (content.x + content.w) * s),
    y: clampAxis(cam.y, view.h, content.y * s, (content.y + content.h) * s),
  };
}

/** The scale at which `content` just fits inside `view`. Both axes, smaller wins. */
export function fitScale(view: Size, content: Rect, min: number = MIN_ZOOM): number {
  if (view.w <= 0 || view.h <= 0 || content.w <= 0 || content.h <= 0) return 1;
  return clampScale(Math.min(view.w / content.w, view.h / content.h), min);
}

/** The camera that centres `content` in `view` at `scale` — the pedal's home position. */
export function centerCamera(view: Size, content: Rect, scale: number): Camera {
  return {
    scale,
    x: (view.w - content.w * scale) / 2 - content.x * scale,
    y: (view.h - content.h * scale) / 2 - content.y * scale,
  };
}

/** "Take me there": centreCamera with the content collapsed to a point. Unclamped, like
 *  every constructor here — the rig's single writer clamps. */
export function centerOnPoint(view: Size, p: Pt, scale: number): Camera {
  return centerCamera(view, { x: p.x, y: p.y, w: 0, h: 0 }, scale);
}
