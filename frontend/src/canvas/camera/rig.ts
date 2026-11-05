import {
  type Camera,
  centerCamera,
  centerOnPoint,
  clampCamera,
  clampScale,
  fitScale,
  IDENTITY,
  MAX_ZOOM,
  MIN_ZOOM,
  type Pt,
  panBy,
  type Rect,
  type Size,
  toWorld,
  zoomAt,
} from "./camera";
import { type Glide, glideAt, makeGlide, velocityAt } from "./glide";

/**
 * THE CAMERA, and the only thing allowed to move it. Beam's rig, cut down to what the
 * pedal view needs: no drawer inset, no reserved strip.
 *
 * A mutable object rather than React state: the camera changes on every frame of a pan
 * and every frame of a glide, is read once per frame by the ticker, and is written
 * straight onto a container's transform. React never hears about it.
 *
 * The geometry is camera.ts's. This adds an interruptible glide (./glide) and a single
 * writer that cannot be bypassed. Nothing here touches Pixi.
 */
export class CameraRig {
  private cam: Camera = IDENTITY;
  private glide: Glide | null = null;
  private view: Size = { w: 0, h: 0 };
  private content: Rect | null = null;
  private listeners = new Set<(cam: Camera) => void>();
  private viewListeners = new Set<() => void>();

  /** The camera right now. Safe to read every frame; it is not a copy. */
  get current(): Camera {
    return this.cam;
  }

  /** Is a glide in flight? */
  get gliding(): boolean {
    return this.glide !== null;
  }

  /** WHERE THE CAMERA IS HEADED — the end of the glide in flight, or where it is. Anything
   *  that adjusts the framing rather than replacing it (a wheel notch landing mid-glide)
   *  reads this one. */
  get target(): Camera {
    return this.glide ? this.glide.to : this.cam;
  }

  /** Is there anything to frame yet? */
  get framed(): boolean {
    return this.content !== null && this.view.w > 0 && this.view.h > 0;
  }

  /** The canvas's size. A stable object. */
  get size(): Size {
    return this.view;
  }

  /** Hears every change of the canvas's size: the renderer, nothing that renders. */
  subscribeView(fn: () => void): () => void {
    this.viewListeners.add(fn);
    return () => this.viewListeners.delete(fn);
  }

  /**
   * The canvas changed size: every step of a window or divider drag, so it stays cheap.
   * THE RIG OWNS IT, and everything inside the canvas reads it from here: `<Application>`
   * renders its children into a separate React root, and nothing that changes may cross
   * that boundary as a prop.
   *
   * A RESIZE IS A CAMERA FIT AND NOTHING ELSE. The scene is laid out in world units that
   * do not depend on the canvas, so there is nothing to lay out again: a fitted view stays
   * fitted, and a zoomed one keeps its zoom relative to the fit and the world point at its
   * centre.
   */
  setView(view: Size): void {
    if (this.view.w === view.w && this.view.h === view.h) return;
    const was = this.view;
    const fitted = this.isFitted();
    const rel = this.target.scale / this.minScale;
    const mid = toWorld(this.target, { x: was.w / 2, y: was.h / 2 });
    this.view = view;
    this.glide = null;
    // Framed before anyone hears: the renderer draws the new size straight away.
    if (fitted || was.w <= 0 || was.h <= 0) {
      if (!this.fit(0)) this.write(this.cam, 0);
    } else {
      this.write(centerOnPoint(view, mid, rel * this.minScale), 0);
    }
    for (const fn of this.viewListeners) fn();
  }

  /**
   * The box the camera may travel in, in world units. It changes only when the layout
   * does (a pedal plugged in or out, the placement), and the camera glides to fit the new
   * one over `ms`: a framing made for the old layout is framed on something that moved.
   * The first content is framed outright.
   */
  setContent(content: Rect | null, ms = 0): void {
    const same =
      content &&
      this.content &&
      content.x === this.content.x &&
      content.y === this.content.y &&
      content.w === this.content.w &&
      content.h === this.content.h;
    if (same) return;
    const first = !this.content;
    this.content = content;
    if (this.fit(first ? 0 : ms)) return;
    this.write(this.cam, 0);
  }

