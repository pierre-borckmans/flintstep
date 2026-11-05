/**
 * WHEN THE CANVAS NEEDS TO DRAW, which is almost never.
 *
 * Pixi's loop runs at the display's refresh rate whether or not anything changed, which
 * on an idle board is the GPU redrawing an identical frame sixty times a second. So the
 * ticker is stopped by default: anything that changes the screen calls `mark()`.
 *
 * THE LINGER IS THE WHOLE DESIGN. "Exactly one frame per change" is a trap — a change can
 * land between frames, a texture can arrive a tick late, a glide keeps going on its own —
 * and one missed mark leaves a stale frame with no way to notice. Running on for a moment
 * makes the failure mode "drew more than it had to" rather than "silently stopped".
 */
import { createContext, useContext, useEffect } from "react";

export class Repaint {
  private until = 0;
  private listeners = new Set<() => void>();
  /** Long enough to cover a late texture, a React commit landing after a frame, and the
   *  tail of any interaction; short enough that an idle canvas stops within a blink. */
  static readonly LINGER_MS = 400;

  /** Something changed. Keep drawing for a moment. */
  mark(): void {
    const was = this.active;
    this.until = performance.now() + Repaint.LINGER_MS;
    if (!was) for (const fn of this.listeners) fn();
  }

  /** Called when the canvas goes from idle to busy — and only then, so a listener can
   *  start the loop without anything having to poll for it. */
  onWake(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** How long until it would go idle, if nothing else happens. */
  get remainingMs(): number {
    return Math.max(0, this.until - performance.now());
  }

  /** Is there anything worth drawing right now? */
  get active(): boolean {
    return performance.now() < this.until;
  }
}

/** The stage's Repaint, reachable from anywhere inside the canvas.
 *
 *  Context rather than a prop because it has to reach leaves — a knob, a sprite waiting
 *  on its texture — and threading it down would be exactly the kind of plumbing this
 *  rewrite exists to delete. It crosses the Application boundary safely for the same
 *  reason the jotai store does: the VALUE never changes, only what it is holding. */
export const RepaintContext = createContext<Repaint | null>(null);

/**
 * "This component just re-rendered, so the canvas is out of date."
 *
 * THE RULE, and it is not optional: any component inside the canvas that can re-render on
 * its OWN — because it subscribes to state, or because it is waiting on a texture — must
 * call this. Nothing else notices. React commits its change into the scene graph quite
 * happily while the ticker is stopped, and the result is not an error or a dropped frame,
 * it is the previous frame sitting there looking completely plausible.
 *
 * That is exactly how a wrong number got shipped once already: two screenshots taken
 * either side of an edit came back BYTE-IDENTICAL, because the component had re-rendered
 * and nothing had drawn.
 *
 * Components that only ever re-render because their parent did are already covered by the
 * parent's mark, and do not need it.
 */
export function useRepaint(): void {
  const repaint = useContext(RepaintContext);
  // No dependency array on purpose: "it rendered" IS the condition.
  useEffect(() => repaint?.mark());
}
