import { useEffect, useRef } from "react";
import { wheelFactor, wheelPixels } from "./camera";
import type { CameraRig } from "./rig";

/** Total pointer travel, in px, still counted as a tap rather than a pan. Generous
 *  because a trackpad click moves the cursor a pixel or two on its own. */
const TAP_SLOP = 5;

/** A mouse-wheel notch eases to its new zoom over this long; a trackpad's stream of
 *  small deltas is applied as it comes. */
const NOTCH_MS = 140;

/** A drag let go faster than this (px/ms) carries on for a moment, like the pedal has
 *  some weight: `FLING_MS` of glide over `FLING_K` ms' worth of the release speed. */
const FLING_SPEED = 0.35;
const FLING_K = 110;
const FLING_MS = 340;

/** Something on the canvas that has taken the pointer for itself — a nut being turned, a
 *  treadle being pressed. `dx`/`dy` are TOTAL travel from the press in screen px (dy
 *  positive downward); `at` is the pointer now, canvas-relative. */
export interface Grab {
  move(dx: number, dy: number, at: { x: number; y: number }, e: PointerEvent): void;
  end?(moved: boolean): void;
  /** The cursor while it is held. */
  cursor?: string;
}

export interface PointerHandlers {
  /** A press and release with no pan in between, in canvas-relative px. */
  onTap?(at: { x: number; y: number }): void;
  /** Offered every press before the camera takes it. Return a Grab to claim the pointer
   *  — the view will not pan and no tap will be reported unless the grab never moved. */
  onGrab?(at: { x: number; y: number }, e: PointerEvent): Grab | null;
  /** Where the pointer is, when nothing is being dragged (NaN when it left). Returns the
   *  cursor the canvas should wear; "" means "nothing here". */
  onHover?(at: { x: number; y: number }): string;
  /** The platform's own `dblclick`, after the two taps. */
  onDoubleTap?(at: { x: number; y: number }): void;
  /** Offered every wheel event before the camera zooms: true means it was used (a nut in
   *  Match my pedal mode turns under the wheel). */
  onWheel?(at: { x: number; y: number }, e: WheelEvent): boolean;
  /** The camera started moving under the hand: a pan or a wheel zoom. */
  onGesture?(): void;
}

/**
 * Wheel and drag, bound to the canvas. Beam's gesture handling — deltas accumulated and
 * applied once per frame, the zoom anchored on the cursor, the canvas box read once per
 * gesture rather than per event, a tap told from a pan by how far the pointer travelled —
 * with the pedal view's own wheel (it zooms; a pinch is ctrl+wheel and steeper), a fling
 * on release, and a wheel that lets the page scroll when the view is fitted and asked
 * to shrink.
 */
