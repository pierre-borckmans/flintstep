import {
  CASE_R,
  FACE,
  fx,
  fy,
  H,
  JACK_X,
  ledPath,
  powerPath,
  REF,
  slot,
  tileBox,
  u,
  W,
} from "../../lib/sparkgeom";

// THE SPARK CONTROL X'S ART, as SVG components baked to textures (svgTexture). The
// drawing is the one the DOM pedal had, unchanged; what moved is where it ends up. Only
// what never changes is baked whole — the case, the trim, the brushed face, the legends,
// the A/B tiles. Everything that lights, turns, sinks or is selected is drawn on top of
// it by the scene, so a lamp changing colour costs a tint, not a re-bake.
//
// Each component takes `px`, the width it is rasterised at, and lays out in the case's
// own viewBox units (sparkgeom).

/** Avenir Next's cap height, as a fraction of the font size: sizes come from cap heights. */
const CAP = 0.708;
const FONT = "'Avenir Next', Avenir, Futura, 'Helvetica Neue', system-ui, sans-serif";

/** The case's MATERIALS: the tolex and the brushed face, made of noise filters. The
 *  expensive half to rasterise, and the half that needs no more resolution than the
 *  2x headroom gives it (noise does not go soft the way type and edges do), so it is
 *  baked once per size and never again for the zoom. */
export function CaseMaterialSvg({ px }: { px: number }) {
  const id = "case";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={px} height={Math.round((px * H) / W)}>
      <defs>
        <filter id={`${id}-tolex`} x="0" y="0" width="1" height="1">
          <feTurbulence type="turbulence" baseFrequency="0.11" numOctaves="2" seed="4" />
          <feDiffuseLighting surfaceScale="1.4" lightingColor="#1f1f1f">
            <feDistantLight azimuth="235" elevation="58" />
          </feDiffuseLighting>
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        <filter id={`${id}-brush`} x="0" y="0" width="1" height="1">
          <feTurbulence type="fractalNoise" baseFrequency="0.0025 0.75" numOctaves="2" seed="9" />
          <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.16 0 0 0 -0.03" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        <radialGradient id={`${id}-key`} cx="0.2" cy="0" r="1">
          <stop offset="0" stopColor="#fff4e4" stopOpacity="0.07" />
          <stop offset="0.7" stopColor="#fff4e4" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-shade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.05" />
          <stop offset="0.5" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.35" />
        </linearGradient>
      </defs>

      {/* tolex */}
      <rect width={W} height={H} rx={CASE_R} fill="#121110" />
      <rect width={W} height={H} rx={CASE_R} fill="#000" filter={`url(#${id}-tolex)`} />
      <rect width={W} height={H} rx={CASE_R} fill={`url(#${id}-shade)`} />
      <rect
        x="1"
        y="1"
        width={W - 2}
        height={H - 2}
        rx={CASE_R - 1}
        fill="none"
        stroke="#fff4e4"
        strokeOpacity="0.07"
        strokeWidth="2"
      />

      {/* the brushed face */}
      <rect x={FACE.x} y={FACE.y} width={FACE.w} height={FACE.h} rx="3" fill="#0d0d0e" />
      <rect
        x={FACE.x}
        y={FACE.y}
        width={FACE.w}
        height={FACE.h}
        rx="3"
        fill="#000"
        filter={`url(#${id}-brush)`}
      />
      <rect x={FACE.x} y={FACE.y} width={FACE.w} height={FACE.h} rx="3" fill={`url(#${id}-key)`} />
      <rect
        x={FACE.x + 0.5}
        y={FACE.y + 0.5}
        width={FACE.w - 1}
        height={FACE.h - 1}
        rx="3"
        fill="none"
        stroke="#000"
        strokeOpacity="0.8"
        strokeWidth="2"
      />
      <line
        x1={FACE.x + 3}
        y1={FACE.y + FACE.h - 1}
        x2={FACE.x + FACE.w - 3}
        y2={FACE.y + FACE.h - 1}
        stroke="#fff4e4"
        strokeOpacity="0.08"
      />
    </svg>
  );
}

/** The case's CRISP parts: the trim, the legends, the jack sockets, the A/B tiles and
 *  the LEDs' housings. No filters, so it is cheap to re-bake when the zoom outgrows it. */
