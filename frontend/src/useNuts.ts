import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  bearing,
  easeOutCubic,
  NUT_KEY,
  type NutMode,
  type NutState,
  nearest,
  nextSeed,
  nutsFromQuery,
  parseNuts,
  round1,
  serialiseNuts,
  shownAngles,
  turn,
  wheelStep,
  withAngle,
  withMode,
} from "./lib/nuts";

// The nuts' store: one per window, outside React, saved to localStorage on every change.
// Storage may be missing or refuse writes (private windows, previews); the toy still works,
// it just forgets.

let state: NutState | null = null;
/** Browser dev only (?nutpeek): every readout showing, for screenshots. */
let peek = false;
const subs = new Set<() => void>();

function get(): NutState {
  if (state) return state;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(NUT_KEY);
  } catch {}
  state = parseNuts(raw, nextSeed(0));
  if (document.documentElement.dataset.mock) {
    const q = new URLSearchParams(window.location.search);
    state = nutsFromQuery(q, state) ?? state;
    peek = q.has("nutpeek");
  }
  return state;
}

function set(next: NutState) {
  if (next === state) return;
  state = next;
  try {
    localStorage.setItem(NUT_KEY, serialiseNuts(next));
  } catch {}
  for (const cb of subs) cb();
}

const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => subs.delete(cb);
};

export const nuts = {
  setMode: (mode: NutMode) => set(withMode(get(), mode)),
  shuffle: () => {
    const s = get();
    set({ ...s, mode: "shuffled", seed: nextSeed(s.seed) });
  },
  setAngle: (i: number, deg: number) => set(withAngle(get(), i, deg)),
  resetAll: () => set({ ...get(), custom: Array(6).fill(0) }),
};

/** The nuts' settings, and the angle each one shows. */
export function useNuts() {
  const s = useSyncExternalStore(subscribe, get);
  const angles = useMemo(() => shownAngles(s), [s]);
  return { ...s, angles, peek };
}

const reducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/** The angle to draw: eases to each new target the short way round (a hexagon repeats
 *  every 60°), or jumps there when the motion is the user's own hand, or motion is reduced.
 *  Set `jump.current` just before a change that should land at once. */
export function useNutTween(target: number, ms = 420) {
  const [shown, setShown] = useState(target);
  const at = useRef(target);
  const jump = useRef(false);
  useEffect(() => {
    const from = at.current;
    const to = nearest(from, target);
    const instant = jump.current || reducedMotion();
    jump.current = false;
    const put = (v: number) => {
      at.current = v;
      setShown(v);
    };
    if (to === from) return;
    if (instant) {
      put(to);
      return;
    }
    const t0 = performance.now();
    let raf = requestAnimationFrame(function step(now) {
      const k = easeOutCubic((now - t0) / ms);
      put(from + (to - from) * k);
      if (k < 1) raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return { angle: shown, jump };
}

/** Drag farther than this (CSS px) and it's a turn, not a click. */
const DRAG_PX = 4;

/** Turning a nut by hand, in Match my pedal mode: the wheel or trackpad over the nut, or a
 *  drag round it; Shift for fine steps; double-click puts it back to 0°. A drag swallows the
 *  click that ends it, so it never selects; a plain click still does. `box` is the hit
 *  area in viewBox units, `centre` and `r` the nut's. */
export function useNutGestures({
  index,
  enabled,
  box,
  centre,
  r,
  jump,
}: {
  index: number;
  enabled: boolean;
  box: { x: number; y: number; w: number; h: number };
  centre: { x: number; y: number };
  r: number;
  jump: { current: boolean };
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [over, setOver] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; last: number; angle: number; moved: boolean }>(null);
  const swallow = useRef(false);

  /** A pointer's position in viewBox units. */
  const toView = (e: { clientX: number; clientY: number }) => {
    const rc = ref.current!.getBoundingClientRect();
    return {
      x: box.x + ((e.clientX - rc.left) / rc.width) * box.w,
      y: box.y + ((e.clientY - rc.top) / rc.height) * box.h,
    };
  };
  const onNut = (e: { clientX: number; clientY: number }) => {
    const p = toView(e);
    return Math.hypot(p.x - centre.x, p.y - centre.y) <= r;
  };
  const turnTo = (deg: number) => {
    jump.current = true;
    nuts.setAngle(index, deg);
  };

  // React's wheel listener is passive, and turning a nut mustn't scroll the window
  const latest = useRef({ enabled, onNut, turnTo });
  latest.current = { enabled, onNut, turnTo };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      const l = latest.current;
      if (!l.enabled || !l.onNut(e)) return;
      e.preventDefault();
      l.turnTo(get().custom[index] + wheelStep(e, e.shiftKey));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  useEffect(() => {
    if (!enabled) setOver(false);
  }, [enabled]);

  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      swallow.current = false;
      if (!enabled || e.button !== 0 || !onNut(e)) return;
      const p = toView(e);
      drag.current = {
        x: e.clientX,
        y: e.clientY,
        last: bearing(centre.x, centre.y, p.x, p.y),
        angle: get().custom[index],
        moved: false,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => {
      const d = drag.current;
      if (!d) {
        if (enabled) setOver(onNut(e));
        return;
      }
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_PX) return;
      if (!d.moved) {
        d.moved = true;
        setDragging(true);
      }
      const p = toView(e);
      const now = bearing(centre.x, centre.y, p.x, p.y);
      d.angle += turn(d.last, now) * (e.shiftKey ? 0.25 : 1);
      d.last = now;
      turnTo(e.shiftKey ? round1(d.angle) : Math.round(d.angle));
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      swallow.current = d.moved;
      setDragging(false);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    },
    onPointerCancel: () => {
      drag.current = null;
      setDragging(false);
    },
    onPointerLeave: () => {
      if (!drag.current) setOver(false);
    },
    onDoubleClick: (e: React.MouseEvent<HTMLButtonElement>) => {
      if (enabled && onNut(e)) nuts.setAngle(index, 0);
    },
  };

  /** True when the click that just arrived ended a drag, and should be ignored. */
  const swallowClick = () => {
    const s = swallow.current;
    swallow.current = false;
    return s;
  };

  return { ref, over, dragging, handlers, swallowClick };
}
