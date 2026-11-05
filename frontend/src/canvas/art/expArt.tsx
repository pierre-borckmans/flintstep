import { ART, baseTop, STOPS, TREADLE } from "../../lib/exppedal";

// THE EXPRESSION PEDAL'S ART: a generic rocker pedal in side view (no brand's), toe to
// the right. The treadle rocks on an axle through the base's side plate, ~40% of its
// length from the heel (lib/exppedal's ART and TREADLE), and the base stops it on a
// rubber pad at each end. Cut into the three layers the treadle sits between, so the
// treadle can be a sprite the scene turns on its axle — free on the GPU — instead of a
// re-rendered SVG per frame of the spring.
//
//   under    the floor shadow, the feet, the wedge base, its side plate, the two stops
//   treadle  the plate, its rubber tread and the skirt round the axle (TREADLE_BOX)
//   over     the axle pin and the socket on the heel end the cable goes into
//
// `under` and `over` are drawn in ART's viewBox (1000 x 300 from y0); `px` is the width
// they are rasterised at.

const box = `0 ${ART.y0} ${ART.w} ${ART.h}`;
const height = (px: number) => Math.round((px * ART.h) / ART.w);
const f1 = (v: number) => Math.round(v * 10) / 10;

/** A rubber stop standing on the base: from the base's top up to where the treadle
 *  lands on it. */
function Stop({ x, top, foot }: { x: number; top: number; foot: number }) {
  const w = 46;
  return (
    <g>
      <rect
        x={f1(x - w / 2)}
        y={f1(top)}
        width={w}
        height={f1(foot - top + 4)}
        rx="6"
        fill="#121314"
        stroke="#000"
        strokeOpacity="0.6"
        strokeWidth="2"
      />
      <rect x={f1(x - w / 2 + 5)} y={f1(top + 2)} width={w - 10} height="4" rx="2" fill="#2c2f33" />
    </g>
  );
}

export function ExpUnderSvg({ px }: { px: number }) {
  const b = ART.base;
  const { x: ax, y: ay } = ART.pivot;
  // The side plate: a hump rising off the base's top to carry the axle.
  const l = ax - 120;
  const r = ax + 120;
  const plate = `M${l} ${f1(baseTop(l) + 2)} C${l + 40} ${f1(baseTop(l) - 20)} ${ax - 54} ${ay - 12} ${ax} ${ay - 12} C${ax + 54} ${ay - 12} ${r - 40} ${f1(baseTop(r) - 20)} ${r} ${f1(baseTop(r) + 2)} Z`;
  const wedge = `M${b.x0} ${b.topHeel + 10} Q${b.x0} ${b.topHeel} ${b.x0 + 12} ${b.topHeel} L${b.x1 - 12} ${b.topToe} Q${b.x1} ${b.topToe} ${b.x1} ${b.topToe + 10} V${b.bottom - 8} Q${b.x1} ${b.bottom} ${b.x1 - 8} ${b.bottom} H${b.x0 + 8} Q${b.x0} ${b.bottom} ${b.x0} ${b.bottom - 8} Z`;
  return (
    <svg viewBox={box} width={px} height={height(px)}>
      <defs>
        <linearGradient id="base" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a3e44" />
          <stop offset="0.35" stopColor="#202326" />
          <stop offset="1" stopColor="#0e0f11" />
        </linearGradient>
        <linearGradient id="plate" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#30343a" />
          <stop offset="1" stopColor="#181a1d" />
        </linearGradient>
        <radialGradient id="floor" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#000" stopOpacity="0.5" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="480" cy="384" rx="490" ry="13" fill="url(#floor)" />
      <rect x="70" y="372" width="80" height="12" rx="5" fill="#060707" />
      <rect x="810" y="372" width="80" height="12" rx="5" fill="#060707" />
      <path d={plate} fill="url(#plate)" stroke="#000" strokeOpacity="0.6" strokeWidth="2" />
      <path d={wedge} fill="url(#base)" stroke="#000" strokeOpacity="0.65" strokeWidth="2" />
      <line
        x1={b.x0 + 16}
        y1={b.topHeel + 3}
        x2={b.x1 - 16}
        y2={b.topToe + 3}
        stroke="#fff"
        strokeOpacity="0.14"
      />
      <rect
        x={b.x0 + 34}
        y={b.topToe + 6}
        width={b.x1 - b.x0 - 68}
        height={b.bottom - b.topToe - 14}
        rx="6"
        fill="#0c0d0f"
        opacity="0.5"
      />
      <Stop {...STOPS.heel} />
      <Stop {...STOPS.toe} />
    </svg>
  );
}

