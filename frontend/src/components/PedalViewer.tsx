import { RotateCcw } from "lucide-react";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import type { Backend } from "../api";
import {
  choosePlacement,
  fitWidth,
  flatten,
  type Layout,
  layout as layoutFor,
  lerpLayout,
  type Placement,
  SPARK,
  unflatten,
} from "../lib/exppedal";
import {
  clampView,
  FITTED,
  isFitted,
  panBy,
  type Rect,
  type View,
  viewAt,
  wheelFactor,
  zoomAt,
} from "../lib/zoom";
import { cx } from "../ui/cx";
import { useExpPlacement } from "../useExpPlacement";
import { useSprings } from "../useSprings";
import { ExpCables, ExpPedals, SimulateHints } from "./ExpPedals";
import { LinkCard, LinkRings, useLink } from "./LinkOverlay";
import { Pedal } from "./Pedal";

/** Drag farther than this (CSS px) and it pans rather than clicks. */
const PAN_PX = 4;

/** How the view gets to a new value: a wheel step eases there, a reset or a fling
 *  settles like a panel (incandescent), a drag follows the hand. */
type Motion = "follow" | "wheel" | "settle" | "glide";
const TRANSITION: Record<Motion, string> = {
  follow: "none",
  wheel: "transform var(--dur) var(--ease)",
  settle: "transform var(--dur-up) var(--ease-incand)",
  glide: "transform var(--dur-down) var(--ease-incand)",
};

/** Browser dev only: ?zoom=2.5,0.3,0.4 opens zoomed 2.5x on that point of the pedal. */
function zoomFromQuery(): [number, number, number] | null {
  if (!document.documentElement.dataset.mock) return null;
  const raw = new URLSearchParams(window.location.search).get("zoom");
  const n = raw?.split(",").map(Number);
  if (n?.length !== 3 || n.some((v) => !Number.isFinite(v))) return null;
  return n as [number, number, number];
}

/** Browser dev only: ?expfreeze=0.5 holds the expression pedals half-way in. */
function freezeFromQuery(): number | null {
  if (!document.documentElement.dataset.mock) return null;
  const raw = new URLSearchParams(window.location.search).get("expfreeze");
  const v = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
}

/** How the pedals settle into a new layout: a critically damped spring, ~0.3 s. */
const LAYOUT_OMEGA = 15;

/** Where the plugged-in expression pedals go and how big everything is: the target
 *  layout for the space there is, sprung toward so appearing, leaving and switching
 *  placement all glide. */
function useCanvasLayout(avail: { w: number; h: number } | null, present: [boolean, boolean]) {
  const pref = useExpPlacement();
  const [FREEZE] = useState(freezeFromQuery);
  const auto = useRef<Placement>("behind");
  let placement: Placement = pref === "auto" ? auto.current : pref;
  if (pref === "auto" && avail) {
    placement = choosePlacement(avail, present, auto.current);
    auto.current = placement;
  }
  const size = avail ?? { w: 480, h: 480 };
  const w = fitWidth(placement, present, size);
  let target: Layout = layoutFor(placement, present, w);
  const want = [present[0] ? 1 : 0, present[1] ? 1 : 0];
  if (FREEZE !== null) {
    const none = layoutFor(placement, [false, false], fitWidth(placement, [false, false], size));
    target = lerpLayout(none, target, FREEZE);
    want[0] *= FREEZE;
    want[1] *= FREEZE;
  }
  // Nothing glides while the window opens (the first size and State land as they are),
  // nor while it is resized, where the canvas follows the hand; a placement that flips
  // during a resize still glides to its new side.
  const born = useRef(performance.now());
  const opening = performance.now() - born.current < 800;
  const last = useRef({ size: "", placement });
  const sizeKey = avail ? `${avail.w}x${avail.h}` : "";
  const resized = sizeKey !== last.current.size && placement === last.current.placement;
  last.current = { size: sizeKey, placement };
  const v = useSprings(
    [...flatten(target), ...want],
    LAYOUT_OMEGA,
    !avail || opening || resized || FREEZE !== null,
  );
  const mirror: [boolean, boolean] = [target.units[0].mirror, target.units[1].mirror];
  return { placement, layout: unflatten(v, mirror), presence: v.slice(-2) };
}

/** Keep the entire pedal and its mapping captions inside the available space, and let
 *  it be looked at closer: the wheel (or a pinch) zooms toward the pointer, a drag pans
 *  while zoomed, a double-click away from the controls fits it again. The wheel over a
 *  nut in Match my pedal mode still turns the nut (it claims the event first). */
