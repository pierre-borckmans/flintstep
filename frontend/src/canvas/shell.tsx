import { useApplication } from "@pixi/react";
import type { Application as PixiApp } from "pixi.js";
import { useEffect } from "react";
import type { CameraRig } from "./camera/rig";
import { Repaint } from "./repaint";

// THE TWO PIECES EVERY CANVAS NEEDS, and neither of them draws anything (from Beam's
// board/shell): one keeps the renderer the size of its host, the other keeps the render
// loop asleep unless something is happening.

/**
 * Gives the renderer a FIXED drawing buffer as large as the screen, and keeps it.
 *
 * Why not follow the host: resizing a WebGL canvas while the window is being live-resized
 * flickers in WKWebView, even an empty one (tested: the plain HTML panel did not flicker,
 * the empty canvas did, whatever the timing). So the canvas never changes size during a
 * resize: it is pinned to the viewer's top-left, clipped by the viewer, and the camera
 * (rig.setView, from our own ResizeObserver in Stage) fits the scene into the visible
 * part. The buffer only grows, and only if the host outgrows it (a bigger screen).
 */
export function Resizer({ rig, onReady }: { rig: CameraRig; onReady?: (app: PixiApp) => void }) {
  const { app, isInitialised } = useApplication();
  useEffect(() => {
    if (!isInitialised) return;
    onReady?.(app);
    const fit = () => {
      const { w, h } = rig.size;
      const want = {
        w: Math.max(w, window.screen.width || 0),
        h: Math.max(h, window.screen.height || 0),
      };
      // app.screen is in CSS pixels, like resize(); renderer.width is device pixels.
      const have = app.screen;
      if (want.w > have.width || want.h > have.height) {
        app.renderer.resize(Math.max(want.w, have.width), Math.max(want.h, have.height));
      }
      app.ticker.update();
    };
    fit();
    return rig.subscribeView(fit);
  }, [app, isInitialised, rig, onReady]);
  return null;
}

/**
 * Runs the render loop only while something is happening.
 *
 * Pixi's ticker is stopped by default here (`autoStart={false}`) and started by a mark.
 * An idle pedal therefore costs nothing at all — no GPU, no fans — and any change starts
 * it again for a moment. See Repaint for why it lingers rather than drawing exactly one
 * frame per change.
 */
export function Idle({ rig, repaint }: { rig: CameraRig; repaint: Repaint }) {
  const { app, isInitialised } = useApplication();
  useEffect(() => {
    if (!isInitialised) return;
    const ticker = app.ticker;
    ticker.stop();
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Sleep when there is nothing left to draw, and check again only if there is. No
    // polling loop. A glide keeps it going on its own because it is still moving.
    const settle = () => {
      const left = Math.max(repaint.remainingMs, rig.gliding ? 32 : 0);
      if (left > 0) {
        timer = setTimeout(settle, left + 16);
        return;
      }
      ticker.stop();
    };
    const wake = () => {
      if (!ticker.started) ticker.start();
      clearTimeout(timer);
      timer = setTimeout(settle, Repaint.LINGER_MS + 16);
    };

    const offWake = repaint.onWake(wake);
    // The camera moving is the commonest reason to draw, and the rig already says so.
    const offCam = rig.subscribe(() => repaint.mark());
    // DEV ONLY: Fast Refresh swaps a leaf in place and nothing else marks.
    const hot = (import.meta as { hot?: { on(e: string, fn: () => void): void } }).hot;
    hot?.on("vite:afterUpdate", () => repaint.mark());
    wake();
    return () => {
      clearTimeout(timer);
      offWake();
      offCam();
      ticker.stop();
    };
  }, [app, isInitialised, rig, repaint]);
  return null;
}
