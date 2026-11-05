import { useRef, useState } from "react";
import type { Apply } from "../lib/config";
import {
  CURVE_SHORT,
  CURVE_TIP,
  curvePath,
  dragAmount,
  formatAmount,
  keyAmount,
  pickCurve,
} from "../lib/curve";
import { applyCurve, CURVE_KINDS, LINEAR } from "../lib/exp";
import { nextGesture } from "../lib/scrub";
import type { CurveKind, ExpConfig, ExpCurve } from "../types";
import { cx } from "../ui/cx";
import { Kicker } from "../ui/Kicker";
import { Seg } from "../ui/Seg";

// THE RESPONSE CURVE: how the pedal's travel bends on its way out (mapping/curve.go).
// A segmented control for the kind and a small graph of it, with a dot that follows
// the pedal. On Custom the graph is the control: drag it up or down.

const W = 120;
const H = 80;
const PAD = 4;
const IW = W - PAD * 2;
const IH = H - PAD * 2;

// Short labels fit a card; the tooltip names each in full and says what it is for.
const OPTIONS = CURVE_KINDS.map((k) => ({ value: k, label: CURVE_SHORT[k], title: CURVE_TIP[k] }));

/** The curve, the identity diagonal faintly, and the pedal now: a dot at (travel,
 *  output). On Custom, a vertical drag (Shift for fine) or the arrow keys shape it; one
 *  drag is one history entry and one save. */
export function CurveGraph({
  curve,
  travel,
  label,
  onAmount,
}: {
  curve: ExpCurve;
  /** The pedal's calibrated travel 0..1, or null with no reading. */
  travel: number | null;
  label: string;
  /** Custom only: a new amount, with the drag it belongs to (none for a key). */
  onAmount?: (amount: number, gesture?: { id: number; done: boolean }) => void;
}) {
  const custom = curve.kind === "custom" && !!onAmount;
  const drag = useRef<{ id: number; y: number; start: number; last: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const out = travel === null ? null : applyCurve(curve, travel);
  const path = curvePath(curve, IW, IH);

  const move = (clientY: number, fine: boolean, done: boolean) => {
    const d = drag.current;
    if (!d || !onAmount) return;
    const a = dragAmount(d.start, clientY - d.y, fine);
    if (a === d.last && !done) return;
    d.last = a;
    onAmount(a, { id: d.id, done });
  };
  const end = (e: React.PointerEvent) => {
    if (!drag.current) return;
    move(e.clientY, e.shiftKey, true);
    drag.current = null;
    setDragging(false);
  };

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      aria-label={label}
      {...(custom
        ? {
            role: "slider",
            tabIndex: 0,
            "aria-valuemin": -1,
            "aria-valuemax": 1,
            "aria-valuenow": curve.amount,
            "aria-valuetext": `amount ${formatAmount(curve.amount)}`,
          }
        : { role: "img" })}
      className={cx(
        "curve-graph shrink-0 touch-none rounded-[3px] bg-sunken inset-shadow-deep outline-none",
        custom && (dragging ? "cursor-ns-resize" : "cursor-grab"),
        custom && "focus-visible:ring-1 focus-visible:ring-cold/70",
      )}
      onPointerDown={(e) => {
        if (!custom || e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.focus({ preventScroll: true });
        drag.current = { id: nextGesture(), y: e.clientY, start: curve.amount, last: curve.amount };
        setDragging(true);
      }}
      onPointerMove={(e) => move(e.clientY, e.shiftKey, false)}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(e) => {
        if (!custom || !onAmount) return;
        const a = keyAmount(curve.amount, e.key, e.shiftKey);
        if (a === null) return;
        e.preventDefault();
        if (a !== curve.amount) onAmount(a);
      }}
    >
      <title>
        {custom
          ? `${label}: amount ${formatAmount(curve.amount)}\nDrag up for a gentler heel, down for a faster one (Shift: fine)`
          : `${label}\nAcross: the pedal, heel to toe. Up: the value sent, 0 to 127`}
      </title>
      <g transform={`translate(${PAD} ${PAD})`}>
        {/* quarter grid */}
        {[0.25, 0.5, 0.75].map((f) => (
          <g key={f} stroke="var(--color-edge)" strokeWidth={1}>
            <line x1={f * IW} x2={f * IW} y1={0} y2={IH} />
            <line x1={0} x2={IW} y1={f * IH} y2={f * IH} />
          </g>
        ))}
        {/* linear, for comparison */}
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
              fill="var(--color-cold)"
              stroke="var(--color-sunken)"
              strokeWidth={1}
            />
          </g>
        )}
      </g>
    </svg>
  );
}

/** The Response row of an Expression card: kind, graph, and a line on what it does. */
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
  const set = (c: ExpCurve, g?: { id: number; done: boolean }) =>
    apply({ type: "exp", n, patch: { curve: c } }, g);
  const out = travel === null ? null : Math.round(applyCurve(curve, travel) * 127);
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
      <div className="flex items-start gap-3">
        <CurveGraph
          curve={curve}
          travel={travel}
          label={`EXP ${n + 1} response curve`}
          onAmount={(amount, g) => set({ kind: "custom", amount }, g)}
        />
        <div className="flex min-w-0 flex-col gap-1.5 pt-0.5">
          <p className="text-ui-xs leading-snug text-faint">{CURVE_TIP[curve.kind]}</p>
          {curve.kind === "custom" && (
            <p className="font-mono text-ui-2xs text-muted tabular-nums">
              amount {formatAmount(curve.amount)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
