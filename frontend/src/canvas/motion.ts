// MOTION AS ARITHMETIC: the curves and keyframes the canvas animates with, pure so they
// can be tested without a GPU (anim.ts and Rings.tsx run them in the ticker).

/** CSS's cubic-bezier(x1, y1, x2, y2), as a function of time 0..1. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const bez = (a: number, b: number, t: number) =>
    3 * a * (1 - t) * (1 - t) * t + 3 * b * (1 - t) * t * t + t * t * t;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    let t = x;
    for (let i = 0; i < 24; i++) {
      t = (lo + hi) / 2;
      if (bez(x1, x2, t) < x) lo = t;
      else hi = t;
    }
    return bez(y1, y2, t);
  };
}

/** style.css's eases. */
export const EASE = cubicBezier(0.2, 0.6, 0.3, 1);
export const EASE_INCAND = cubicBezier(0.3, 0.75, 0.35, 1);
/** style.css's durations, ms. */
export const DUR = { fast: 100, base: 160, up: 220, down: 340 };

// The link rings (LinkOverlay.css's keyframes, which they replace).
const OUT = { ms: 2100, ease: cubicBezier(0.25, 0.6, 0.35, 1), stagger: 700 };
const IN = { ms: 1050, ease: cubicBezier(0.5, 0, 0.75, 0.6), stagger: 350 };
const COLLAPSE = { ms: 380, ease: cubicBezier(0.55, 0, 0.8, 0.4), stagger: 50 };
const BLOOM = { ms: 560, delay: 260 };

interface Ring {
  /** How far outside the case, px. */
  out: number;
  alpha: number;
}

/** Each ring's spread and alpha, `t` ms into the animation. Pure. */
export function ringsAt(
  mode: "expand" | "converge" | "collapse",
  t: number,
  peak: number,
  reduced: boolean,
): { rings: Ring[]; bloom: number } {
  const rings: Ring[] = [];
  let bloom = 0;
  for (let i = 0; i < 3; i++) {
    if (reduced) {
      if (mode === "collapse") return { rings: [], bloom: 0 };
      rings.push({ out: 18 + i * 30, alpha: peak * (0.7 - i * 0.2) });
      continue;
    }
    if (mode === "expand") {
      // keyframes: 0% ring 4 alpha 0, 14% alpha peak, 100% ring 150 alpha 0
      const k = ((((t + i * OUT.stagger) % OUT.ms) + OUT.ms) % OUT.ms) / OUT.ms;
      const e = OUT.ease(k);
      const a = e < 0.14 ? (e / 0.14) * peak : peak * (1 - (e - 0.14) / 0.86);
      rings.push({ out: 4 + 146 * e, alpha: a });
    } else if (mode === "converge") {
      const k = ((((t + i * IN.stagger) % IN.ms) + IN.ms) % IN.ms) / IN.ms;
      const e = IN.ease(k);
      const a = e < 0.45 ? (e / 0.45) * peak : peak * (1 - (e - 0.45) / 0.55);
      rings.push({ out: 90 * (1 - e), alpha: a });
    } else {
      const k = Math.min(1, Math.max(0, (t - i * COLLAPSE.stagger) / COLLAPSE.ms));
      const e = COLLAPSE.ease(k);
      rings.push({ out: (36 + i * 28) * (1 - e), alpha: k >= 1 ? 0 : peak * (1 - e) });
    }
  }
  if (mode === "collapse" && !reduced) {
    const k = (t - BLOOM.delay) / BLOOM.ms;
    if (k > 0 && k < 1) {
      const e = EASE_INCAND(k);
      bloom = e < 0.3 ? (e / 0.3) * 0.8 : 0.8 * (1 - (e - 0.3) / 0.7);
    }
  }
  return { rings, bloom };
}
