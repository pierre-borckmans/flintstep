import { ART } from "../../lib/exppedal";

// THE EXPRESSION PEDAL'S ART: a generic treadle pedal in side view (no brand's), toe to
// the right. The DOM version's drawing, cut into the three layers the treadle sits
// between, so the treadle can be a sprite the scene turns on its axle — free on the GPU —
// instead of a re-rendered SVG per frame of the spring.
//
//   under    the floor shadow, the feet, the base, the toe stop
//   treadle  the plate and its rubber tread, in its own box (TREADLE_BOX)
//   over     the hinge block, the axle bolt and the socket the cable goes into
//
// `under` and `over` are drawn in ART's viewBox (1000 x 300 from y0); `px` is the width
// they are rasterised at.

const box = `0 ${ART.y0} ${ART.w} ${ART.h}`;
const height = (px: number) => Math.round((px * ART.h) / ART.w);

export function ExpUnderSvg({ px }: { px: number }) {
  return (
    <svg viewBox={box} width={px} height={height(px)}>
      <defs>
        <linearGradient id="base" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a3e44" />
          <stop offset="0.35" stopColor="#202326" />
          <stop offset="1" stopColor="#0e0f11" />
        </linearGradient>
        <radialGradient id="floor" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#000" stopOpacity="0.5" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="480" cy="384" rx="490" ry="13" fill="url(#floor)" />
      <rect x="70" y="368" width="80" height="16" rx="5" fill="#060707" />
      <rect x="790" y="368" width="80" height="16" rx="5" fill="#060707" />
      <rect
        x={ART.base.x0}
        y="298"
        width={ART.base.x1 - ART.base.x0}
        height="74"
        rx="14"
        fill="url(#base)"
        stroke="#000"
        strokeOpacity="0.65"
        strokeWidth="2"
      />
      <rect x="74" y="318" width="790" height="36" rx="7" fill="#0c0d0f" opacity="0.55" />
      <line x1="56" y1="301" x2="884" y2="301" stroke="#fff" strokeOpacity="0.14" />
      <rect x="812" y="289" width="58" height="11" rx="4" fill="#0a0b0c" />
    </svg>
  );
}

/** The treadle's own box, in ART units. */
export const TREADLE_BOX = { x: 60, y: 220, w: 870, h: 76 };

export function ExpTreadleSvg({ px }: { px: number }) {
  const b = TREADLE_BOX;
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
      <rect
        x="66"
        y="246"
        width="858"
        height="44"
        rx="14"
        fill="url(#side)"
        stroke="#000"
        strokeOpacity="0.7"
        strokeWidth="2"
      />
      <line x1="90" y1="270" x2="900" y2="270" stroke="#000" strokeOpacity="0.35" />
      <line x1="90" y1="272" x2="900" y2="272" stroke="#fff" strokeOpacity="0.05" />
      <rect x="84" y="226" width="822" height="24" rx="8" fill="url(#grip)" />
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
    </svg>
  );
}

export function ExpOverSvg({ px }: { px: number }) {
  const { x: px0, y: py } = ART.pivot;
  return (
    <svg viewBox={box} width={px} height={height(px)}>
      <defs>
        <linearGradient id="cheek" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2c3035" />
          <stop offset="1" stopColor="#17191c" />
        </linearGradient>
        <radialGradient id="bolt" cx="0.38" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#f1eadb" />
          <stop offset="0.5" stopColor="#a8a090" />
          <stop offset="1" stopColor="#4f4a42" />
        </radialGradient>
      </defs>
      <path
        d="M60 300 V272 Q60 262 70 262 H156 Q166 262 166 272 V300 Z"
        fill="url(#cheek)"
        stroke="#000"
        strokeOpacity="0.55"
        strokeWidth="2"
      />
      <line x1="66" y1="265" x2="160" y2="265" stroke="#fff" strokeOpacity="0.1" />
      <circle cx={px0} cy={py} r="14" fill="url(#bolt)" stroke="#2b2925" strokeWidth="2" />
      <circle cx={px0} cy={py} r="4.5" fill="#26231f" />
      <rect x="16" y="320" width="28" height="24" rx="4" fill="#8f897b" />
      <rect x="16" y="320" width="28" height="7" rx="3" fill="#d9d2c2" opacity="0.6" />
    </svg>
  );
}
