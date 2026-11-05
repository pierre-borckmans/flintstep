import { RotateCcw } from "lucide-react";
import type { Application as PixiApp } from "pixi.js";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Backend } from "../api";
import type { Camera } from "../canvas/camera/camera";
import { CameraRig } from "../canvas/camera/rig";
import type { Scene } from "../canvas/context";
import { caseFrame, unitBoxes } from "../canvas/hit";
import { readPalette } from "../canvas/palette";
import { Repaint } from "../canvas/repaint";
import { Stage } from "../canvas/Stage";
import { Hover, type Motion, type SceneData, SceneStore, ZoomWatch } from "../canvas/store";
import { type PointerState, usePedalPointer } from "../canvas/usePedalPointer";
import { actionCaption, longCaption } from "../lib/caption";
import { expValue } from "../lib/exp";
import {
  choosePlacement,
  fitWidth,
  jackPoint,
  type Layout,
  layout as layoutFor,
  lerpLayout,
  type Placement,
  readout,
} from "../lib/exppedal";
import { indicatorBox, switchBox } from "../lib/sparkgeom";
import type { Config, Status } from "../types";
import { INDICATOR_NAMES, SWITCH_NAMES } from "../types";
import { cx } from "../ui/cx";
import { useExpPlacement } from "../useExpPlacement";
import { useNuts } from "../useNuts";
import { useReducedMotion } from "../useReducedMotion";
import { useTheme } from "../useTheme";
import { freezeMs, LinkCard, useLink } from "./LinkOverlay";

// THE PEDAL VIEWER: the canvas (canvas/Stage) and the HTML that floats over it — the
// connection card, the zoom readout, and a layer of invisible buttons, one per thing you
// can select, kept over the drawing by the camera so Tab, Enter and screen readers still
// work on a pedal that is pixels.
//
// This component re-renders when the pedal's status, the mapping, the selection, the
// theme or the viewer's settled size changes. It never re-renders because the camera moved
// or the window is mid-drag: the camera lives in the rig, and everything that follows it
// does so by subscription.

/** Browser dev only: ?zoom=2.5,0.3,0.4 opens zoomed 2.5x on that point of the layout. */
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

/** The same object for the same content, so a re-sent value does not rebuild the scene. */
function useStable<T>(value: T): T {
  const last = useRef<{ json: string; value: T } | null>(null);
  const json = JSON.stringify(value);
  if (last.current?.json !== json) last.current = { json, value };
  return last.current.value;
}

/** The fitted object keeps this much room round it, as the DOM viewer's padding did. */
const INSET = 64;

/** Where the plugged-in expression pedals go and how big everything is: the TARGET
 *  layout for the space there is. The canvas springs toward it on its own clock, so
 *  appearing, leaving and switching placement all glide; `snap` says when it should land
 *  at once instead (the first size, a resize, a frozen dev still). */
function useTargetLayout(avail: { w: number; h: number } | null, present: [boolean, boolean]) {
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
  const want: [number, number] = [present[0] ? 1 : 0, present[1] ? 1 : 0];
  if (FREEZE !== null) {
    const none = layoutFor(placement, [false, false], fitWidth(placement, [false, false], size));
    target = lerpLayout(none, target, FREEZE);
    want[0] *= FREEZE;
    want[1] *= FREEZE;
  }
  // Nothing glides while the window opens (the first size and State land as they are),
  // nor when a resize settles (the drag already showed this size); a placement that flips
  // as a resize settles still glides to its new side.
  const born = useRef(performance.now());
  const last = useRef({ size: "", placement, snap: 0 });
  const sizeKey = avail ? `${avail.w}x${avail.h}` : "";
  const opening = performance.now() - born.current < 800;
  const resized = sizeKey !== last.current.size && placement === last.current.placement;
  const snap =
    !avail || opening || resized || FREEZE !== null ? last.current.snap + 1 : last.current.snap;
  last.current = { size: sizeKey, placement, snap };
  return { placement, layout: target, presence: want, snap };
}

