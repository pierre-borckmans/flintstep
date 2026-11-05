import { useApplication } from "@pixi/react";
import type { Application as PixiApp } from "pixi.js";
import { useEffect } from "react";
import type { CameraRig } from "./camera/rig";
import { Repaint } from "./repaint";

// THE TWO PIECES EVERY CANVAS NEEDS, and neither of them draws anything (from Beam's
// board/shell): one keeps the renderer the size of its host, the other keeps the render
// loop asleep unless something is happening.

/** Mid-drag, the drawing buffer is stretched up to this far either way before it is
 *  worth a new one. Past it the stretch would start to show as blur. */
const STRETCH = 1.25;

/**
 * Keeps the renderer the size of its host.
 *
 * NOT Pixi's own `resizeTo`, which listens for `window.resize` and nothing else. The
 * viewer is a grid cell that gets its size from layout (and from the split divider), so
 * the renderer follows our own ResizeObserver, through the rig.
 *
 * A NEW DRAWING BUFFER IS EXPENSIVE: a few ms at 2x on every step of a drag, plus a
 * cleared canvas until the next draw. So the canvas element is always 100% of its host
 * (CSS, `.viewer-canvas`), and mid-drag the buffer it already has is stretched to fit it,
 * with the stage scaled back the other way so the drawing comes out the right shape. The
 * buffer is reallocated only when the stretch passes STRETCH, and once more, exactly,
 * when the resize settles. Not a React render in any of it: a subscription.
 *
 * Each step draws at once, inside the ResizeObserver callback, so the frame the browser
 * paints is the new size and never the old drawing stretched.
 */
export function Resizer({ rig, onReady }: { rig: CameraRig; onReady?: (app: PixiApp) => void }) {
  const { app, isInitialised } = useApplication();
  useEffect(() => {
    if (!isInitialised) return;
    onReady?.(app);
    let bw = 0;
    let bh = 0;
    const follow = (exact: boolean) => {
      const { w, h } = rig.size;
      if (w <= 0 || h <= 0) return;
      const far = (a: number, b: number) => a > b * STRETCH || b > a * STRETCH;
      if (exact || bw <= 0 || far(w, bw) || far(h, bh)) {
        if (w !== bw || h !== bh) app.renderer.resize(w, h);
        bw = w;
        bh = h;
      }
      app.stage.scale.set(bw / w, bh / h);
      app.ticker.update();
    };
    follow(true);
    const offView = rig.subscribeView(() => follow(!rig.resizing));
    const offRoom = rig.subscribeRoom(() => follow(true));
    return () => {
      offView();
      offRoom();
    };
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
