import { type CSSProperties, type RefObject, useLayoutEffect, useState } from "react";

/** Where a sliding indicator (Seg's thumb, the tab underline) should sit: under the
 *  child of `box` that matches `active`, measured from the layout so options of any
 *  width work. Re-measures when the box or any option resizes (a font loading, the panel
 *  narrowing). The first placement does not animate; `data-ready` turns the transition
 *  on after it. */
export function useIndicator(
  box: RefObject<HTMLElement | null>,
  active: string,
  deps: unknown[],
): { style: CSSProperties; ready: boolean; shown: boolean } {
  const [pos, setPos] = useState<{ x: number; w: number; on: boolean } | null>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const t = el.querySelector<HTMLElement>(active);
      setPos((p) => {
        // Nothing chosen: fade out where it was rather than collapse to the left.
        if (!t) return p && { ...p, on: false };
        const next = { x: t.offsetLeft, w: t.offsetWidth, on: true };
        return p && p.x === next.x && p.w === next.w && p.on ? p : next;
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const c of el.children) ro.observe(c);
    return () => ro.disconnect();
  }, deps);

  // Turn the transition on once the first position has painted.
  useLayoutEffect(() => {
    if (ready || !pos) return;
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, [pos, ready]);

  return {
    shown: !!pos?.on,
    ready,
    style: pos
      ? { width: pos.w, transform: `translateX(${pos.x}px)`, opacity: pos.on ? 1 : 0 }
      : { width: 0, opacity: 0 },
  };
}