export function CaseCrispSvg({ px }: { px: number }) {
  const id = "crisp";
  const letterCap = u(REF.letter.cap);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={px} height={Math.round((px * H) / W)}>
      <defs>
        <linearGradient id={`${id}-trim`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7a6136" />
          <stop offset="0.45" stopColor="#e9cf96" />
          <stop offset="1" stopColor="#8d7142" />
        </linearGradient>
        <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#ead7a8" />
          <stop offset="0.55" stopColor="#d2b882" />
          <stop offset="1" stopColor="#b49967" />
        </linearGradient>
      </defs>
      {/* gold trim strips, top to bottom along each side */}
      {REF.strip.x.map((x) => (
        <rect
          key={x}
          x={fx(x) - u(REF.strip.w) / 2}
          y={fy(REF.strip.y0)}
          width={u(REF.strip.w)}
          height={u(REF.strip.y1 - REF.strip.y0)}
          rx={u(REF.strip.w) / 2.5}
          fill={`url(#${id}-trim)`}
        />
      ))}

      {/* panel legends */}
      <g
        fontFamily={FONT}
        fontWeight="700"
        fontSize={u(REF.legend.cap) / CAP}
        fill="#e2cfa5"
        fillOpacity="0.88"
        textAnchor="middle"
      >
        {(
          [
            ["POWER", REF.power, REF.legend.top],
            ["CONNECT", REF.connect, REF.legend.top],
            ["AMP", REF.amp, REF.legend.bottom],
            ["APP", REF.app, REF.legend.bottom],
          ] as const
        ).map(([text, at, base]) => (
          <text
            key={text}
            x={fx(at.x)}
            y={fy(base)}
            textLength={u(at.w)}
            lengthAdjust="spacingAndGlyphs"
          >
            {text}
          </text>
        ))}
      </g>

      {/* the jack sockets on the back edge */}
      {JACK_X.map((f) => (
        <rect key={f} x={f * W - 13} y="-2" width="26" height="9" rx="4" fill="#050505" />
      ))}

      {/* A and B: the letter on a solid gold tile */}
      {[2, 5].map((n) => {
        const t = tileBox(n);
        const name = n === 2 ? "A" : "B";
        const { x, top } = slot(n);
        const ly = top ? fy(REF.letter.y) : 2 * fy(REF.axis) - fy(REF.letter.y);
        return (
          <g key={n}>
            <rect
              x={t.x}
              y={t.y}
              width={t.w}
              height={t.h}
              rx={u(REF.tile.r)}
              fill={`url(#${id}-tile)`}
              stroke="#fff3d6"
              strokeOpacity="0.35"
            />
            <text
              x={x}
              y={ly + letterCap / 2}
              textAnchor="middle"
              fontFamily={FONT}
              fontWeight={800}
              fontSize={letterCap / CAP}
              textLength={u(REF.letter.w[name] ?? REF.letter.cap)}
              lengthAdjust="spacingAndGlyphs"
              fill="#241b10"
            >
              {name}
            </text>
          </g>
        );
      })}

      {/* every LED's dark housing, which shows whether or not it is lit */}
      <g fill="none" stroke="#0a0b0c" strokeLinecap="round">
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <path key={n} d={ledPath(n)} strokeWidth={u(REF.led.thick) + 4} />
        ))}
        <path d={powerPath()} strokeWidth={u(REF.lamp.thick) + 4} />
        {[REF.lamp.amp, REF.lamp.app].map((x) => (
          <path key={x} d={`M${fx(x)} ${fy(REF.axis)} h0.01`} strokeWidth={u(REF.lamp.dot) + 4} />
        ))}
      </g>
    </svg>
  );
}

/** The footswitch cap: a round nickel bushing with a domed top. `CAP_BOX` viewBox units
 *  square, centred. */
export const CAP_BOX = Math.ceil(u(REF.cap.ring) * 2 + 6);
export function CapSvg({ px }: { px: number }) {
  const c = CAP_BOX / 2;
  const [ring, dome] = [u(REF.cap.ring), u(REF.cap.dome)];
  return (
    <svg viewBox={`0 0 ${CAP_BOX} ${CAP_BOX}`} width={px} height={px}>
      <defs>
        <radialGradient id="cap" cx="0.38" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#fbf6ea" />
          <stop offset="0.45" stopColor="#d9d0bd" />
          <stop offset="0.85" stopColor="#9d9483" />
          <stop offset="1" stopColor="#6f685c" />
        </radialGradient>
        <radialGradient id="captop" cx="0.42" cy="0.36" r="0.7">
          <stop offset="0" stopColor="#fffaf0" />
          <stop offset="0.6" stopColor="#e3dac6" />
          <stop offset="1" stopColor="#b8ae99" />
        </radialGradient>
      </defs>
      <circle cx={c} cy={c} r={ring} fill="url(#cap)" stroke="#5d574d" strokeWidth="1.5" />
      <circle cx={c} cy={c} r={dome} fill="url(#captop)" />
      <circle
        cx={c}
        cy={c}
        r={dome}
        fill="none"
        stroke="#fff"
        strokeOpacity="0.35"
        strokeWidth="1"
      />
    </svg>
  );
}

/** The hex nut at 0°: points up and down, flats left and right, lit from the top left.
 *  `NUT_BOX` viewBox units square, centred. The scene turns the sprite. */