/** The treadle's own box, in ART units: the plate, and the skirt hanging down round the
 *  axle. */
export const TREADLE_BOX = {
  x: TREADLE.x0 - 4,
  y: TREADLE.top - 6,
  w: TREADLE.x1 - TREADLE.x0 + 8,
  h: ART.pivot.y + 26 - (TREADLE.top - 6),
};

export function ExpTreadleSvg({ px }: { px: number }) {
  const b = TREADLE_BOX;
  const t = TREADLE;
  const { x: ax, y: ay } = ART.pivot;
  const grip = 24;
  return (
    <svg viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`} width={px} height={Math.round((px * b.h) / b.w)}>
      <defs>
        <linearGradient id="side" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#34383e" />
          <stop offset="1" stopColor="#141619" />
        </linearGradient>
        {/* the rubber tread: raised ribs across the treadle, seen end-on */}
        <pattern id="grip" width="22" height="20" patternUnits="userSpaceOnUse">
          <rect width="22" height="20" fill="#16181a" />
          <rect x="2" y="0" width="12" height="20" rx="3" fill="#24272b" />
          <rect x="2" y="0" width="12" height="2" rx="1" fill="#4a5057" />
        </pattern>
      </defs>
      {/* the skirt: the treadle's side cheek, hung on the axle */}
      <path
        d={`M${ax - 62} ${t.bottom - 4} L${ax - 30} ${ay + 6} Q${ax} ${ay + 24} ${ax + 30} ${ay + 6} L${ax + 62} ${t.bottom - 4} Z`}
        fill="url(#side)"
        stroke="#000"
        strokeOpacity="0.7"
        strokeWidth="2"
      />
      <rect
        x={t.x0 + 6}
        y={t.top + grip - 2}
        width={t.x1 - t.x0 - 12}
        height={t.bottom - t.top - grip + 2}
        rx={t.r}
        fill="url(#side)"
        stroke="#000"
        strokeOpacity="0.7"
        strokeWidth="2"
      />
      <line
        x1={t.x0 + 30}
        y1={t.bottom - 16}
        x2={t.x1 - 30}
        y2={t.bottom - 16}
        stroke="#000"
        strokeOpacity="0.35"
      />
      <line
        x1={t.x0 + 30}
        y1={t.bottom - 14}
        x2={t.x1 - 30}
        y2={t.bottom - 14}
        stroke="#fff"
        strokeOpacity="0.05"
      />
      <rect
        x={t.x0 + 24}
        y={t.top}
        width={t.x1 - t.x0 - 48}
        height={grip}
        rx="8"
        fill="url(#grip)"
      />
      <rect
        x={t.x0 + 24}
        y={t.top}
        width={t.x1 - t.x0 - 48}
        height={grip}
        rx="8"
        fill="none"
        stroke="#000"
        strokeOpacity="0.6"
        strokeWidth="2"
      />
    </svg>
  );
}

export function ExpOverSvg({ px }: { px: number }) {
  const { x: ax, y: ay } = ART.pivot;
  const s = ART.socket;
  return (
    <svg viewBox={box} width={px} height={height(px)}>
      <defs>
        <radialGradient id="bolt" cx="0.38" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#f1eadb" />
          <stop offset="0.5" stopColor="#a8a090" />
          <stop offset="1" stopColor="#4f4a42" />
        </radialGradient>
      </defs>
      {/* the axle pin through plate and skirt */}
      <circle cx={ax} cy={ay} r="15" fill="url(#bolt)" stroke="#2b2925" strokeWidth="2" />
      <circle cx={ax} cy={ay} r="5" fill="#26231f" />
      {/* the socket on the base's heel end */}
      <rect x={s.x - 4} y={s.y - 11} width="30" height="22" rx="4" fill="#8f897b" />
      <rect x={s.x - 4} y={s.y - 11} width="30" height="6" rx="3" fill="#d9d2c2" opacity="0.6" />
    </svg>
  );
}
