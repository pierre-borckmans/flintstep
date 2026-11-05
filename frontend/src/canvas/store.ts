import type { Layout, Placement } from "../lib/exppedal";
import type { LinkView } from "../lib/linkview";
import type { NutMode } from "../lib/nuts";
import type { Config, Status } from "../types";
import type { Palette } from "./palette";

// THE STORES THE CANVAS READS, and the only things that cross into it.
//
// `<Application>` renders its children into a separate React root, asynchronously, and
// a stale render can land after a fresh one (Beam's README, "Things that will bite"). So
// nothing that changes crosses that boundary as a prop: the viewer publishes a snapshot
// here, in a layout effect, and the scene subscribes. The objects themselves are made
// once per viewer and never change, which is what makes them safe to hand across.

export type LinkPhase = "in" | "leaving" | "gone";

/** Everything the pedal view draws, as one snapshot. Replaced whole, never mutated. */
export interface SceneData {
  status: Status | null;
  config: Config | null;
  /** The selected switch, or -1 while a lamp or an expression pedal is. */
  selected: number;
  selectedIndicator: 0 | 1 | null;
  selectedExp: 0 | 1 | null;
  /** The AMP/APP lamps can be selected. */
  indicators: boolean;
  engaged: boolean[];
  simulated: boolean[];
  nuts: { mode: NutMode; angles: number[]; peek: boolean };
  palette: Palette;
  /** Where everything is headed: the layout fitted to the canvas. The scene springs
   *  toward it on its own clock. */
  layout: Layout;
  /** The canvas size `layout` was fitted to: the rig's settled room. Mid-drag the canvas
   *  is already another size, and the camera scales this layout to it. */
  room: { w: number; h: number };
  placement: Placement;
  /** Each expression pedal's presence target, 0 or 1 (or a frozen fraction). */
  presence: [number, number];
  /** Bumped when the layout should land at once rather than spring (a resize, the
   *  first frame, reduced motion). */
  snap: number;
  link: { view: LinkView | null; phase: LinkPhase; sweepAt: number | null };
  /** Browser dev only: ?freeze=N holds the link rings N ms into their cycle. */
  freezeMs: number | null;
  reducedMotion: boolean;
  /** The captions' short form (a narrow pedal). */
  short: boolean;
}

export class SceneStore {
  private value: SceneData | null = null;
  private listeners = new Set<() => void>();

  get current(): SceneData | null {
    return this.value;
  }

  set(next: SceneData): void {
    if (next === this.value) return;
    this.value = next;
    for (const fn of this.listeners) fn();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  snapshot = () => this.value;
}

/** WHAT THE POINTER IS OVER. Only notifies when the answer changes, so a hand crossing
 *  the pedal is a handful of renders, not sixty a second (Beam's hoverStore). */
export type HoverTarget =
  | { kind: "switch"; n: number }
  | { kind: "nut"; n: number }
  | { kind: "caption"; n: number }
  | { kind: "indicator"; i: 0 | 1 }
  | { kind: "power" }
  | { kind: "exp"; n: 0 | 1; treadle: boolean }
  | { kind: "jack"; n: 0 | 1 };

export const sameTarget = (a: HoverTarget | null, b: HoverTarget | null): boolean =>
  a === b || (!!a && !!b && JSON.stringify(a) === JSON.stringify(b));

export class Hover {
  private value: HoverTarget | null = null;
  private listeners = new Set<() => void>();

  get current(): HoverTarget | null {
    return this.value;
  }

  set(next: HoverTarget | null): boolean {
    if (sameTarget(this.value, next)) return false;
    this.value = next;
    for (const fn of this.listeners) fn();
    return true;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  snapshot = () => this.value;
}

/**
 * THE ZOOM, as the few things that care hear it: textures that must be re-baked past
 * their headroom, text that must be re-rasterised, hairlines that must stay one CSS
 * pixel wide. Plain callbacks, never React state — a zoom gesture must not render.
 */
export class ZoomWatch {
  /** The scale the scene was last drawn at. */
  scale = 1;
  /** Settled scale: what re-bakes and re-rasterising key on, a beat after a gesture. */
  settled = 1;
  private hairlines = new Set<(px: number) => void>();
  private settles = new Set<(scale: number) => void>();
  private drawnAt = 1;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** One CSS px in world units at the current zoom. */
  get px(): number {
    return 1 / this.scale;
  }

  onHairline(fn: (px: number) => void): () => void {
    this.hairlines.add(fn);
    fn(this.px);
    return () => this.hairlines.delete(fn);
  }

  onSettle(fn: (scale: number) => void): () => void {
    this.settles.add(fn);
    return () => this.settles.delete(fn);
  }

  /** Called by the ticker with the camera's scale. `held` while the canvas is being
   *  resized: the scale is moving because the window is, the layout for the new size is
   *  on its way and lands back near 1, so nothing re-bakes or re-rasterises for it. */
  update(scale: number, held = false): void {
    this.scale = scale;
    // Hairlines redraw when the zoom has moved enough to see: a few short paths.
    if (Math.abs(scale / this.drawnAt - 1) > 0.02) {
      this.drawnAt = scale;
      for (const fn of this.hairlines) fn(1 / scale);
    }
    if (held) {
      clearTimeout(this.timer);
      return;
    }
    if (scale !== this.settled) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.settled = this.scale;
        for (const fn of this.settles) fn(this.settled);
      }, 160);
    }
  }
}

/** The layout and the pedals' presence as they are on screen right now, sprung toward
 *  the store's targets by the ticker. Mutable; read every frame; React never sees it. */
export interface Motion {
  layout: Layout;
  presence: [number, number];
  /** Bumped each frame the layout moved, so readers can skip work when it did not. */
  version: number;
}