export function PedalViewer({
  backend,
  engaged = [],
  simulated = [],
  selectedExp = null,
  onSelectExp,
  ...props
}: ComponentProps<typeof Pedal> & {
  backend: Backend;
  /** Each input's trigger engaged now (State.expTrigger). */
  engaged?: boolean[];
  /** Each jack's pedal simulated (State.expSim). */
  simulated?: boolean[];
  selectedExp?: 0 | 1 | null;
  onSelectExp?: (n: 0 | 1) => void;
}) {
  const viewer = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const object = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState<{ w: number; h: number } | null>(null);
  const [view, setViewState] = useState<View>(FITTED);
  const [motion, setMotion] = useState<Motion>("follow");
  const [panning, setPanning] = useState(false);
  const current = useRef(view);
  const pan = useRef<{
    id: number;
    x: number;
    y: number;
    from: View;
    moved: boolean;
    trail: { t: number; x: number; y: number }[];
  } | null>(null);
  const swallow = useRef(false);
  const link = useLink(props.status, props.config);
  const status = props.status && { ...props.status, lamps: link.lamps(props.status.lamps) };
  const cables = props.status?.cables;
  const present: [boolean, boolean] = [!!cables?.[0], !!cables?.[1]];
  const canvas = useCanvasLayout(avail, present);
  const { layout } = canvas;
  /** The case in the fitted object's px, for the rings drawn round it. */
  const [caseRect, setCaseRect] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );

  const setView = (v: View, m: Motion) => {
    current.current = v;
    setViewState(v);
    setMotion(m);
  };
  /** Where the pedal sits when fitted, in stage px (offsets ignore the transform). */
  const content = (): Rect => {
    const o = object.current;
    if (!o) return { x0: 0, y0: 0, x1: 0, y1: 0 };
    return {
      x0: o.offsetLeft,
      y0: o.offsetTop,
      x1: o.offsetLeft + o.offsetWidth,
      y1: o.offsetTop + o.offsetHeight,
    };
  };
  const local = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const reset = () => setView(FITTED, "settle");

  useEffect(() => {
    const el = viewer.current;
    if (!el) return;
    let size = "";
    let pending = zoomFromQuery();
    const observer = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect;
      // Observe the grid-sized outer panel, not its content: WebKit can size
      // a flex child from the pedal itself, creating a resize feedback loop.
      setAvail({ w: Math.max(0, w - 64), h: Math.max(0, h - 64) });
      // A new size moves the fitted pedal under the zoom: start again from fitted.
      const next = `${w}x${h}`;
      if (size && next !== size) setView(FITTED, "follow");
      size = next;
      if (pending) {
        const [s, fx, fy] = pending;
        pending = null;
        requestAnimationFrame(() => setView(viewAt(s, fx, fy, content(), { w, h }), "follow"));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const o = object.current;
    const body = o?.querySelector<HTMLElement>(".pedal-body");
    if (!o || !body) return;
    const measure = () => {
      const a = o.getBoundingClientRect();
      const b = body.getBoundingClientRect();
      const k = o.offsetWidth ? a.width / o.offsetWidth : 1; // undo the zoom
      if (!k) return;
      setCaseRect({
        x: (b.left - a.left) / k,
        y: (b.top - a.top) / k,
        w: b.width / k,
        h: b.height / k,
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    observer.observe(o);
    return () => observer.disconnect();
  }, []);

  // React's wheel listener is passive; zooming must not scroll anything.
  useEffect(() => {
    const el = viewer.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.defaultPrevented) return; // a nut turned
      if ((e.target as Element).closest("[data-link-card]")) return; // its list scrolls
      const factor = wheelFactor(e);
      const v = current.current;
      // Fitted and asked to shrink: nothing to do, let the page have it.
      if (isFitted(v) && factor <= 1) return;
      e.preventDefault();
      setView(clampView(zoomAt(v, local(e), factor), content()), "wheel");
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomed = !isFitted(view);
  // The readout keeps its last figure while it fades out.
  const shownZoom = useRef(100);
  if (zoomed) shownZoom.current = Math.round(view.s * 100);

  return (
    <section
      ref={viewer}
      className="pedal-viewer"
      aria-label="Pedal viewer"
      data-zoomed={zoomed || undefined}
      data-panning={panning || undefined}
      onPointerDown={(e) => {
        swallow.current = false;
        if (e.button !== 0 || isFitted(current.current)) return;
        if ((e.target as Element).closest("[data-zoom-reset], [data-link-card]")) return;
        const p = local(e);
        pan.current = {
          id: e.pointerId,
          x: p.x,
          y: p.y,
          from: current.current,
          moved: false,
          trail: [{ t: e.timeStamp, ...p }],
        };
      }}
      onPointerMove={(e) => {
        const d = pan.current;
        if (!d || d.id !== e.pointerId) return;
        const p = local(e);
        if (!d.moved) {
          if (Math.hypot(p.x - d.x, p.y - d.y) < PAN_PX) return;
          d.moved = true;
          setPanning(true);
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        d.trail.push({ t: e.timeStamp, ...p });
        if (d.trail.length > 6) d.trail.shift();
        setView(clampView(panBy(d.from, p.x - d.x, p.y - d.y), content()), "follow");
      }}
      onPointerUp={(e) => {
        const d = pan.current;
        if (!d || d.id !== e.pointerId) return;
        pan.current = null;
        if (!d.moved) return;
        swallow.current = true; // the click this ends is not a selection
        setPanning(false);
        // A fling glides on a little, like the pedal has some weight.
        const a = d.trail[0];
        const b = d.trail[d.trail.length - 1];
        const dt = b.t - a.t;
        if (dt > 0 && e.timeStamp - b.t < 60) {
          const vx = (b.x - a.x) / dt;
          const vy = (b.y - a.y) / dt;
          if (Math.hypot(vx, vy) > 0.35) {
            setView(clampView(panBy(current.current, vx * 110, vy * 110), content()), "glide");
          }
        }
      }}
      onPointerCancel={() => {
        pan.current = null;
        setPanning(false);
      }}
      onClickCapture={(e) => {
        if (!swallow.current) return;
        swallow.current = false;
        e.stopPropagation();
        e.preventDefault();
      }}
      onDoubleClick={(e) => {
        // On a control (a switch, a caption, a nut being turned) it keeps its own meaning.
        if ((e.target as Element).closest("button, [data-link-card]")) return;
        if (!isFitted(current.current)) reset();
      }}
    >
      <div ref={stage} className="viewer-stage">
        <div
          className="viewer-zoom"
          style={{
            transform: zoomed ? `translate(${view.x}px, ${view.y}px) scale(${view.s})` : "none",
            transition: TRANSITION[motion],
          }}
        >
          <div
            ref={object}
            className="viewer-object"
            style={{ width: layout.box.w, height: layout.box.h }}
          >
            <ExpCables layout={layout} placement={canvas.placement} presence={canvas.presence} />
            <LinkRings view={link.view} phase={link.phase} rect={caseRect} />
            <div
              className="absolute z-[1]"
              style={{
                left: layout.spark.x,
                top: layout.spark.y,
                width: layout.spark.w + 2 * SPARK.padX,
              }}
            >
              <Pedal {...props} status={status} drawnCables />
            </div>
            <div className="absolute inset-0 z-[2] pointer-events-none [&>*]:pointer-events-auto">
              <ExpPedals
                layout={layout}
                placement={canvas.placement}
                presence={canvas.presence}
                status={props.status}
                config={props.config}
                engaged={engaged}
                simulated={simulated}
                selected={selectedExp}
                onSelect={(n) => onSelectExp?.(n)}
                backend={backend}
              />
              {props.status && (
                <SimulateHints layout={layout} present={present} backend={backend} />
              )}
            </div>
          </div>
        </div>
      </div>
      <LinkCard view={link.view} phase={link.phase} backend={backend} config={props.config} />
      <button
        type="button"
        data-zoom-reset
        aria-hidden={!zoomed}
        tabIndex={zoomed ? 0 : -1}
        title="Fit the pedal (or double-click the background)"
        onClick={reset}
        className={cx(
          "viewer-zoom-reset absolute top-3 right-3 z-10 flex h-6 items-center gap-1.5 rounded-ui-sm border border-edge-strong bg-panel/90 px-2 font-mono text-ui-2xs text-muted tabular-nums shadow-raise",
          "transition-[opacity,color,translate] duration-(--dur) ease-(--ease) hover:text-bone active:translate-y-px",
          zoomed ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        {shownZoom.current}%
        <RotateCcw size={11} />
      </button>
    </section>
  );
}
