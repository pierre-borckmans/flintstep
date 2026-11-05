import { useRef, useState } from "react";
import type { Apply } from "../lib/config";
import {
  addPoint,
  CURVE_SHORT,
  CURVE_TIP,
  curvePath,
  editPoints,
  movePoint,
  pickCurve,
  removePoint,
} from "../lib/curve";
import { applyCurve, CURVE_KINDS, LINEAR, sControls } from "../lib/exp";
import { nextGesture } from "../lib/scrub";
import type { CurveKind, CurvePoint, ExpConfig, ExpCurve } from "../types";
import { cx } from "../ui/cx";
import { Kicker } from "../ui/Kicker";
import { NumField } from "../ui/NumField";
import { Seg } from "../ui/Seg";

// THE RESPONSE CURVE: how the pedal's travel bends on its way out (mapping/curve.go).
// A segmented control for the kind, a graph with a dot that follows the pedal, and the
// kind's own controls: Strength and Centre for S, draggable points for Custom.

const SMALL = { w: 120, h: 80 };
const LARGE = { w: 220, h: 150 };
const PAD = 6;

const OPTIONS = CURVE_KINDS.map((k) => ({ value: k, label: CURVE_SHORT[k], title: CURVE_TIP[k] }));

type Gesture = { id: number; done: boolean };

/** The curve, the identity diagonal faintly, and the pedal now: a dot at (travel,
 *  output). With `onPoints` (Custom) the points are handles: drag to move, click an
 *  empty spot to add, double-click a point to remove. One drag is one history entry. */
export function CurveGraph({
  curve,
  travel,
  label,
  onPoints,
}: {
  curve: ExpCurve;
  /** The pedal's calibrated travel 0..1, or null with no reading. */
  travel: number | null;
  label: string;
  onPoints?: (points: CurvePoint[], gesture?: Gesture) => void;
}) {
  const edit = curve.kind === "custom" && !!onPoints;
  const { w: W, h: H } = edit ? LARGE : SMALL;
  const IW = W - PAD * 2;
  const IH = H - PAD * 2;
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: number; i: number; pts: CurvePoint[] } | null>(null);
  const [active, setActive] = useState(-1);
  const pts = edit ? editPoints(curve) : [];
  const out = travel === null ? null : applyCurve(curve, travel);
  const path = curvePath(curve, IW, IH);

  // Pointer position as travel/output, 0..1 (heel bottom-left).
  const at = (clientX: number, clientY: number) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    const x = ((clientX - r.left) / r.width) * W - PAD;
    const y = ((clientY - r.top) / r.height) * H - PAD;
    return { x: Math.min(1, Math.max(0, x / IW)), y: Math.min(1, Math.max(0, 1 - y / IH)) };
  };
  const hit = (x: number, y: number) => {
    let best = -1;
    let bd = (10 / IW) ** 2; // within ~10 px
    pts.forEach((p, i) => {
      const d = (p.x - x) ** 2 + ((p.y - y) * (IH / IW)) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!edit || !onPoints || e.button !== 0) return;
    e.preventDefault();
    const p = at(e.clientX, e.clientY);
    let i = hit(p.x, p.y);
    let list = pts;
    if (i < 0) {
      [list, i] = addPoint(pts, p.x, p.y);
      if (i < 0) return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: nextGesture(), i, pts: list };
    setActive(i);
    onPoints(list, { id: drag.current.id, done: false });
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || !onPoints) return;
    const p = at(e.clientX, e.clientY);
    d.pts = movePoint(d.pts, d.i, p.x, p.y);
    onPoints(d.pts, { id: d.id, done: false });
  };
  const onUp = () => {
    const d = drag.current;
    if (!d || !onPoints) return;
    onPoints(d.pts, { id: d.id, done: true });
    drag.current = null;
    setActive(-1);
  };
  const onDouble = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!edit || !onPoints) return;
    const p = at(e.clientX, e.clientY);
    const i = hit(p.x, p.y);
    if (i >= 0) onPoints(removePoint(pts, i));
  };

  return (
    <svg
      ref={svg}
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      className={cx(
        "curve-graph shrink-0 touch-none rounded-[3px] bg-sunken inset-shadow-deep outline-none",
        edit && "cursor-crosshair",
      )}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={onDouble}
    >
      <title>
        {edit
          ? `${label}\nDrag a point to move it. Click an empty spot to add one, double-click a point to remove it.`
          : `${label}\nAcross: the pedal, heel to toe. Up: the value sent, 0 to 127`}
      </title>
      <g transform={`translate(${PAD} ${PAD})`}>
        {[0.25, 0.5, 0.75].map((f) => (
          <g key={f} stroke="var(--color-edge)" strokeWidth={1}>
            <line x1={f * IW} x2={f * IW} y1={0} y2={IH} />
            <line x1={0} x2={IW} y1={f * IH} y2={f * IH} />
          </g>
        ))}
        <line
          x1={0}
          y1={IH}
          x2={IW}
          y2={0}
          stroke="var(--color-faint)"
          strokeOpacity={0.5}
          strokeDasharray="2 3"
          strokeWidth={1}
        />
        <path
          d={path}
          fill="none"
          stroke="var(--color-cold)"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            filter: "drop-shadow(0 0 3px color-mix(in srgb, var(--color-cold) 35%, transparent))",
          }}
        />
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={p.x * IW}
            cy={IH - p.y * IH}
            r={i === active ? 5 : 4}
            fill={i === active ? "var(--color-cold)" : "var(--color-sunken)"}
            stroke="var(--color-cold)"
            strokeWidth={1.5}
            className="cursor-grab"
          >
            <title>{`${Math.round(p.x * 100)}% → ${Math.round(p.y * 127)}`}</title>
          </circle>
        ))}
        {travel !== null && out !== null && (
          <g
            className="curve-dot"
            style={{ transform: `translate(${travel * IW}px, ${IH - out * IH}px)` }}
          >
            <line
              x1={0}
              x2={0}
              y1={0}
              y2={out * IH}
              stroke="var(--color-cold)"
              strokeOpacity={0.3}
              strokeWidth={1}
            />
            <circle
              r={3.25}
              fill="var(--color-beam)"
              stroke="var(--color-sunken)"
              strokeWidth={1}
            />
          </g>
        )}
      </g>
    </svg>
  );
}