  /** Put the camera here now. Drags, wheels, anything the hand is doing. */
  moveTo(next: Camera): void {
    this.write(next, 0);
  }

  /** SHOW ME THE WHOLE PEDAL. False when there is nothing to frame yet. */
  fit(ms: number): boolean {
    const want = this.fitCamera();
    if (!want) return false;
    this.write(want, ms);
    return true;
  }

  /** Is the view fitted, or on its way there? */
  isFitted(): boolean {
    return this.target.scale <= this.minScale * 1.001;
  }

  private fitCamera(): Camera | null {
    if (!this.content || this.view.w <= 0 || this.view.h <= 0) return null;
    return this.legal(centerCamera(this.view, this.content, this.minScale));
  }

  /** HOW FAR OUT YOU MAY ZOOM: until it all fits. This is the fitted view's scale, and
   *  it follows the canvas: bigger than 1 in a big window, smaller in a small one. */
  get minScale(): number {
    const { w, h } = this.view;
    if (!this.content || w <= 0 || h <= 0) return MIN_ZOOM;
    return fitScale(this.view, this.content, MIN_ZOOM);
  }

  /** How far in: four times the fitted view. */
  get maxScale(): number {
    return MAX_ZOOM * this.minScale;
  }

  /** Frame world point `p` at `scale`. */
  centerOn(p: Pt, scale: number, ms: number): void {
    if (this.view.w <= 0 || this.view.h <= 0) return;
    this.write(centerOnPoint(this.view, p, scale), ms);
  }

  panBy(dx: number, dy: number): void {
    this.write(panBy(this.cam, dx, dy), 0);
  }

  /** A fling: carry on in the direction of the drag and settle. */
  glideBy(dx: number, dy: number, ms: number): void {
    this.write(panBy(this.cam, dx, dy), ms);
  }

  /** Zoom about a point in screen space. With `ms`, a short glide from wherever the last
   *  one was headed, so a run of mouse-wheel notches adds up rather than restarting. */
  zoomAt(at: Pt, scale: number, ms = 0): void {
    const from = ms > 0 ? this.target : this.cam;
    this.write(zoomAt(from, at, scale, this.minScale, this.maxScale), ms);
  }

  /** Advance to `now` and hand back the camera to draw. Called once per frame by the
   *  ticker and by nobody else. */
  tick(now: number): Camera {
    if (!this.glide) return this.cam;
    const { cam, done } = glideAt(this.glide, now);
    if (done) this.glide = null;
    // Not clamped mid-flight: both ends are legal, and clamping the interpolated value
    // reads as a jump followed by a movement.
    this.cam = done ? this.legal(cam) : cam;
    this.emit();
    return this.cam;
  }

  /** For the DOM drawn over the canvas — the zoom readout, the keyboard layer. They
   *  subscribe rather than being re-rendered by the camera. */
  subscribe(fn: (cam: Camera) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The one writer. Everything is clamped on the way in. */
  private write(next: Camera, ms: number): void {
    const target = this.legal(next);
    if (ms > 0) {
      const now = performance.now();
      // Tell somebody, even though nothing has moved yet: the canvas only draws while
      // something is happening (see Repaint), and this is what wakes it.
      this.emit();
      this.glide = makeGlide(
        this.cam,
        target,
        ms,
        now,
        this.glide ? velocityAt(this.glide, now) : undefined,
      );
      return;
    }
    this.glide = null;
    if (target.x === this.cam.x && target.y === this.cam.y && target.scale === this.cam.scale) {
      return;
    }
    this.cam = target;
    this.emit();
  }

  /** Legal position AND legal scale. */
  private legal(cam: Camera): Camera {
    const { w, h } = this.view;
    if (!(w > 0 && h > 0) || !this.content) return cam;
    const min = this.minScale;
    const scale = clampScale(cam.scale, min, this.maxScale);
    const at = scale === cam.scale ? cam : zoomAt(cam, { x: w / 2, y: h / 2 }, scale, min);
    return clampCamera(at, this.view, this.content);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.cam);
  }
}
