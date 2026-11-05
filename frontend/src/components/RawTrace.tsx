import { useEffect, useRef } from "react";
import { expFraction, RAW_MAX } from "../lib/exp";
import { lastSample, type Ring, TRACE_MS, tracePoints, windowed } from "../lib/trace";
import { useReducedMotion } from "../useReducedMotion";

/** Most frames a second the trace draws; under reduced motion it steps at this. */
const FPS = 30;
const REDUCED_EVERY_MS = 500;
const HEIGHT = 64;

interface Palette {
  line: string;
  out: string;
  mark: string;
  grid: string;
  text: string;
  band: string;
}

function readPalette(el: Element): Palette {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const cold = v("--color-cold", "#c9e4f2");
  return {
    line: cold,
    out: v("--color-faint", "#858c80"),
    mark: v("--color-beam", "#d6bc83"),
    grid: v("--color-edge", "#30332e"),
    text: v("--color-muted", "#a3a89d"),
    band: cold,
  };
}

const fmt = (n: number) => String(Math.round(n));

/** Strokes a polyline, `dy` down. */
function line(ctx: CanvasRenderingContext2D, pts: [number, number][], dy: number) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    if (i) ctx.lineTo(x, y + dy);
    else ctx.moveTo(x, y + dy);
  });
  ctx.stroke();
}

/** The last 8 s of an input's raw value (0..65535, bottom to top), with the heel and
 *  toe lines, and faintly the value going out (0..127 on the same height). While a
 *  sweep runs, the band it has covered so far. Drawn on a canvas at up to 30 fps, only
 *  while on screen and the window shows; under reduced motion a still redrawn twice a
 *  second. */
export function RawTrace({
  ring,
  n,
  min,
  max,
  invert,
  swept,
  watch,
}: {
  ring: Ring;
  n: number;
  min: number;
  max: number;
  invert: boolean;
  /** The extremes a running sweep has kept, or null. */
  swept: { low: number; high: number } | null;
  /** Starts the raw stream; returns the stop. */
  watch: () => () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  // The draw loop reads the latest props without restarting.
  const props = useRef({ min, max, invert, swept });
  props.current = { min, max, invert, swept };

  useEffect(() => {
    const el = canvas.current;
    const wrap = box.current;
    const ctx = el?.getContext("2d");
    if (!el || !wrap || !ctx) return;
    let palette = readPalette(wrap);
    let paletteAt = 0;
    let width = 0;
    let visible = false;
    let frame = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    let lastDraw = 0;
    let stopWatch: (() => void) | null = null;

    const size = () => {
      const dpr = window.devicePixelRatio || 1;
      width = wrap.clientWidth;
      el.width = Math.max(1, Math.round(width * dpr));
      el.height = Math.round(HEIGHT * dpr);
      el.style.width = `${width}px`;
      el.style.height = `${HEIGHT}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      const now = Date.now();
      if (now - paletteAt > 500) {
        palette = readPalette(wrap); // the theme may have changed
        paletteAt = now;
      }
      const { min: heel, max: toe, invert: inv, swept: sw } = props.current;
      const w = width;
      const h = HEIGHT;
      const pad = 6;
      const ih = h - pad * 2;
      const y = (raw: number) => pad + ih - (Math.min(RAW_MAX, Math.max(0, raw)) / RAW_MAX) * ih;
      ctx.clearRect(0, 0, w, h);

      // Quarter lines of the jack's range.
      ctx.strokeStyle = palette.grid;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      for (const f of [0, 0.5, 1]) {
        const yy = Math.round(pad + ih * f) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, yy);
        ctx.lineTo(w, yy);
        ctx.stroke();
      }

      if (sw && sw.low >= 0) {
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = palette.band;
        ctx.fillRect(0, y(sw.high), w, Math.max(1, y(sw.low) - y(sw.high)));
        ctx.globalAlpha = 1;
      }

      // Heel and toe.
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = palette.mark;
      ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textBaseline = "middle";
      for (const [label, raw] of [
        ["H", heel],
        ["T", toe],
      ] as const) {
        const yy = Math.round(y(raw)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(12, yy);
        ctx.lineTo(w, yy);
        ctx.stroke();
        ctx.fillStyle = palette.mark;
        ctx.fillText(label, 2, yy);
      }
      ctx.setLineDash([]);

      const samples = windowed(ring, now, TRACE_MS);
      if (samples.length > 0) {
        // The value going out, 0..127, faint, on the same height.
        const cfg = { min: heel, max: toe, invert: inv };
        const out = samples.map(
          ([t, v]) => [t, (expFraction(v, cfg) ?? 0) * RAW_MAX] as [number, number],
        );
        ctx.strokeStyle = palette.out;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1;
        line(ctx, tracePoints(out, now, w, ih, 0, RAW_MAX), pad);
        ctx.globalAlpha = 1;

        ctx.strokeStyle = palette.line;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = "round";
        line(ctx, tracePoints(samples, now, w, ih, 0, RAW_MAX), pad);

        const last = lastSample(ring);
        if (last) {
          const yy = y(last.v);
          ctx.fillStyle = palette.line;
          ctx.beginPath();
          ctx.arc(w - 2, yy, 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = palette.text;
          ctx.textAlign = "right";
          ctx.fillText(fmt(last.v), w - 8, Math.min(h - 6, Math.max(6, yy - 8)));
          ctx.textAlign = "left";
        }
      }
    };

    const loop = (t: number) => {
      frame = requestAnimationFrame(loop);
      if (t - lastDraw < 1000 / FPS - 1) return;
      lastDraw = t;
      draw();
    };

    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (timer) clearInterval(timer);
      timer = null;
      stopWatch?.();
      stopWatch = null;
    };
    const run = () => {
      stop();
      if (!visible || document.hidden) {
        draw(); // a last still, so it is right when it comes back
        return;
      }
      stopWatch = watch();
      if (reduced) {
        draw();
        timer = setInterval(draw, REDUCED_EVERY_MS);
      } else frame = requestAnimationFrame(loop);
    };

    size();
    const ro = new ResizeObserver(() => {
      size();
      draw();
    });
    ro.observe(wrap);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      run();
    });
    io.observe(wrap);
    document.addEventListener("visibilitychange", run);
    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", run);
    };
  }, [ring, reduced, watch]);

  return (
    <div
      ref={box}
      className="relative overflow-hidden rounded-[3px] bg-sunken inset-shadow-deep"
      role="img"
      aria-label={`EXP ${n + 1} raw input over the last 8 seconds, heel at ${min}, toe at ${max}`}
      title={
        "Raw input, last 8 s (0–65535, bottom to top)\nH and T: heel and toe\nFaint line: the value going out"
      }
    >
      <canvas ref={canvas} className="block" />
    </div>
  );
}