const pct = (v: number) => `${Math.round(v)}`;

/** The Response row of an Expression card: kind, graph, and the kind's controls. */
export function ResponseRow({
  n,
  x,
  travel,
  apply,
}: {
  n: number;
  x: ExpConfig;
  travel: number | null;
  apply: Apply;
}) {
  const curve = x.curve ?? LINEAR;
  const set = (c: ExpCurve, g?: Gesture) => apply({ type: "exp", n, patch: { curve: c } }, g);
  const out = travel === null ? null : Math.round(applyCurve(curve, travel) * 127);
  const s = sControls(curve);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Kicker>Response</Kicker>
        <div className="flex-1" />
        {travel !== null && out !== null && (
          <span
            className="font-mono text-ui-2xs text-faint tabular-nums"
            title="Where the pedal is, and the value that sends"
          >
            {Math.round(travel * 100)}% → {out}
          </span>
        )}
      </div>
      <Seg
        size="sm"
        fit
        label={`EXP ${n + 1} response curve`}
        options={OPTIONS}
        value={curve.kind}
        onChange={(kind: CurveKind) => set(pickCurve(curve, kind))}
      />
      <div className={cx("flex gap-3", curve.kind === "custom" ? "flex-col" : "items-start")}>
        <CurveGraph
          curve={curve}
          travel={travel}
          label={`EXP ${n + 1} response curve`}
          onPoints={(points, g) => set({ ...curve, kind: "custom", points }, g)}
        />
        <div className="flex min-w-0 flex-col gap-1.5 pt-0.5">
          <p className="text-ui-xs leading-snug text-faint">{CURVE_TIP[curve.kind]}</p>
          {curve.kind === "custom" && (
            <div className="flex items-center gap-2">
              <span className="font-mono text-ui-2xs text-muted tabular-nums">
                {editPoints(curve).length} points
              </span>
              <button
                type="button"
                className="rounded border border-edge px-1.5 py-0.5 text-ui-2xs text-muted hover:text-text"
                title="Back to three points on a straight line"
                onClick={() =>
                  set({
                    ...curve,
                    points: [
                      { x: 0.25, y: 0.25 },
                      { x: 0.5, y: 0.5 },
                      { x: 0.75, y: 0.75 },
                    ],
                  })
                }
              >
                Reset
              </button>
            </div>
          )}
        </div>
      </div>
      {curve.kind === "s" && (
        <div className="grid grid-cols-2 gap-2">
          <NumField
            label="Strength"
            value={Math.round(s.strength * 100)}
            min={0}
            max={100}
            format={pct}
            suffix="%"
            hint="How strong the S is: 0 is a straight line, 100 makes both ends flat"
            onChange={(v, g) => set({ ...curve, strength: v / 100, centre: s.centre }, g)}
          />
          <NumField
            label="Centre"
            value={Math.round(s.centre * 100)}
            min={10}
            max={90}
            format={pct}
            suffix="%"
            hint="Where along the travel the steep, most sensitive part sits"
            onChange={(v, g) => set({ ...curve, strength: s.strength, centre: v / 100 }, g)}
          />
        </div>
      )}
    </div>
  );
}