export function usePointerCamera(
  canvas: HTMLCanvasElement | null,
  rig: CameraRig,
  handlers: PointerHandlers = {},
): void {
  // THE HANDLERS GO THROUGH A REF: a pointer pipeline is bound to an element for as long
  // as the element exists; whose function it calls is a detail it should not notice.
  // Rebinding on every render dropped grabs mid-gesture in Beam.
  const live = useRef(handlers);
  live.current = handlers;
  useEffect(() => {
    if (!canvas) return;

    let panX = 0;
    let panY = 0;
    let zoomK = 1;
    let notch = false;
    let at: { x: number; y: number } | null = null;
    let frame = 0;

    const apply = () => {
      frame = 0;
      if (panX || panY) rig.panBy(panX, panY);
      if (zoomK !== 1 && at) {
        if (notch) rig.zoomAt(at, rig.target.scale * zoomK, NOTCH_MS);
        else rig.zoomAt(at, rig.current.scale * zoomK);
      }
      panX = panY = 0;
      zoomK = 1;
      notch = false;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    // The canvas's position, cached for the duration of a gesture: reading it per event
    // forces a synchronous layout twice a frame during a pinch.
    let box: { left: number; top: number } | null = null;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const boxNow = () => {
      if (!box) {
        const r = canvas.getBoundingClientRect();
        box = { left: r.left, top: r.top };
      }
      clearTimeout(idle);
      idle = setTimeout(() => {
        box = null;
      }, 250);
      return box;
    };
    const local = (e: { clientX: number; clientY: number }) => {
      const r = boxNow();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const dropBox = () => {
      box = null;
    };

    const onWheel = (e: WheelEvent) => {
      const p = local(e);
      if (live.current.onWheel?.(p, e)) {
        e.preventDefault();
        return;
      }
      const k = wheelFactor(e);
      // Fitted and asked to shrink: nothing to do, let the page have it.
      if (rig.isFitted() && k <= 1) return;
      e.preventDefault();
      live.current.onGesture?.();
      at = p;
      zoomK *= k;
      notch ||= !e.ctrlKey && Math.abs(wheelPixels(e)) >= 50;
      schedule();
    };

    let drag: {
      id: number;
      x: number;
      y: number;
      moved: number;
      trail: { t: number; x: number; y: number }[];
    } | null = null;
    let held: { grab: Grab; x: number; y: number; moved: boolean } | null = null;

    const cursor = (c: string) => {
      canvas.style.cursor = c;
    };
    const restCursor = () => (rig.isFitted() ? "" : "grab");

    const onLeave = () => {
      if (!held && !drag) live.current.onHover?.({ x: Number.NaN, y: Number.NaN });
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || drag || held) return;
      const p = local(e);
      canvas.setPointerCapture(e.pointerId);
      const grab = live.current.onGrab?.(p, e) ?? null;
      if (grab) {
        held = { grab, x: e.clientX, y: e.clientY, moved: false };
        if (grab.cursor) cursor(grab.cursor);
        return;
      }
      drag = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        moved: 0,
        trail: [{ t: e.timeStamp, x: e.clientX, y: e.clientY }],
      };
    };

    const onMove = (e: PointerEvent) => {
      if (!held && !drag) {
        const hover = live.current.onHover;
        cursor((hover ? hover(local(e)) : "") || restCursor());
        return;
      }
      if (held) {
        const dx = e.clientX - held.x;
        const dy = e.clientY - held.y;
        if (!held.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
        held.moved = true;
        held.grab.move(dx, dy, local(e), e);
        return;
      }
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      const was = drag.moved;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.trail.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
      if (drag.trail.length > 6) drag.trail.shift();
      if (drag.moved <= TAP_SLOP) return;
      if (was <= TAP_SLOP) {
        live.current.onGesture?.();
        if (!rig.isFitted()) cursor("grabbing");
        // The travel inside the slop is owed to the pan too.
        const first = drag.trail[0];
        panX += e.clientX - first.x - dx;
        panY += e.clientY - first.y - dy;
      }
      panX += dx;
      panY += dy;
      schedule();
    };

    const release = (e: PointerEvent) => {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };

    /** Ends whatever was going on; true when it was a tap. */
    const end = (e: PointerEvent, cancelled: boolean): boolean => {
      if (held) {
        const { grab, moved } = held;
        held = null;
        grab.end?.(moved);
        cursor(restCursor());
        release(e);
        return !moved && !cancelled;
      }
      if (!drag || e.pointerId !== drag.id) return false;
      const d = drag;
      drag = null;
      release(e);
      const tap = d.moved <= TAP_SLOP;
      if (!tap && !cancelled) {
        // A fling glides on a little.
        const a = d.trail[0];
        const b = d.trail[d.trail.length - 1];
        const dt = b.t - a.t;
        if (dt > 0 && e.timeStamp - b.t < 60) {
          const vx = (b.x - a.x) / dt;
          const vy = (b.y - a.y) / dt;
          if (Math.hypot(vx, vy) > FLING_SPEED) {
            if (frame) {
              cancelAnimationFrame(frame);
              apply();
            }
            rig.glideBy(vx * FLING_K, vy * FLING_K, FLING_MS);
          }
        }
      }
      cursor(restCursor());
      return tap && !cancelled;
    };
    const onUp = (e: PointerEvent) => {
      const p = local(e);
      if (end(e, false)) live.current.onTap?.(p);
    };
    const onCancel = (e: PointerEvent) => {
      end(e, true);
    };

    const onDouble = (e: MouseEvent) => {
      // Stops the double-click selecting whatever is behind the canvas in the document.
      e.preventDefault();
      live.current.onDoubleTap?.(local(e));
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("dblclick", onDouble);
    canvas.addEventListener("pointercancel", onCancel);
    canvas.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", dropBox);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("dblclick", onDouble);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", dropBox);
      clearTimeout(idle);
      if (frame) cancelAnimationFrame(frame);
      canvas.style.cursor = "";
    };
  }, [canvas, rig]);
}
