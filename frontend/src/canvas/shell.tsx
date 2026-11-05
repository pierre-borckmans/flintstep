import { useApplication } from "@pixi/react";
import type { Application as PixiApp } from "pixi.js";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { CameraRig } from "./camera/rig";
import { Repaint } from "./repaint";

// THE TWO PIECES EVERY CANVAS NEEDS, and neither of them draws anything (from Beam's
// board/shell): one keeps the renderer the size of its host, the other keeps the render
// loop asleep unless something is happening.

/**
 * Keeps the renderer the size of its host.
 *
 * NOT Pixi's own `resizeTo`, which listens for `window.resize` and nothing else. The
 * viewer is a grid cell that gets its size from layout (and from the split divider), so
 * the renderer follows our own ResizeObserver, through the rig.
 */
export function Resizer({ rig, onReady }: { rig: CameraRig; onReady?: (app: PixiApp) => void }) {
  const { app, isInitialised } = useApplication();
  const size = useSyncExternalStore(
    useCallback((fn) => rig.subscribeView(fn), [rig]),
    () => rig.size,
  );
  useEffect(() => {
    if (!isInitialised) return;
    onReady?.(app);
    if (size.w > 0 && size.h > 0) app.renderer.resize(size.w, size.h);
  }, [app, isInitialised, size, onReady]);
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
