import { Application, extend, useApplication } from "@pixi/react";
import { Container, Graphics, type Application as PixiApp, Sprite, Text } from "pixi.js";
import { memo, type ReactNode, type RefObject, useLayoutEffect, useRef } from "react";
import type { CameraRig } from "./camera/rig";
import { type PointerHandlers, usePointerCamera } from "./camera/usePointerCamera";
import { type Scene, SceneContext } from "./context";
import { RepaintContext } from "./repaint";
import { Idle, Resizer } from "./shell";
import { World } from "./World";

// THE PEDAL CANVAS. The pedal, its expression pedals, their cables and everything that
// pans and zooms, drawn by PixiJS (WebGL; Metal underneath in WKWebView) instead of the
// DOM — ported from the architecture Beam's board proved. The connection card, the zoom
// readout and the keyboard layer stay HTML, floating over the canvas.
//
// THE ONE PRINCIPLE: React never re-renders because the camera moved. It builds the
// scene graph when the data changes and at no other time; panning, zooming and gliding
// are transform writes inside the ticker, and the ticker only runs while something is
// changing (repaint.ts).
//
// Things that will bite (Beam's README has the long list): `<Application>` renders its
// children in a separate React root, so nothing that changes crosses it as a prop — see
// store.ts; Pixi's `resizeTo` only hears window.resize, so the renderer follows our own
// ResizeObserver (shell.tsx); headless Chrome with --disable-gpu silently skips sprites.
//
// A RESIZE IS A CAMERA FIT. The scene is laid out once, in world units that do not
// depend on the canvas's size, so a window or divider drag never reaches React: each step
// resizes the renderer and fits the camera (rig.setView), and the picture scales with the
// hand. Nothing is laid out again when the drag ends, so nothing changes shape.

// Pixi's classes have to be registered before they can be written as JSX.
extend({ Container, Graphics, Sprite, Text });

/** Binds the wheel and the drag to the rig, on the canvas the Application made. Guarded
 *  on `isInitialised`: the canvas getter throws until init has finished. */
function Gestures({ scene, handlers }: { scene: Scene; handlers: PointerHandlers }) {
  const { app, isInitialised } = useApplication();
  usePointerCamera(isInitialised ? app.canvas : null, scene.rig, handlers);
  return null;
}

/**
 * Follows the host's size into the rig. Observed directly, not through React state.
 * ResizeObserver reports at most once a frame, after layout, so reading the element's
 * size here forces no extra layout.
 */
function useFollowHost(host: RefObject<HTMLDivElement | null>, rig: CameraRig) {
  // EFFECT: observing the host's size.
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const read = () => rig.setView({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [host, rig]);
}

/** The stage colour from the theme tokens: what the canvas clears to. */
function stageColour(): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue("--color-stage").trim() || "#20231f"
  );
}

/** Keeps the canvas's clear colour on the theme's stage colour when the theme changes:
 *  the <html data-theme> attribute (forced themes) or the system appearance (System). */
function StageColour() {
  const { app, isInitialised } = useApplication();
  // EFFECT: following the theme.
  useLayoutEffect(() => {
    if (!isInitialised) return;
    const apply = () => {
      app.renderer.background.color = stageColour();
      app.ticker.update();
    };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => {
      mo.disconnect();
      mq.removeEventListener("change", apply);
    };
  }, [app, isInitialised]);
  return null;
}

/** Memoised: the viewer re-renders on every status push, and the Application must not —
 *  re-rendering it re-renders the whole scene in its own root. */
export const Stage = memo(function Stage({
  scene,
  handlers,
  onReady,
  children,
}: {
  /** Made once per viewer; stable. */
  scene: Scene;
  /** Stable too: its methods read the latest state through refs. */
  handlers: PointerHandlers;
  /** The Pixi application, once it exists. For screenshot drivers. */
  onReady?: (app: PixiApp) => void;
  /** HTML drawn over the canvas. */
  children?: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  useFollowHost(host, scene.rig);

  return (
    <div ref={host} className="viewer-stage">
      <Application
        autoStart={false}
        antialias
        autoDensity
        resolution={window.devicePixelRatio || 1}
        // OPAQUE, like Beam's board (its floor paints every pixel). A transparent WebGL
        // canvas in WKWebView shows its cleared buffer for a frame on every resize step:
        // the pedal blinked through the whole window drag. Painted with the stage colour
        // and kept in step with the theme (StageColour).
        backgroundAlpha={1}
        background={stageColour()}
        preference="webgl"
        className="viewer-canvas"
      >
        <SceneContext.Provider value={scene}>
          <RepaintContext.Provider value={scene.repaint}>
            <Resizer rig={scene.rig} onReady={onReady} />
            <StageColour />
            <Idle rig={scene.rig} repaint={scene.repaint} />
            <World />
            <Gestures scene={scene} handlers={handlers} />
          </RepaintContext.Provider>
        </SceneContext.Provider>
      </Application>
      {children}
    </div>
  );
});