export function PedalViewer({
  backend,
  status: statusIn,
  config: configIn,
  selected,
  onSelect,
  selectedIndicator = null,
  onSelectIndicator,
  engaged = [],
  simulated = [],
  selectedExp = null,
  onSelectExp,
}: {
  backend: Backend;
  status: Status | null;
  config: Config | null;
  /** The selected switch, or -1 while a lamp or an expression pedal is. */
  selected: number;
  onSelect: (n: number) => void;
  /** Which connection lamp is being edited: 0 = AMP, 1 = APP. */
  selectedIndicator?: 0 | 1 | null;
  /** Makes the AMP and APP lamps selectable; without it they're just lamps. */
  onSelectIndicator?: (i: 0 | 1) => void;
  /** Each input's trigger engaged now (State.expTrigger). */
  engaged?: boolean[];
  /** Each jack's pedal simulated (State.expSim). */
  simulated?: boolean[];
  selectedExp?: 0 | 1 | null;
  onSelectExp?: (n: 0 | 1) => void;
}) {
  // The canvas's world, made once: nothing in here changes identity for the viewer's life.
  const scene = useMemo<Scene>(
    () => ({
      rig: new CameraRig(),
      repaint: new Repaint(),
      hover: new Hover(),
      store: new SceneStore(),
      zoom: new ZoomWatch(),
      motion: {
        layout: layoutFor("behind", [false, false], 0),
        presence: [0, 0],
        version: 0,
      } as Motion,
    }),
    [],
  );
  const { rig, store } = scene;
  const viewer = useRef<HTMLElement>(null);
  // The settled size, not the live one: a window drag re-renders nothing here until it
  // stops, and then the layout (and the auto placement) is worked out once for the size
  // it stopped at. Mid-drag the canvas scales the layout it has.
  const size = useSyncExternalStore(
    useCallback((fn) => rig.subscribeRoom(fn), [rig]),
    () => rig.room,
  );
  const avail =
    size.w > 0 && size.h > 0
      ? { w: Math.max(0, size.w - INSET), h: Math.max(0, size.h - INSET) }
      : null;
  // The bridge hands over a fresh State object on every push, changed or not; the canvas
  // keys its scene on these, so an unchanged status keeps its identity.
  const status = useStable(statusIn);
  const config = useStable(configIn);
  const link = useLink(status, config);
  const present: [boolean, boolean] = [!!status?.cables?.[0], !!status?.cables?.[1]];
  const target = useTargetLayout(avail, present);
  const theme = useTheme();
  const palette = useMemo(() => readPalette(theme.resolved === "light"), [theme.resolved]);
  const nuts = useNuts();
  const reducedMotion = useReducedMotion();
  const [FREEZE_MS] = useState(freezeMs);

  const data = useMemo<SceneData>(
    () => ({
      status,
      config,
      selected,
      selectedIndicator,
      selectedExp,
      indicators: !!onSelectIndicator,
      engaged,
      simulated,
      nuts: { mode: nuts.mode, angles: nuts.angles, peek: nuts.peek },
      palette,
      layout: target.layout,
      room: size,
      placement: target.placement,
      presence: target.presence,
      snap: target.snap,
      link,
      freezeMs: FREEZE_MS,
      reducedMotion,
      // The DOM pedal's @max-md container query: its content box (the case) under 28rem.
      short: target.layout.spark.w < 448,
    }),
    // Rebuilt when any of it changes; the arrays are compared by content.
    [
      status,
      config,
      selected,
      selectedIndicator,
      selectedExp,
      !!onSelectIndicator,
      engaged.join(),
      simulated.join(),
      nuts.mode,
      nuts.angles.join(),
      nuts.peek,
      palette,
      JSON.stringify(target.layout),
      size,
      target.placement,
      target.presence.join(),
      target.snap,
      link.view,
      link.phase,
      link.sweepAt,
      reducedMotion,
    ],
  );
  // EFFECT: the snapshot, published before the browser paints.
  useLayoutEffect(() => store.set(data), [store, data]);

  // Browser dev only: ?zoom=s,fx,fy, once the layout is in.
  const pending = useRef(zoomFromQuery());
  useEffect(() => {
    const z = pending.current;
    if (!z || !avail) return;
    // Once the canvas has handed the rig its content (across the Application boundary,
    // so a frame or two later).
    let raf = 0;
    const go = () => {
      if (!rig.framed) {
        raf = requestAnimationFrame(go);
        return;
      }
      pending.current = null;
      const b = store.current?.layout.box ?? data.layout.box;
      rig.centerOn({ x: -b.w / 2 + b.w * z[1], y: -b.h / 2 + b.h * z[2] }, rig.minScale * z[0], 0);
    };
    raf = requestAnimationFrame(go);
    return () => cancelAnimationFrame(raf);
  }, [avail !== null]);

  const pointer = useRef<PointerState>({
    data,
    backend,
    onSelect,
    onSelectIndicator,
    onSelectExp,
    canvasRect: () => viewer.current?.querySelector("canvas")?.getBoundingClientRect() ?? null,
  });
  pointer.current = { ...pointer.current, data, backend, onSelect, onSelectIndicator, onSelectExp };
  const handlers = usePedalPointer(scene, pointer);

  const onReady = useCallback(
    (app: PixiApp) => {
      if (document.documentElement.dataset.mock) {
        // For screenshot and performance drivers (browser dev only).
        const w = window as unknown as { __pedalCanvas?: PixiApp; __pedalScene?: Scene };
        w.__pedalCanvas = app;
        w.__pedalScene = scene;
      }
    },
    [scene],
  );

  return (
    <section ref={viewer} className="pedal-viewer" aria-label="Pedal viewer">
      <Stage scene={scene} handlers={handlers} onReady={onReady} />
      <KeyLayer
        rig={rig}
        data={data}
        backend={backend}
        onSelect={onSelect}
        onSelectIndicator={onSelectIndicator}
        onSelectExp={onSelectExp}
      />
      <LinkCard view={link.view} phase={link.phase} backend={backend} config={config} />
      <ZoomReadout rig={rig} />
    </section>
  );
}

