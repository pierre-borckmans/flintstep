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
  PAD,
  type Pt,
  panBy,
  type Rect,
  type Size,
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
  private settled: Size = { w: 0, h: 0 };
  private content: Rect | null = null;
  /** The room the content was laid out for. While the window is being dragged it is an
   *  older size than `view`, and the camera scales that layout to the new one. */
  private laidFor: Size | null = null;
  private listeners = new Set<(cam: Camera) => void>();
  private viewListeners = new Set<() => void>();
  private roomListeners = new Set<() => void>();

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

  /** The canvas's size right now, every frame of a drag. A stable object. */
  get size(): Size {
    return this.view;
  }

  /** Hears every change of the canvas's size: the renderer, nothing that renders. */
  subscribeView(fn: () => void): () => void {
    this.viewListeners.add(fn);
    return () => this.viewListeners.delete(fn);
  }

  /** THE ROOM: the canvas's size once a resize has stopped. What the scene is laid out
   *  for, so React hears this one and not `size`. A stable object, so it can be a
   *  useSyncExternalStore snapshot. */
  get room(): Size {
    return this.settled;
  }

  subscribeRoom(fn: () => void): () => void {
    this.roomListeners.add(fn);
    return () => this.roomListeners.delete(fn);
  }

  /** Is the canvas a different size from the room its scene was laid out for? True for
   *  the length of a window or divider drag. */
  get resizing(): boolean {
    return this.view.w !== this.settled.w || this.view.h !== this.settled.h;
  }

  /**
   * The canvas changed size: every step of a drag, so this must stay cheap. THE RIG OWNS
   * IT, and everything inside the canvas reads it from here: `<Application>` renders its
   * children into a separate React root, asynchronously, and nothing that changes may
   * cross that boundary as a prop.
   *
   * Nothing is laid out again here. The scene keeps the layout it has, and the camera
   * scales it to fit the new size (see `minScale`), so a drag is a transform write and a
   * redraw. The real layout for the new size comes once it stops: `settle`.
   *
   * A resize always lands fitted, as the DOM viewer always did.
   */
  setView(view: Size): void {
    if (this.view.w === view.w && this.view.h === view.h) return;
    this.view = view;
    this.glide = null;
    // Framed before anyone hears: the renderer draws the new size straight away.
    if (!this.fit(0)) this.write(this.cam, 0);
    for (const fn of this.viewListeners) fn();
  }

  /** The resize has stopped: the room is the canvas's size now, and the scene may be laid
   *  out for it. Its new content arrives through `setContent`. */
  settle(): void {
    if (!this.resizing) return;
    this.settled = this.view;
    for (const fn of this.roomListeners) fn();
  }

  /**
   * The box the camera may travel in, in world px, and the room it was laid out for (the
   * canvas's size, unless the layout is catching up with a resize).
   *
   * A layout for a new room starts fitted, as a resize always has. Any other new box (a
   * pedal plugged in, the layout's spring) leaves the camera the user's and only keeps
   * it legal.
   */
  setContent(content: Rect | null, laidFor: Size = this.view): void {
    const same =
      content &&
      this.content &&
      content.x === this.content.x &&
      content.y === this.content.y &&
      content.w === this.content.w &&
      content.h === this.content.h;
    const relaid = !this.laidFor || this.laidFor.w !== laidFor.w || this.laidFor.h !== laidFor.h;
    if (same && !relaid) return;
    const first = !this.content;
    this.content = content;
    this.laidFor = laidFor;
    // The first content is framed outright; after that the camera is the user's and a
    // new box only keeps it legal.
    if ((first || relaid) && this.fit(0)) return;
    if (this.glide) this.glide = { ...this.glide, to: this.legal(this.glide.to) };
    else this.write(this.cam, 0);
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

  /** HOW FAR OUT YOU MAY ZOOM: until it all fits, and never above 1 — the layout is
   *  already fitted to the canvas, so 1 is the fitted view whenever there is room.
   *
   *  Mid-resize the layout is still the one for the room it was laid out for, so the
   *  fitted view is that one's, scaled by how much bigger or smaller the canvas has got:
   *  measured inside the padding, the way the layout itself is fitted, so the drawing
   *  the drag shows is the size the new layout will land at. */
  get minScale(): number {
    const { w, h } = this.view;
    if (!this.content || w <= 0 || h <= 0) return MIN_ZOOM;
    const base = this.laidFor ?? this.view;
    const fitted = Math.min(1, fitScale(base, this.content, MIN_ZOOM));
    if (base.w === w && base.h === h) return fitted;
    const k = innerFit(this.view, this.content) / innerFit(base, this.content);
    return Math.max(MIN_ZOOM, fitted * (Number.isFinite(k) && k > 0 ? k : 1));
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

/** How far `content` would scale to fit `view` with the padding taken off both: the
 *  drawing's own box in the room it is fitted to. */
function innerFit(view: Size, content: Rect): number {
  const vw = view.w - 2 * PAD;
  const vh = view.h - 2 * PAD;
  const cw = content.w - 2 * PAD;
  const ch = content.h - 2 * PAD;
  if (vw <= 0 || vh <= 0 || cw <= 0 || ch <= 0) return fitScale(view, content, MIN_ZOOM);
  return Math.min(vw / cw, vh / ch);
}
