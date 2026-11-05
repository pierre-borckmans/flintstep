import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { springStep } from "./lib/exppedal";

function subscribeMotion(cb: () => void) {
  try {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    m.addEventListener("change", cb);
    return () => m.removeEventListener("change", cb);
  } catch {
    return () => {};
  }
}

function reducedNow() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Whether the user asked for less motion, live. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, reducedNow, () => false);
}

/** Numbers that follow their targets on critically damped springs, one animation frame
 *  at a time, and stop asking for frames once they have settled. With reduced motion
 *  (or `instant`) they are the targets. The first targets are taken as they are. */
export function useSprings(target: number[], omega: number, instant = false): number[] {
  const reduced = useReducedMotion();
  const still = reduced || instant;
  const x = useRef<number[] | null>(null);
  const v = useRef<number[]>([]);
  const goal = useRef(target);
  goal.current = target;
  const [, tick] = useState(0);
  const raf = useRef(0);
  const last = useRef(0);

  if (x.current === null || x.current.length !== target.length || still) {
    x.current = [...target];
    v.current = target.map(() => 0);
  }

  const moving = !still && target.some((t, i) => Math.abs(t - (x.current as number[])[i]) > 0.01);

  useEffect(() => {
    if (!moving || raf.current) return;
    last.current = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - last.current) / 1000));
      last.current = now;
      const xs = x.current as number[];
      let busy = false;
      for (let i = 0; i < xs.length; i++) {
        const s = springStep(xs[i], v.current[i], goal.current[i], dt, omega);
        const near = Math.abs(s.x - goal.current[i]) < 0.01 && Math.abs(s.v) < 0.05;
        xs[i] = near ? goal.current[i] : s.x;
        v.current[i] = near ? 0 : s.v;
        busy ||= !near;
      }
      tick((k) => k + 1);
      raf.current = busy ? requestAnimationFrame(frame) : 0;
    };
    raf.current = requestAnimationFrame(frame);
  });

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return x.current;
}