/** The camera, as a CSS transform for HTML laid out in the layout's px. */
const cssTransform = (cam: Camera, box: { w: number; h: number }) =>
  `translate(${cam.x}px, ${cam.y}px) scale(${cam.scale}) translate(${-box.w / 2}px, ${-box.h / 2}px)`;

/**
 * THE KEYBOARD LAYER: one real, invisible button per thing on the canvas you can select,
 * over the thing itself, so Tab reaches them in order, Enter and Space select, a focus
 * ring shows where you are, and a screen reader reads the same labels the DOM pedal had.
 * They take no pointer — the canvas's own hit testing does that — except the "+ simulate"
 * hints over empty jacks, which are only ever buttons.
 *
 * It follows the camera by subscription: a transform written straight onto one element,
 * never a render.
 */
function KeyLayer({
  rig,
  data,
  backend,
  onSelect,
  onSelectIndicator,
  onSelectExp,
}: {
  rig: CameraRig;
  data: SceneData;
  backend: Backend;
  onSelect: (n: number) => void;
  onSelectIndicator?: (i: 0 | 1) => void;
  onSelectExp?: (n: 0 | 1) => void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const box = data.layout.box;
  useEffect(() => {
    const el = layer.current;
    if (!el) return;
    const put = (cam: Camera) => {
      el.style.transform = cssTransform(cam, box);
    };
    put(rig.current);
    return rig.subscribe(put);
  }, [rig, box.w, box.h]);

  const l = data.layout;
  const c = caseFrame(l);
  const at = (b: { x: number; y: number; w: number; h: number }, scaled = true): CSSProperties =>
    scaled
      ? { left: c.x + b.x * c.k, top: c.y + b.y * c.k, width: b.w * c.k, height: b.h * c.k }
      : { left: b.x, top: b.y, width: b.w, height: b.h };

  return (
    <div ref={layer} className="canvas-keys" style={{ width: box.w, height: box.h }}>
      {[0, 1, 2, 3, 4, 5].map((n) => {
        const sw = data.config?.switches[n];
        const cap = sw ? actionCaption(sw.tap) : "Not assigned";
        const hold = sw ? longCaption(sw.long) : "";
        return (
          <button
            key={n}
            type="button"
            className="canvas-key"
            aria-pressed={data.selected === n}
            aria-label={`Switch ${SWITCH_NAMES[n]}: ${cap}${hold ? `, ${hold}` : ""}`}
            onClick={() => onSelect(n)}
            style={at(switchBox(n))}
          />
        );
      })}
      {onSelectIndicator &&
        ([0, 1] as const).map((i) => (
          <button
            key={`ind${i}`}
            type="button"
            className="canvas-key"
            aria-pressed={data.selectedIndicator === i}
            aria-label={`${INDICATOR_NAMES[i]} lamp`}
            onClick={() => onSelectIndicator(i)}
            style={at(indicatorBox(i))}
          />
        ))}
      {([0, 1] as const).map((n) => {
        if (data.presence[n] < 0.5) return null;
        const x = data.config?.exp[n];
        if (!x) return null;
        const raw = data.status?.expRaw?.[n] ?? -1;
        const value = raw >= 0 ? expValue(raw, x) : null;
        const lit = x.trigger.mode !== "off" && x.enabled && !!data.engaged[n];
        const name = `EXP ${n + 1}`;
        const label = x.enabled
          ? `${name}: ${readout(x.cc, x.channel, value)}${lit ? ", engaged" : ""}`
          : `${name}: off`;
        return (
          <button
            key={`exp${n}`}
            type="button"
            className="canvas-key"
            aria-pressed={data.selectedExp === n}
            aria-label={label}
            onClick={() => onSelectExp?.(n)}
            style={at(unitBoxes(l.units[n]).all, false)}
          />
        );
      })}
      {data.status &&
        ([0, 1] as const).map((n) => {
          if (data.status?.cables?.[n]) return null;
          const j = jackPoint(l, n);
          return (
            <button
              key={`sim${n}`}
              type="button"
              className="exp-sim-hint"
              title={`Draw a simulated pedal in EXP ${n + 1}`}
              style={{ left: j.x, top: j.y - 30 }}
              onClick={() => backend.SimulateExp(n, true).catch(() => {})}
            >
              + simulate
            </button>
          );
        })}
    </div>
  );
}

/** "250% ⟲": how far in you are, and the way back. Written by the camera, not rendered. */
function ZoomReadout({ rig }: { rig: CameraRig }) {
  const button = useRef<HTMLButtonElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const b = button.current;
    const t = label.current;
    if (!b || !t) return;
    let zoomed = false;
    const put = () => {
      const s = rig.target.scale / rig.minScale;
      const z = s > 1.001;
      // The readout keeps its last figure while it fades out.
      if (z) t.textContent = `${Math.round(s * 100)}%`;
      if (z === zoomed) return;
      zoomed = z;
      b.dataset.on = z ? "true" : "false";
      b.tabIndex = z ? 0 : -1;
      b.setAttribute("aria-hidden", z ? "false" : "true");
      b.closest(".pedal-viewer")?.toggleAttribute("data-zoomed", z);
    };
    put();
    return rig.subscribe(put);
  }, [rig]);
  return (
    <button
      ref={button}
      type="button"
      data-zoom-reset
      data-on="false"
      aria-hidden
      tabIndex={-1}
      title="Fit the pedal (or double-click the background)"
      onClick={() => rig.fit(220)}
      className={cx(
        "viewer-zoom-reset absolute top-3 right-3 z-10 flex h-6 items-center gap-1.5 rounded-ui-sm border border-edge-strong bg-panel/90 px-2 font-mono text-ui-2xs text-muted tabular-nums shadow-raise",
        "transition-[opacity,color,translate] duration-(--dur) ease-(--ease) hover:text-bone active:translate-y-px",
        "data-[on=false]:pointer-events-none data-[on=false]:opacity-0",
      )}
    >
      <span ref={label}>100%</span>
      <RotateCcw size={11} />
    </button>
  );
}
