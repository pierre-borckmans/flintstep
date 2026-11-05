import { useTick } from "@pixi/react";
import type { Container } from "pixi.js";
import { type RefObject, useCallback, useRef } from "react";
import { useScene } from "./context";
import { cubicBezier, DUR, EASE, EASE_INCAND } from "./motion";

export { cubicBezier, DUR, EASE, EASE_INCAND };

// SMALL MOTIONS AS TICKER CALLBACKS. What CSS transitions did for the DOM pedal — a plate
// fading in, a cap sinking — done on the canvas's own clock: the value eases toward its
// target a frame at a time and keeps the canvas awake (repaint) only while it moves. A
// component re-renders when its TARGET changes, never while it travels.

/** Linear, then eased by the caller: how far `from` → `to` is at `elapsed` of `ms`. */
export const progress = (elapsed: number, ms: number) =>
  ms <= 0 ? 1 : Math.min(1, Math.max(0, elapsed / ms));

/**
 * A number that follows its target over `ms` with `ease`, written to the display object
 * by `apply` each frame it moves. Retargeting mid-flight starts from where it is.
 */
export function useTween(
  target: number,
  ms: number,
  /** Writes the value; false when there is nothing to write it to yet (not mounted). */
  apply: (v: number) => boolean | undefined,
  ease: (t: number) => number = EASE_INCAND,
): void {
  const { repaint, store } = useScene();
  const s = useRef<{ from: number; to: number; at: number; v: number; dirty: boolean } | null>(
    null,
  );
  const live = useRef(apply);
  live.current = apply;
  if (s.current === null) {
    s.current = { from: target, to: target, at: 0, v: target, dirty: true };
  } else if (s.current.to !== target) {
    const instant = store.current?.reducedMotion || ms <= 0;
    s.current = {
      from: s.current.v,
      to: target,
      at: instant ? 0 : performance.now(),
      v: s.current.v,
      dirty: true,
    };
  }
  const tick = useCallback(() => {
    const t = s.current;
    if (!t) return;
    const k = progress(performance.now() - t.at, ms);
    if (!t.dirty && k >= 1) return;
    t.v = k >= 1 ? t.to : t.from + (t.to - t.from) * ease(k);
    const missed = live.current(t.v) === false;
    t.dirty = k < 1 || missed;
    if (!missed) repaint.mark();
  }, [ms, ease, repaint]);
  useTick(tick);
}

/** An alpha that fades between 0 and its full value. */
export function useFade(
  ref: RefObject<Container | null>,
  on: boolean,
  ms = DUR.up,
  full = 1,
): void {
  useTween(on ? full : 0, ms, (v) => {
    const c = ref.current;
    if (!c) return false;
    c.alpha = v;
    c.visible = v > 0.001;
  });
}
