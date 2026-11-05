import { useId, useRef, useState } from "react";
import type { Backend } from "../api";
import { expFraction, expValue, rawFraction } from "../lib/exp";
import {
  ART,
  ART_ASPECT,
  cableBehind,
  cableBeside,
  dragFraction,
  gaugeMarks,
  jackPoint,
  LABEL,
  type Layout,
  type Placement,
  readout,
  SPARK,
  socketPoint,
  tiltDeg,
  type UnitBox,
} from "../lib/exppedal";
import type { Config, ExpConfig, Status } from "../types";
import { cx } from "../ui/cx";
import { Lamp } from "../ui/Lamp";
import { useSprings } from "../useSprings";
import "./ExpPedals.css";

// THE EXPRESSION PEDALS, drawn next to the Spark when something is in a jack: a generic
// treadle pedal in side view (no brand's), tilting with the input's calibrated position,
// a gauge and readout under it, and a cable back to its jack. The layout (where each
// sits, how big, the cable's route) is lib/exppedal.ts; this file draws it.

const MODE_WORD = { engage: "auto-engage", toe: "toe click" } as const;

/** One pedal's art, toe to the right (mirrored by the caller), the treadle at `tilt`. */
function Art({ id, tilt }: { id: string; tilt: number }) {
  const { x: px, y: py } = ART.pivot;
  return (
    <>
      <defs>
        <linearGradient id={`${id}-base`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a3e44" />
          <stop offset="0.35" stopColor="#202326" />
          <stop offset="1" stopColor="#0e0f11" />
        </linearGradient>
        <linearGradient id={`${id}-side`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#34383e" />
          <stop offset="1" stopColor="#141619" />
        </linearGradient>
        <linearGradient id={`${id}-cheek`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2c3035" />
          <stop offset="1" stopColor="#17191c" />
        </linearGradient>
        <radialGradient id={`${id}-bolt`} cx="0.38" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#f1eadb" />
          <stop offset="0.5" stopColor="#a8a090" />
          <stop offset="1" stopColor="#4f4a42" />
        </radialGradient>
        <radialGradient id={`${id}-floor`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#000" stopOpacity="0.5" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        {/* the rubber tread: raised ribs across the treadle, seen end-on */}
        <pattern id={`${id}-grip`} width="22" height="20" patternUnits="userSpaceOnUse">
          <rect width="22" height="20" fill="#16181a" />
          <rect x="2" y="0" width="12" height="20" rx="3" fill="#24272b" />
          <rect x="2" y="0" width="12" height="2" rx="1" fill="#4a5057" />
        </pattern>
      </defs>

      {/* its shadow on the floor */}
      <ellipse cx="480" cy="384" rx="490" ry="13" fill={`url(#${id}-floor)`} />

      {/* the base: a low box on rubber feet, a toe stop on top */}
      <rect x="70" y="368" width="80" height="16" rx="5" fill="#060707" />
      <rect x="790" y="368" width="80" height="16" rx="5" fill="#060707" />
      <rect
        x={ART.base.x0}
        y="298"
        width={ART.base.x1 - ART.base.x0}
        height="74"
        rx="14"
        fill={`url(#${id}-base)`}
        stroke="#000"
        strokeOpacity="0.65"
        strokeWidth="2"
      />
      <rect x="74" y="318" width="790" height="36" rx="7" fill="#0c0d0f" opacity="0.55" />
      <line x1="56" y1="301" x2="884" y2="301" stroke="#fff" strokeOpacity="0.14" />
      <rect x="812" y="289" width="58" height="11" rx="4" fill="#0a0b0c" />

      {/* the treadle, turning on its axle at the heel */}
      <g className="exp-treadle" transform={`rotate(${-tilt} ${px} ${py})`}>
        <rect
          x="66"
          y="246"
          width="858"
          height="44"
          rx="14"
          fill={`url(#${id}-side)`}
          stroke="#000"
          strokeOpacity="0.7"
          strokeWidth="2"
        />
        <line x1="90" y1="270" x2="900" y2="270" stroke="#000" strokeOpacity="0.35" />
        <line x1="90" y1="272" x2="900" y2="272" stroke="#fff" strokeOpacity="0.05" />
        <rect x="84" y="226" width="822" height="24" rx="8" fill={`url(#${id}-grip)`} />
        <rect
          x="84"
          y="226"
          width="822"
          height="24"
          rx="8"
          fill="none"
          stroke="#000"
          strokeOpacity="0.6"
          strokeWidth="2"
        />
      </g>

      {/* the hinge block, and the axle through it */}
      <path
        d="M60 300 V272 Q60 262 70 262 H156 Q166 262 166 272 V300 Z"
        fill={`url(#${id}-cheek)`}
        stroke="#000"
        strokeOpacity="0.55"
        strokeWidth="2"
      />
      <line x1="66" y1="265" x2="160" y2="265" stroke="#fff" strokeOpacity="0.1" />
      <circle cx={px} cy={py} r="14" fill={`url(#${id}-bolt)`} stroke="#2b2925" strokeWidth="2" />
      <circle cx={px} cy={py} r="4.5" fill="#26231f" />

      {/* the output socket on the heel end, where the cable goes in */}
      <rect x="16" y="320" width="28" height="24" rx="4" fill="#8f897b" />
      <rect x="16" y="320" width="28" height="7" rx="3" fill="#d9d2c2" opacity="0.6" />
    </>
  );
}

/** Under the drawing: a gauge of the value with the calibration on it, then the readout. */
function Gauge({
  x,
  raw,
  engaged,
  mirror,
}: {
  x: ExpConfig;
  raw: number;
  engaged: boolean;
  mirror: boolean;
}) {
  const trig = x.trigger.mode !== "off" ? x.trigger.threshold : null;
  const m = gaugeMarks({
    fraction: raw >= 0 ? expFraction(raw, x) : null,
    rawFraction: raw >= 0 ? rawFraction(raw) : null,
    heelRaw: rawFraction(x.min),
    toeRaw: rawFraction(x.max),
    threshold: trig,
  });
  // Heel to toe follows the drawing: on a mirrored pedal the toe end is on the left.
  const at = (f: number) => `${(mirror ? 1 - f : f) * 100}%`;
  const span = (a: number, b: number) => {
    const [l, r] = [mirror ? 1 - b : a, mirror ? 1 - a : b];
    return { left: `${Math.min(l, r) * 100}%`, width: `${Math.abs(r - l) * 100}%` };
  };
  return (
    <div className="exp-gauge" aria-hidden>
      {(
        [
          ["H", m.heel],
          ["T", m.toe],
        ] as const
      ).map(([k, f]) => (
        <span key={k} className="exp-gauge-cal" style={{ left: at(f) }}>
          <span>{k}</span>
        </span>
      ))}
      <span className="exp-gauge-track" />
      <span
        className="exp-gauge-span"
        style={span(Math.min(m.heel, m.toe), Math.max(m.heel, m.toe))}
      />
      {m.threshold !== null && m.release !== null && (
        <>
          <span className="exp-gauge-band" style={span(m.release, m.threshold)} />
          <span
            className="exp-gauge-th"
            data-on={engaged || undefined}
            style={{ left: at(m.threshold) }}
          />
        </>
      )}
      {m.value !== null && (
        <>
          <span className="exp-gauge-fill" style={span(0, m.value)} />
          <span className="exp-gauge-needle" style={{ left: at(m.value) }} />
        </>
      )}
      {m.raw !== null && <span className="exp-gauge-raw" style={{ left: at(m.raw) }} />}
    </div>
  );
}

function Unit({
  n,
  u,
  presence,
  placement,
  tilt,
  x,
  raw,
  engaged,
  simulated,
  selected,
  onSelect,
  onDrag,
}: {
  n: number;
  u: UnitBox;
  presence: number;
  placement: Placement;
  tilt: number;
  x: ExpConfig;
  raw: number;
  engaged: boolean;
  simulated: boolean;
  selected: boolean;
  onSelect: (n: number) => void;
  /** A simulated pedal's treadle dragged: the position, or null when let go. */
  onDrag: (f: number | null) => void;
}) {
  const id = `exp${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const artH = u.w * ART_ASPECT;
  const value = raw >= 0 ? expValue(raw, x) : null;
  const trig = x.trigger.mode !== "off" ? x.trigger.mode : null;
  const lit = trig !== null && x.enabled && engaged;
  const away = 1 - presence;
  const drag = useRef<{ id: number; y: number; f0: number; moved: boolean } | null>(null);
  const swallow = useRef(false);
  const name = `EXP ${n + 1}`;
  const label = x.enabled
    ? `${name}: ${readout(x.cc, x.channel, value)}${lit ? ", engaged" : ""}`
    : `${name}: off`;

  return (
    <button
      type="button"
      className="exp-pedal"
      aria-pressed={selected}
      aria-label={label}
      title={simulated ? `${name} (simulated): drag the treadle up or down` : name}
      data-off={!x.enabled || undefined}
      data-sim={simulated || undefined}
      onClick={() => {
        if (swallow.current) {
          swallow.current = false;
          return;
        }
        onSelect(n);
      }}
      style={{
        left: u.x,
        top: u.y,
        width: u.w,
        height: artH + LABEL,
        opacity: presence,
        pointerEvents: presence < 0.5 ? "none" : undefined,
        transform:
          placement === "behind" ? `translateY(${-away * 16}px)` : `translateX(${away * 16}px)`,
      }}
    >
      <svg
        aria-hidden
        className="exp-art"
        viewBox={`0 ${ART.y0} ${ART.w} ${ART.h}`}
        style={{ height: artH }}
        onPointerDown={(e) => {
          swallow.current = false;
          if (!simulated || e.button !== 0) return;
          e.stopPropagation(); // not a pan
          const f0 = fractionAt(tilt);
          drag.current = { id: e.pointerId, y: e.clientY, f0, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          const dy = e.clientY - d.y;
          if (!d.moved) {
            if (Math.abs(dy) < 3) return;
            d.moved = true;
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          onDrag(dragFraction(d.f0, dy, Math.max(60, u.w * 0.35)));
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          drag.current = null;
          if (d.moved) {
            swallow.current = true;
            onDrag(null);
          }
        }}
        onPointerCancel={() => {
          if (drag.current?.moved) onDrag(null);
          drag.current = null;
        }}
      >
        <g transform={u.mirror ? `translate(${ART.w} 0) scale(-1 1)` : undefined}>
          <Art id={id} tilt={tilt} />
        </g>
      </svg>
      {simulated && (
        <span className="exp-sim-tag" data-mirror={u.mirror || undefined}>
          simulated
        </span>
      )}
      <div className="exp-label" style={{ top: artH }}>
        <Gauge x={x} raw={x.enabled ? raw : -1} engaged={lit} mirror={u.mirror} />
        <div className="exp-readout">
          <span className="exp-name">{name}</span>
          {x.enabled ? (
            <span className="exp-cc">{readout(x.cc, x.channel, value)}</span>
          ) : (
            <span className="exp-cc exp-cc-off">off</span>
          )}
        </div>
        {trig && x.enabled && (
          <div className="exp-trig">
            <Lamp on={lit} colour="beam" size={6} title={lit ? "Engaged" : "Not engaged"} />
            <span className={cx(lit && "exp-trig-lit")}>{lit ? "engaged" : MODE_WORD[trig]}</span>
            {lit && <span className="exp-trig-mode">{MODE_WORD[trig]}</span>}
          </div>
        )}
      </div>
    </button>
  );
}

/** The calibrated position a tilt shows (the inverse of tiltDeg), for starting a drag. */
function fractionAt(deg: number): number {
  const h = tiltDeg(0);
  const t = tiltDeg(1);
  return Math.min(1, Math.max(0, (deg - h) / (t - h)));
}

/** Both cables, under the Spark and the pedals so the plugs and sockets cover their
 *  ends. Each is drawn from its jack outward, so it retracts toward the jack. */
export function ExpCables({
  layout,
  placement,
  presence,
}: {
  layout: Layout;
  placement: Placement;
  presence: number[];
}) {
  return (
    <svg
      aria-hidden
      className="exp-cables"
      width={layout.box.w}
      height={layout.box.h}
      viewBox={`0 0 ${layout.box.w} ${layout.box.h}`}
    >
      {[0, 1].map((n) => {
        const p = presence[n];
        if (p <= 0.001) return null;
        const u = layout.units[n];
        const s = socketPoint(u);
        // the unit slides in from where it fades: the socket travels with it
        const away = 1 - p;
        const sock =
          placement === "behind" ? { x: s.x, y: s.y - away * 16 } : { x: s.x + away * 16, y: s.y };
        const j = jackPoint(layout, n);
        const jack = { x: j.x, y: j.y + SPARK.plug - 6 };
        const d =
          placement === "behind"
            ? cableBehind(jack, sock, u.mirror ? 1 : -1)
            : cableBeside(layout, n, sock);
        const dash = { strokeDasharray: "1 2", strokeDashoffset: 1 - p };
        return (
          <g key={n}>
            <path d={d} pathLength={1} className="exp-cable-shadow" style={dash} />
            <path d={d} pathLength={1} className="exp-cable" style={dash} />
            <path d={d} pathLength={1} className="exp-cable-sheen" style={dash} />
          </g>
        );
      })}
    </svg>
  );
}

/** The pedals themselves, laid over the canvas in the layout's px. */
export function ExpPedals({
  layout,
  placement,
  presence,
  status,
  config,
  engaged,
  simulated,
  selected,
  onSelect,
  backend,
}: {
  layout: Layout;
  placement: Placement;
  presence: number[];
  status: Status | null;
  config: Config | null;
  engaged: boolean[];
  simulated: boolean[];
  selected: 0 | 1 | null;
  onSelect: (n: 0 | 1) => void;
  backend: Backend;
}) {
  // A simulated treadle under the hand: where it is, ahead of the State that follows.
  const [held, setHeld] = useState<(number | null)[]>([null, null]);
  const sent = useRef([0, 0]);
  const trailing = useRef<(ReturnType<typeof setTimeout> | null)[]>([null, null]);
  const send = (n: number, f: number) => {
    const now = performance.now();
    const t = trailing.current[n];
    if (t) clearTimeout(t);
    const go = () => {
      sent.current[n] = performance.now();
      trailing.current[n] = null;
      backend.SetSimExp(n, f).catch(() => {});
    };
    if (now - sent.current[n] >= 16) go();
    else trailing.current[n] = setTimeout(go, 16 - (now - sent.current[n]));
  };

  const fraction = (n: number) => {
    const h = held[n];
    if (h !== null) return h;
    const x = config?.exp[n];
    const raw = status?.expRaw?.[n] ?? -1;
    return x && raw >= 0 ? (expFraction(raw, x) ?? 0) : 0;
  };
  const dragging = held[0] !== null || held[1] !== null;
  const tilts = useSprings([tiltDeg(fraction(0)), tiltDeg(fraction(1))], 26, dragging);

  if (!config) return null;
  return (
    <>
      {[0, 1].map((n) => {
        if (presence[n] <= 0.001) return null;
        const x = config.exp[n];
        return (
          <Unit
            key={n}
            n={n}
            u={layout.units[n]}
            presence={presence[n]}
            placement={placement}
            tilt={tilts[n]}
            x={x}
            raw={status?.expRaw?.[n] ?? -1}
            engaged={!!engaged[n]}
            simulated={!!simulated[n]}
            selected={selected === n}
            onSelect={(i) => onSelect(i as 0 | 1)}
            onDrag={(f) => {
              if (f === null) {
                const last = held[n];
                if (last !== null) send(n, last);
                // keep the hand's position until the State that follows has caught up
                setTimeout(() => setHeld((h) => h.map((v, i) => (i === n ? null : v))), 160);
                return;
              }
              setHeld((h) => h.map((v, i) => (i === n ? f : v)));
              send(n, f);
            }}
          />
        );
      })}
    </>
  );
}

/** A faint "+ simulate" over each empty jack, shown while the pointer is on the canvas:
 *  a pretend pedal to try things with when there is no real one. */
export function SimulateHints({
  layout,
  present,
  backend,
}: {
  layout: Layout;
  present: boolean[];
  backend: Backend;
}) {
  return (
    <>
      {[0, 1].map((n) => {
        if (present[n]) return null;
        const j = jackPoint(layout, n);
        return (
          <button
            key={n}
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
    </>
  );
}