export const NUT_BOX = Math.ceil(u(REF.nut.r) * 2 + 6);
const NUT_STOPS: [number, string][] = [
  [0, "#f1eadb"],
  [0.35, "#bfb6a3"],
  [0.7, "#8e8676"],
  [1, "#5f594f"],
];
export function NutSvg({ px }: { px: number }) {
  const c = NUT_BOX / 2;
  const r = u(REF.nut.r);
  const f = r * (Math.sqrt(3) / 2);
  const pts = Array.from({ length: 6 }, (_, k) => {
    const a = ((-90 + k * 60) * Math.PI) / 180;
    return `${(c + r * Math.cos(a)).toFixed(2)},${(c + r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${NUT_BOX} ${NUT_BOX}`} width={px} height={px}>
      <defs>
        <linearGradient
          id="nut"
          gradientUnits="userSpaceOnUse"
          x1={c - f}
          y1={c - r}
          x2={c + f}
          y2={c + r}
        >
          {NUT_STOPS.map(([o, col]) => (
            <stop key={o} offset={o} stopColor={col} />
          ))}
        </linearGradient>
      </defs>
      <polygon
        points={pts}
        fill="url(#nut)"
        stroke="#4b463e"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A light's glow, white, to be tinted to the lamp's colour: the LED's stroke, blurred.
 *  One texture per SHAPE — a top-row smile, a bottom-row frown, the POWER bar, a dot —
 *  so no lamp ever blurs anything at run time. `box` is the viewBox it is drawn in,
 *  centred on the lamp. */
export type GlowShape = "smile" | "frown" | "bar" | "dot";
export const GLOW_BOX: Record<GlowShape, { w: number; h: number }> = {
  smile: { w: 220, h: 140 },
  frown: { w: 220, h: 140 },
  bar: { w: 180, h: 120 },
  dot: { w: 120, h: 120 },
};
export function GlowSvg({ shape, px }: { shape: GlowShape; px: number }) {
  const box = GLOW_BOX[shape];
  const cx = box.w / 2;
  const cy = box.h / 2;
  let d: string;
  let width: number;
  let blur: number;
  if (shape === "smile" || shape === "frown") {
    // A switch LED, re-centred: ledPath's geometry about (0, 0).
    const half = u(REF.led.len - REF.led.thick) / 2;
    const sag = u(REF.led.sag) * (shape === "smile" ? 1 : -1);
    d = `M${cx - half} ${cy - sag / 2} Q${cx} ${cy + sag * 1.5} ${cx + half} ${cy - sag / 2}`;
    width = u(REF.led.thick) * (1.4 + 1.8);
    blur = 9;
  } else if (shape === "bar") {
    const half = u(REF.lamp.len - REF.lamp.thick) / 2;
    d = `M${cx - half} ${cy} h${2 * half}`;
    width = u(REF.lamp.thick) * (1.4 + 1.8 * 0.4);
    blur = 7;
  } else {
    d = `M${cx} ${cy} h0.01`;
    width = u(REF.lamp.dot) * (1.4 + 1.8 * 0.25);
    blur = 7;
  }
  return (
    <svg viewBox={`0 0 ${box.w} ${box.h}`} width={px} height={Math.round((px * box.h) / box.w)}>
      <defs>
        <filter id="glow" filterUnits="userSpaceOnUse" x="0" y="0" width={box.w} height={box.h}>
          <feGaussianBlur stdDeviation={blur} />
        </filter>
      </defs>
      <path
        d={d}
        stroke="#fff"
        strokeWidth={width}
        strokeLinecap="round"
        fill="none"
        filter="url(#glow)"
      />
    </svg>
  );
}

/** The case's two shadows on the stage (style.css --shadow-contact, --shadow-cast), white
 *  to be tinted. In layout px round a case `w` wide, `SHADOW_PAD` px of margin. */
export const SHADOW_PAD = 90;
export function ShadowSvg({
  w,
  px,
  contact,
  cast,
}: {
  w: number;
  px: number;
  contact: number;
  cast: number;
}) {
  const h = (w * H) / W;
  const r = (CASE_R * w) / W;
  const bw = w + SHADOW_PAD * 2;
  const bh = h + SHADOW_PAD * 2;
  // box-shadow: x y blur spread. The blur radius is twice the Gaussian's deviation.
  const layer = (dx: number, dy: number, blur: number, spread: number, a: number, id: string) => (
    <g key={id}>
      <filter id={id} filterUnits="userSpaceOnUse" x="0" y="0" width={bw} height={bh}>
        <feGaussianBlur stdDeviation={blur / 2} />
      </filter>
      <rect
        x={SHADOW_PAD + dx - spread}
        y={SHADOW_PAD + dy - spread}
        width={w + spread * 2}
        height={h + spread * 2}
        rx={Math.max(0, r + spread)}
        fill="#fff"
        fillOpacity={a}
        filter={`url(#${id})`}
      />
    </g>
  );
  return (
    <svg viewBox={`0 0 ${bw} ${bh}`} width={px} height={Math.round((px * bh) / bw)}>
      {layer(12, 32, 36, -8, cast, "cast")}
      {layer(2, 5, 6, -1, contact, "contact")}
    </svg>
  );
}
