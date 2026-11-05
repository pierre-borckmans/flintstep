import { Texture } from "pixi.js";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// SVG COMPONENTS IN, TEXTURES OUT.
//
// The art is not being redrawn for the canvas. The pedal's case, caps, nuts and the
// expression pedals are pure React SVG components, and they stay exactly as they are —
// they are rendered to a string once, handed to the browser's image
// decoder, and become a texture the GPU can draw a hundred times for nothing.
//
// Rendered to a string, not rasterised through a 2D canvas. A canvas draws outside the
// page's colour management and writes untagged pixels, so on a wide-gamut display the
// same art comes out visibly more saturated than its twin in the DOM. An <img>-decoded
// SVG goes through the same rasteriser and colour space as everything else on screen.
//
// Resolution is the one thing a texture has that markup does not. Each is baked at the
// display's pixel ratio times a headroom factor, so zooming in does not immediately go
// soft; past that it is a re-bake, which is why `textureFor` takes the size it will be
// drawn at rather than guessing.

/** Baked at this multiple of the size the art is drawn at, so the pedal can be zoomed in
 *  a good way before anything looks soft. Past it the art is re-baked for the zoom in
 *  force — see `zoomBucket`. */
const HEADROOM = 2;

/** The largest texture side we ask for. Metal allows more; the memory is not worth it. */
const MAX_PX = 4096;

/** The zoom a bake has to survive, quantised so a gesture re-bakes at most once or twice:
 *  up to 2x the headroom covers it, beyond that the art is baked for 4x. */
export function zoomBucket(scale: number): number {
  return scale > HEADROOM ? 4 : HEADROOM;
}

const cache = new Map<string, Texture>();
const inflight = new Map<string, Promise<Texture | null>>();

function dpr(): number {
  return typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1);
}

/** The pixels a piece of art should be baked at to survive being drawn at `w`, zoomed to
 *  `zoom` (a bucket). Quantised, so a hundred slightly different draw sizes do not become
 *  a hundred textures. */
export function bakeWidth(w: number, zoom = HEADROOM): number {
  const want = w * dpr() * Math.max(HEADROOM, zoom);
  const step = want > 1024 ? 256 : want > 256 ? 64 : 16;
  return Math.min(MAX_PX, Math.ceil(want / step) * step);
}

/**
 * A texture for a piece of SVG art, made once and kept.
 *
 * `key` identifies the ART, not the instance: two pedals of the same model at the same
 * size share one texture, which is the whole reason fifteen amp heads stopped costing
 * anything. Include in it everything that changes the pixels and nothing that does not.
 */
export function textureFor(
  key: string,
  drawWidth: number,
  render: (px: number) => ReactElement,
  zoom = HEADROOM,
): Promise<Texture | null> {
  // The component is rendered AT THE BAKE SIZE, not at the draw size. Our art components
  // all take a width and lay themselves out from it, so asking for the big one is how the
  // texture gets its resolution — scaling a small raster up would only make it soft.
  return bake(key, bakeWidth(drawWidth, zoom), (px) => renderToStaticMarkup(render(px)));
}

async function bake(
  key: string,
  px: number,
  toSvg: (px: number) => string,
): Promise<Texture | null> {
  const id = `${key}@${px}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const running = inflight.get(id);
  if (running) return running;

  const job = (async () => {
    try {
      const svg = withNamespace(toSvg(px));
      if (!svg.includes("<svg")) throw new Error(`${key} did not render an <svg>`);
      const src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      const img = new Image();
      img.src = src;
      await img.decode();
      // RASTERISED HERE, not at upload. An SVG image is only drawn at its size when
      // something asks for its pixels, and texImage2D asking does it synchronously inside
      // the frame: the case's noise filters at a 4x bake held one frame for 676 ms.
      // createImageBitmap does the same work as its own task, between frames.
      const pixels = typeof createImageBitmap === "function" ? await createImageBitmap(img) : img;
      const tex = Texture.from(pixels);
      cache.set(id, tex);
      evict(key);
      return tex;
    } catch (err) {
      // A texture that will not bake is not worth taking the view down for — the sprite
      // shows nothing and the rest is fine. But it must not be SILENT: a missing part
      // looks identical to one still baking.
      console.warn(`[art] ${key} did not bake:`, err);
      return null;
    } finally {
      inflight.delete(id);
    }
  })();
  inflight.set(id, job);
  return job;
}

/** Sizes kept per piece of art. A window drag walks through draw sizes, and a 4x bake of
 *  the case is tens of megabytes: the oldest go once there are more than this. */
const KEEP = 4;

function evict(key: string): void {
  const mine = [...cache.keys()].filter((id) => id.slice(0, id.lastIndexOf("@")) === key);
  for (const id of mine.slice(0, Math.max(0, mine.length - KEEP))) {
    cache.get(id)?.destroy(true);
    cache.delete(id);
  }
}

/** Already in hand? Lets a sprite draw on its first frame instead of popping in. */
export function peekTexture(key: string, drawWidth: number, zoom = HEADROOM): Texture | null {
  return cache.get(`${key}@${bakeWidth(drawWidth, zoom)}`) ?? null;
}

/**
 * Make sure the document declares the SVG namespace.
 *
 * Inline in HTML it is optional — the parser already knows what an `<svg>` is — so none of
 * our components bother, and they are right not to. Loaded as an IMAGE it is a standalone
 * XML document and the namespace is mandatory: without it the decoder rejects the whole
 * thing with "the source image cannot be decoded", which names the symptom and not the
 * cause.
 */
function withNamespace(svg: string): string {
  if (/<svg[^>]*\sxmlns=/i.test(svg)) return svg;
  return svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
}
