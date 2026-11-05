import { CanvasTextMetrics, type Text, type TextStyle } from "pixi.js";

// TEXT ON THE CANVAS. Every distinct string is a raster (Beam's Captions makes the same
// point): fine for a dozen captions that change when the mapping does, and they are kept
// crisp under the zoom by re-rasterising at the settled scale — once per gesture, not
// per frame.

/** `text`, cut with an ellipsis to fit `max` px — CSS's text-overflow, which a canvas
 *  does not have. */
export function fitText(text: string, style: TextStyle, max: number): string {
  if (!text || max <= 0) return "";
  const width = (s: string) => CanvasTextMetrics.measureText(s, style).width;
  if (width(text) <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (width(`${text.slice(0, mid).trimEnd()}…`) <= max) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${text.slice(0, lo).trimEnd()}…` : "";
}

const dpr = () => (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);

/** The resolution text should be rasterised at to stay crisp at `scale`, quantised so a
 *  gesture re-rasterises at most a couple of times. */
export function textResolution(scale: number): number {
  const q = scale <= 1.15 ? 1 : scale <= 2 ? 2 : scale <= 3 ? 3 : 4;
  return dpr() * q;
}

/** Every Text under `root`. */
export function textsIn(root: { children?: unknown[] }, out: Text[] = []): Text[] {
  for (const c of (root.children ?? []) as {
    children?: unknown[];
    resolution?: number;
    text?: unknown;
  }[]) {
    if (typeof c.text === "string" && typeof c.resolution === "number")
      out.push(c as unknown as Text);
    textsIn(c, out);
  }
  return out;
}
