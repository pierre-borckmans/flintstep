import type { Camera } from "./camera";

// The camera's animation, as arithmetic.
//
// A glide is a value you can ask about at any moment: it knows where it started, where
// it is going and when it began, so interrupting it is just starting another one from
// where this one had got to. Nothing to cancel, nothing to fight.
//
// A CSS transition cannot do that. It is fire-and-forget, it restarts from wherever it
// happens to be when the value changes again, and it does not know that two properties
// are one movement — which is a board arriving in two travels, or a window drag re-arming
// a 300ms glide on every pixel.

/** Ease-out cubic: fast to leave, slow to settle — an object with mass. Matches
 *  --ease-slide closely enough that the DOM chrome sliding alongside the canvas reads as
 *  one movement. NOT what `glideAt` evaluates — see the Hermite below, of which this is
 *  the zero-velocity case. */
export function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

/** Per-axis rate of change, in units per millisecond. Same shape as a Camera because
 *  every axis moves together and they must not be able to drift apart. */
export type Velocity = Camera;

/** A camera movement in flight. Immutable; `glideAt` reads it, nothing writes it. */
export interface Glide {
  from: Camera;
  to: Camera;
  /** How fast the camera was already moving when this glide was created. Carrying it is
   *  what makes an interruption look like a change of mind rather than a collision. */
  v0: Velocity;
  /** Milliseconds on the same clock `glideAt` is given. */
  start: number;
  ms: number;
}

/**
 * A GLIDE IS A HERMITE, and easeOutCubic is the case where it starts at the speed a
 * standing start would give it.
 *
 * A cubic Hermite is the unique cubic through two points with two given tangents. Take
 * p0=0, p1=1, an outgoing tangent of 3 and an incoming one of 0 and it comes out as
 * `t³ - 3t² + 3t`, which is exactly `1 - (1-t)³`. So easeOutCubic IS this curve, and a
 * fresh glide gets `v0 = 3·(to - from)/ms` and evaluates identically to it.
 *
 * The point of saying it this way is what happens when a glide is CUT OFF. Restarting
 * easeOutCubic from the current position throws the incoming speed away and leaves at
 * full pelt again: interrupt a nearly-finished glide with a nearby target and the camera
 * lurches, because it was crawling and is suddenly sprinting. Hand the new glide the
 * speed the old one had and the join is invisible — the camera bends towards the new
 * target instead of restarting towards it.
 *
 * The landing tangent stays zero either way, so it still arrives at rest, in the time it
 * said it would. That matters: the drawer is sliding for exactly as long, and the two are
 * one event.
 */
function hermite(p0: number, p1: number, v0: number, t: number, ms: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  return h00 * p0 + h10 * ms * v0 + h01 * p1;
}

/** The same curve's slope, in units per ms. */
function hermiteRate(p0: number, p1: number, v0: number, t: number, ms: number): number {
  const t2 = t * t;
  const d00 = 6 * t2 - 6 * t;
  const d10 = 3 * t2 - 4 * t + 1;
  const d01 = -6 * t2 + 6 * t;
  return (d00 * p0 + d10 * ms * v0 + d01 * p1) / ms;
}

const AXES = ["x", "y", "scale"] as const;

/** The speed a glide from `from` to `to` would leave at with no history behind it — the
 *  one that makes the curve easeOutCubic. */
function restingSpeed(from: Camera, to: Camera, ms: number): Velocity {
  const k = 3 / ms;
  return {
    x: (to.x - from.x) * k,
    y: (to.y - from.y) * k,
    scale: (to.scale - from.scale) * k,
  };
}

/**
 * Start a movement.
 *
 * `v0` is the speed the camera is ALREADY travelling at, from whatever was interrupted.
 * Leave it out for a movement that begins from rest and the glide eases out exactly as it
 * always did.
 */
export function makeGlide(
  from: Camera,
  to: Camera,
  ms: number,
  start: number,
  v0?: Velocity,
): Glide {
  return { from, to, ms, start, v0: v0 ?? restingSpeed(from, to, ms) };
}

/** Where a glide is at `now`, and whether it is finished.
 *
 *  Clamped at both ends, so a glide read before it starts gives its first frame and one
 *  read late gives its last — no overshoot from a dropped frame, and no need for the
 *  caller to check the clock before asking. A zero-length glide is simply already done,
 *  which is what makes `glideTo(cam, 0)` a legitimate way to say "go there now". */
export function glideAt(g: Glide, now: number): { cam: Camera; done: boolean } {
  if (g.ms <= 0) return { cam: g.to, done: true };
  const raw = (now - g.start) / g.ms;
  if (raw >= 1) return { cam: g.to, done: true };
  const t = Math.max(0, raw);
  const cam = {} as Camera;
  for (const a of AXES) cam[a] = hermite(g.from[a], g.to[a], g.v0[a], t, g.ms);
  return { cam, done: false };
}

/** How fast a glide is travelling at `now`. Zero once it has landed — it arrives at rest,
 *  which is what makes an interruption AFTER the end behave like a fresh start. */
export function velocityAt(g: Glide, now: number): Velocity {
  if (g.ms <= 0) return { x: 0, y: 0, scale: 0 };
  const raw = (now - g.start) / g.ms;
  if (raw >= 1) return { x: 0, y: 0, scale: 0 };
  const t = Math.max(0, raw);
  const v = {} as Velocity;
  for (const a of AXES) v[a] = hermiteRate(g.from[a], g.to[a], g.v0[a], t, g.ms);
  return v;
}
