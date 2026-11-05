import type { Sprite } from "pixi.js";
import {
  createContext,
  type ReactElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { peekTexture, textureFor, zoomBucket } from "./art/svgTexture";
import type { CameraRig } from "./camera/rig";
import { type Repaint, useRepaint } from "./repaint";
import type { Hover, HoverTarget, Motion, SceneData, SceneStore, ZoomWatch } from "./store";

/** Everything the scene shares, made once per viewer. Stable, so it may cross the
 *  Application boundary (see store.ts). */
export interface Scene {
  rig: CameraRig;
  repaint: Repaint;
  hover: Hover;
  store: SceneStore;
  zoom: ZoomWatch;
  motion: Motion;
}

export const SceneContext = createContext<Scene | null>(null);

export function useScene(): Scene {
  const s = useContext(SceneContext);
  if (!s) throw new Error("useScene: not inside the pedal canvas");
  return s;
}

/** The snapshot, re-rendering when the viewer publishes a new one — and, because the
 *  component re-rendered on its own, owing the canvas a frame (see repaint.ts). */
export function useSceneData(): SceneData | null {
  const { store } = useScene();
  const data = useSyncExternalStore(store.subscribe, store.snapshot);
  useRepaint();
  return data;
}

/** What the pointer is over. Changes a few times a second, never per frame. */
export function useHover(): HoverTarget | null {
  const { hover } = useScene();
  const h = useSyncExternalStore(hover.subscribe, hover.snapshot);
  useRepaint();
  return h;
}

/**
 * A baked texture for a piece of SVG art, and the scale to draw it at so it comes out
 * `drawWidth` world px wide.
 *
 * Synchronous when the cache already has it, so a sprite that has its texture on its
 * first render never pops in (Beam's useArtTexture). On top of that it RE-BAKES PAST THE
 * HEADROOM: once a zoom or a resize settles beyond what the bake can take, the art is
 * baked again for the new scale in the background and swapped onto the sprite directly —
 * a texture and a scale on one display object, not a React render. Never down: a bigger
 * bake is still sharp smaller. Pass `zoom: false` for art that is soft anyway
 * (glows, shadows). `unit` is how many world px one unit of the sprite's parent is (a
 * sprite inside the case is drawn in viewBox units, `k` px each).
 */
export function useBaked(
  key: string,
  drawWidth: number,
  render: (px: number) => ReactElement,
  opts: { zoom?: boolean; unit?: number } = {},
): { ref: (s: Sprite | null) => void; texture: Sprite["texture"] | null; scale: number } {
  const { zoom, repaint } = useScene();
  const follows = opts.zoom !== false;
  const bucket = () => (follows ? zoomBucket(zoom.settled) : 2);
  const [tex, setTex] = useState(() => peekTexture(key, drawWidth, bucket()));
  const sprite = useRef<Sprite | null>(null);
  const baked = useRef(bucket());
  const unit = opts.unit ?? 1;
  const live = useRef({ key, drawWidth, render, unit });
  live.current = { key, drawWidth, render, unit };
  useRepaint();

  useEffect(() => {
    const b = Math.max(baked.current, bucket());
    baked.current = b;
    const ready = peekTexture(key, drawWidth, b);
    if (ready) {
      setTex(ready);
      return;
    }
    let on = true;
    textureFor(key, drawWidth, live.current.render, b).then((t) => {
      if (on && t) setTex(t);
    });
    return () => {
      on = false;
    };
    // `render` deliberately not a dependency: the key is the promise that the same key
    // means the same pixels.
  }, [key, drawWidth]);

  useEffect(() => {
    if (!follows) return;
    return zoom.onSettle((scale) => {
      const b = zoomBucket(scale);
      if (b <= baked.current) return;
      baked.current = b;
      const { key: k, drawWidth: w, render: r } = live.current;
      textureFor(k, w, r, b).then((t) => {
        const s = sprite.current;
        if (!t || !s || s.destroyed || live.current.key !== k || s.texture === t) return;
        s.texture = t;
        s.scale.set(live.current.drawWidth / live.current.unit / t.width);
        repaint.mark();
      });
    });
  }, [zoom, follows, repaint]);

  const ref = useCallback((s: Sprite | null) => {
    sprite.current = s;
  }, []);
  return { ref, texture: tex, scale: tex ? drawWidth / unit / tex.width : 1 };
}
