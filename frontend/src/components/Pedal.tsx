import { memo, useId } from "react";
import { actionCaption, longCaption } from "../lib/caption";
import { isDark, lampLight, rgb } from "../lib/colour";
import { degText } from "../lib/nuts";
import { POWER_RGB, type PowerColour, powerLamp } from "../lib/power";
import type { Colour, Config, Status } from "../types";
import { LAMP_AMP, LAMP_APP, SWITCH_NAMES } from "../types";
import { cx } from "../ui/cx";
import { useNutGestures, useNuts, useNutTween } from "../useNuts";
import "./Pedal.css";

// THE PEDAL, TOP-DOWN, drawn as the Spark Control X looks: a black brushed-metal face in a
// tolex case with gold trim, three columns of nickel footswitches (I/III, II/IV, A/B), each
// with a curved LED bar showing exactly what status.lamps says the hardware is showing.
//
// Three layers share one viewBox: the case (static, textured, memoised so the LEDs never
// repaint its filters), the status lamps, and one <button> per switch whose own <svg> crops
// the same coordinate space to its group. Captions sit outside the case, above the top row
// and below the bottom row. The jacks are on the back edge, the top of this view.

// REFERENCE GEOMETRY, measured off the straight top-down product shot (1080x461, face
// 675px wide at x 207..882, y 55.5..388). Every number is normalised to the face width
// (face = 1 wide), origin at the face's top-left corner; y grows downwards. Positions are
// for the top row; the bottom row mirrors them about `axis`, the face's horizontal centre
// line (the photo agrees to within a pixel on brackets, LEDs and numerals; the nuts sit
// ~2px further out from it, which is camera parallax on their height, so they're averaged).
// The SVG constants below are all derived from this table: check edits against it.
//
//   case       x -0.0615..1.0600  y -0.0600..0.5644  corner r 0.056   (tolex, ~0.06 rim)
//   strips     gold, centres x -0.0081 / 1.0067, 0.0119 wide, y -0.0496..0.5415
//   face       x 0..1  y 0..0.4926                                      axis y 0.2463
//   columns    I/III 0.0647, II/IV 0.5, A/B 0.9353 (measured 0.0652, 0.5012, 0.9359)
//   bracket    stroke-centre half-width 0.0399, top y 0.0107, bottom y 0.2089,
//              corners r 0.0126 (top) / 0.0111 (bottom), stroke 0.0022. The bottom edge
//              is only the two corner arcs: each stops where it turns horizontal, leaving
//              a gap of a FIXED width (0.0533 edge to edge) on every bracket. The numeral
//              is centred in it, so its padding is equal left and right, and is
//              I 0.0226, II 0.0156, III 0.0081, IV 0.0044 per side.
//   nut        hex, points up and down, centre y 0.067, vertex radius 0.0541
//   cap        bushing ring r 0.0378, domed top r 0.0304; key slot 0.0089 x 0.005 at -0.040
//   LED        y 0.1541, 0.0652 long overall, 0.0207 thick, sags 0.0022 at its middle
//              (a smile on the top row, a frown on the bottom row)
//   numerals   cap height 0.0307, centre y 0.2059 (a hair above the bracket's bottom
//              edge); bars 0.0085 wide, 0.0052 apart; the V 0.0311 wide at the top,
//              0.0104 at its flat foot, arms 0.0089 thick, notch 0.6 of the height deep.
//              Widths: I 0.0085, II 0.0222, III 0.0359, IV 0.0448.
//   A/B tile   half-width 0.0404, y 0.0074..0.2163, r 0.0119; letter cap height 0.0311,
//              centre y 0.1893, A 0.0267 wide, B 0.0222 wide
//   wordmark   "Spark" ink x 0.1644..0.3993, cap top 0.2081, baseline 0.2607;
//              "CONTROL X" ink x 0.2844..0.4007, cap height 0.0141, baseline 0.2844
//   legends    cap height 0.0135. POWER centre x 0.6652, 0.0541 wide; CONNECT 0.7793,
//              0.0719 wide; both baseline 0.2178. AMP 0.7470 (0.0333 wide), APP 0.8107
//              (0.0304 wide), baseline 0.2830
//   lamps      on the axis: POWER bar centre x 0.6641, 0.0570 long, 0.0222 thick;
//              AMP dot 0.7474, APP dot 0.8111, 0.016 across (lens and halo)
const REF = {
  case: { x0: -0.0615, x1: 1.06, y0: -0.06, y1: 0.5644, r: 0.056 },
  strip: { x: [-0.0081, 1.0067], w: 0.0119, y0: -0.0496, y1: 0.5415 },
  face: { h: 0.4926 },
  axis: 0.2463,
  col: [0.0647, 0.5, 0.9353],
  bracket: { half: 0.0399, y0: 0.0107, y1: 0.2089, rTop: 0.0126, rBot: 0.0111, stroke: 0.0022 },
  nut: { y: 0.067, r: 0.0541 },
  cap: { ring: 0.0378, dome: 0.0304, slot: { w: 0.0089, h: 0.005, dy: -0.04 } },
  led: { y: 0.1541, len: 0.0652, thick: 0.0207, sag: 0.0022 },
  numeral: {
    y: 0.2059,
    cap: 0.0307,
    bar: 0.0085,
    gap: 0.0052,
    vTop: 0.0311,
    vFoot: 0.0104,
    arm: 0.0089,
  },
  tile: { half: 0.0404, y0: 0.0074, y1: 0.2163, r: 0.0119 },
  letter: { y: 0.1893, cap: 0.0311, w: { A: 0.0267, B: 0.0222 } as Record<string, number> },
  spark: { x0: 0.1644, x1: 0.3993, cap: 0.0526, base: 0.2607 },
  control: { x0: 0.2844, x1: 0.4007, cap: 0.0141, base: 0.2844 },
  legend: { cap: 0.0135, top: 0.2178, bottom: 0.283 },
  power: { x: 0.6652, w: 0.0541 },
  connect: { x: 0.7793, w: 0.0719 },
  amp: { x: 0.747, w: 0.0333 },
  app: { x: 0.8107, w: 0.0304 },
  lamp: { power: 0.6641, len: 0.057, thick: 0.0222, amp: 0.7474, app: 0.8111, dot: 0.016 },
};

/** The case is 1000 wide; one face width is U viewBox units. */
const W = 1000;
const U = W / (REF.case.x1 - REF.case.x0);
const H = Math.round((REF.case.y1 - REF.case.y0) * U);
/** Face-normalised -> viewBox: a length, an x, a y. */
const u = (n: number) => n * U;
const fx = (n: number) => (n - REF.case.x0) * U;
const fy = (n: number) => (n - REF.case.y0) * U;
const CASE_R = u(REF.case.r);
const FACE = { x: fx(0), y: fy(0), w: u(1), h: u(REF.face.h) };
/** Avenir Next's cap height, as a fraction of the font size: sizes come from cap heights. */
const CAP = 0.708;
const FONT = "'Avenir Next', Avenir, Futura, 'Helvetica Neue', system-ui, sans-serif";
const BLACK: Colour = { r: 0, g: 0, b: 0 };

/** Column centres, and the axis the bottom row mirrors the top row about (MIRROR - y). */
const COL = REF.col.map(fx);
const MIRROR = 2 * fy(REF.axis);
/** Each switch's group, top row: from the nut's top point to the numeral's foot, as wide
 *  as the nut. It is the hit area. */
const GROUP = {
  y0: fy(REF.nut.y - REF.nut.r) - 4,
  y1: fy(REF.numeral.y + REF.numeral.cap / 2) + 4,
  half: u(REF.nut.r) + 2,
};
/** Margin drawn round each switch's hit area, in viewBox units. */
const PAD = 40;
const SW_Y = fy(REF.nut.y);
const LED_Y = fy(REF.led.y);

const slot = (n: number) => ({ x: COL[n % 3], top: n < 3, tile: n % 3 === 2 });
const pct = (v: number, of: number) => `${(v / of) * 100}%`;
/** The EXP jacks sit on the back edge, in the gaps between the top row's captions. */
const JACK_X = [0.323, 0.683];

/** The nut's nickel, lit from the top left. */
const NUT_STOPS: [number, string][] = [
  [0, "#f1eadb"],
  [0.35, "#bfb6a3"],
  [0.7, "#8e8676"],
  [1, "#5f594f"],
];

/** A hex nut turned `deg` clockwise from points-up-and-down, round (x, cy). */
function nutPath(x: number, cy: number, r: number, deg: number) {
  const pts = Array.from({ length: 6 }, (_, k) => {
    const a = ((deg - 90 + k * 60) * Math.PI) / 180;
    return `${(x + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  });
  return `M${pts.join(" L")} Z`;
}

/** Shared gradients for the metalwork, referenced from every layer by id. */
function Defs({ id }: { id: string }) {
  return (
    <svg aria-hidden width="0" height="0" className="absolute">
      <defs>
        <radialGradient id={`${id}-cap`} cx="0.38" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#fbf6ea" />
          <stop offset="0.45" stopColor="#d9d0bd" />
          <stop offset="0.85" stopColor="#9d9483" />
          <stop offset="1" stopColor="#6f685c" />
        </radialGradient>
        <radialGradient id={`${id}-captop`} cx="0.42" cy="0.36" r="0.7">
          <stop offset="0" stopColor="#fffaf0" />
          <stop offset="0.6" stopColor="#e3dac6" />
          <stop offset="1" stopColor="#b8ae99" />
        </radialGradient>
        <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ecd39d" />
          <stop offset="0.5" stopColor="#c9a96b" />
          <stop offset="1" stopColor="#9c7d48" />
        </linearGradient>
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
    </svg>
  );
}

/** The case: tolex, gold trim, brushed face, the wordmark and the panel legends. */
const Case = memo(function Case({ id }: { id: string }) {
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${W} ${H}`}
      className="absolute inset-0 h-full w-full"
      style={{ transform: "translateZ(0)" }}
    >
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

      {/* wordmark: set in type, not traced, stretched to the measured ink widths */}
      <g fontFamily={FONT} fill={`url(#${id}-gold)`}>
        <text
          x={fx(REF.spark.x0)}
          y={fy(REF.spark.base)}
          fontSize={u(REF.spark.cap) / CAP}
          fontWeight="700"
          textLength={u(REF.spark.x1 - REF.spark.x0)}
          lengthAdjust="spacingAndGlyphs"
        >
          Spark
        </text>
        <text
          x={fx(REF.control.x0)}
          y={fy(REF.control.base)}
          fontSize={u(REF.control.cap) / CAP}
          fontWeight="700"
          textLength={u(REF.control.x1 - REF.control.x0)}
          lengthAdjust="spacingAndGlyphs"
        >
          CONTROL X
        </text>
      </g>

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
    </svg>
  );
});

/** A curved LED bar: a smile on the top row, a frown on the bottom row. */
function ledPath(x: number, y: number, top: boolean) {
  // the stroke's round caps add half its width at each end; the quadratic's control point
  // sits twice the sag off the chord, so its middle sags by exactly the measured amount
  const half = u(REF.led.len - REF.led.thick) / 2;
  const sag = u(REF.led.sag) * (top ? 1 : -1);
  return `M${x - half} ${y - sag / 2} Q${x} ${y + sag * 1.5} ${x + half} ${y - sag / 2}`;
}

/** The numerals as drawn shapes, not type: upright bars and a flat-footed V, so their
 *  width (and so their centring in the bracket's gap) never depends on a font. */
function numeralPath(name: string, x: number, cy: number) {
  const n = REF.numeral;
  const h = u(n.cap);
  const glyph = (c: string) => u(c === "V" ? n.vTop : n.bar);
  const chars = [...name];
  const width = chars.reduce((s, c) => s + glyph(c), 0) + u(n.gap) * (chars.length - 1);
  const top = cy - h / 2;
  const bottom = cy + h / 2;
  let left = x - width / 2;
  let d = "";
  for (const c of chars) {
    const gw = glyph(c);
    if (c === "V") {
      const mid = left + gw / 2;
      const arm = u(n.arm);
      const foot = u(n.vFoot) / 2;
      d += `M${left} ${top} H${left + arm} L${mid} ${top + h * 0.6} L${left + gw - arm} ${top} H${left + gw} L${mid + foot} ${bottom} H${mid - foot} Z`;
    } else {
      d += `M${left} ${top} h${gw} V${bottom} h${-gw} Z`;
    }
    left += gw + u(n.gap);
  }
  return d;
}

/** The light: a slate bar when dark; when lit, a hot core, the colour, and a pool of
 *  light spilling onto the face. Dimmed LEDs read dimmer, not browner. */
function LedBar({
  d,
  lamp,
  glowId,
  width = 17,
  glow = 1,
}: {
  d: string;
  lamp: Colour | undefined;
  glowId: string;
  width?: number;
  /** How far the light spills, and how hot its centre looks, 1 = the switch LEDs. The
   *  POWER pill and the AMP/APP dots are small frosted windows on the real pedal: their
   *  light stays close and reads as an even colour, not a white-hot point. */
  glow?: number;
}) {
  const { colour: c, level } = lampLight(lamp ?? BLACK);
  const lit = !isDark(lamp);
  const a = 0.25 + 0.75 * level;
  const core = {
    r: (c.r + 255 * 1.4) / 2.4,
    g: (c.g + 255 * 1.4) / 2.4,
    b: (c.b + 255 * 1.4) / 2.4,
  };
  return (
    <g className="pedal-led" strokeLinecap="round" fill="none">
      <path d={d} stroke="#0a0b0c" strokeWidth={width + 4} />
      <path d={d} stroke="#323a42" strokeWidth={width} style={{ opacity: lit ? 0 : 1 }} />
      <path
        d={d}
        stroke={rgb(c)}
        strokeWidth={width * (1.4 + 1.8 * glow)}
        filter={`url(#${glowId})`}
        style={{ opacity: lit ? 0.55 * a * glow : 0 }}
      />
      <path
        d={d}
        stroke={rgb(c)}
        strokeWidth={width}
        style={{ opacity: lit ? 0.4 + 0.6 * a : 0 }}
      />
      <path
        d={d}
        stroke={rgb(core)}
        strokeWidth={width * 0.42}
        style={{ opacity: lit ? (0.35 + 0.6 * a) * Math.min(1, 0.25 + glow) : 0 }}
      />
    </g>
  );
}

function Lamps({
  id,
  lamps,
  power: powerLed,
}: {
  id: string;
  lamps: Colour[];
  power: { colour: PowerColour; blink: boolean };
}) {
  // POWER mirrors the pedal's: its colour from the charge level, blinking while charging.
  const power: Colour = POWER_RGB[powerLed.colour];
  const powerHalf = u(REF.lamp.len - REF.lamp.thick) / 2;
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${W} ${H}`}
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
    >
      <defs>
        <filter
          id={`${id}-lampglow`}
          filterUnits="userSpaceOnUse"
          x={fx(REF.lamp.power) - 80}
          y={MIRROR / 2 - 60}
          width={fx(REF.lamp.app) - fx(REF.lamp.power) + 160}
          height="120"
        >
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>
      <g className={cx(powerLed.blink && "pedal-power-blink")}>
        <LedBar
          d={`M${fx(REF.lamp.power) - powerHalf} ${MIRROR / 2} h${2 * powerHalf}`}
          lamp={power}
          glowId={`${id}-lampglow`}
          width={u(REF.lamp.thick)}
          glow={0.4}
        />
      </g>
      {(
        [
          [REF.lamp.amp, LAMP_AMP],
          [REF.lamp.app, LAMP_APP],
        ] as const
      ).map(([x, n]) => (
        <LedBar
          key={n}
          d={`M${fx(x)} ${MIRROR / 2} h0.01`}
          lamp={lamps[n]}
          glowId={`${id}-lampglow`}
          width={u(REF.lamp.dot)}
          glow={0.25}
        />
      ))}
    </svg>
  );
}

function FootSwitch({
  id,
  index,
  lamp,
  held,
  selected,
  label,
  onSelect,
  nutAngle,
  turnable,
  peek,
}: {
  id: string;
  index: number;
  lamp: Colour | undefined;
  held: boolean;
  selected: boolean;
  label: string;
  onSelect: (n: number) => void;
  /** The hex nut's rotation, degrees in [0, 60). */
  nutAngle: number;
  /** Match my pedal: the nut turns by hand. */
  turnable: boolean;
  /** Show the angle readout without hovering (browser dev screenshots). */
  peek: boolean;
}) {
  const { x, top, tile } = slot(index);
  const y = (v: number) => (top ? v : MIRROR - v);
  const y0 = top ? GROUP.y0 : MIRROR - GROUP.y1;
  const h = GROUP.y1 - GROUP.y0;
  const w = GROUP.half * 2;
  const name = SWITCH_NAMES[index];
  // the bracket: up the sides and round the top; at the bottom each corner arc stops as
  // it turns horizontal, and the numeral sits centred in the gap between the two
  const b = REF.bracket;
  const bx = u(b.half);
  const [rt, rb] = [u(b.rTop), u(b.rBot)];
  const [bt, bb] = [y(fy(b.y0)), y(fy(b.y1))];
  const sy = top ? 1 : -1;
  // clockwise on screen for the top row; the bottom row's mirror image runs the other way
  const arc = (r: number) => `A${r} ${r} 0 0 ${top ? 1 : 0}`;
  const bracket = [
    `M${x - bx + rb} ${bb}`,
    `${arc(rb)} ${x - bx} ${bb - sy * rb}`,
    `V${bt + sy * rt}`,
    `${arc(rt)} ${x - bx + rt} ${bt}`,
    `H${x + bx - rt}`,
    `${arc(rt)} ${x + bx} ${bt + sy * rt}`,
    `V${bb - sy * rb}`,
    `${arc(rb)} ${x + bx - rb} ${bb}`,
  ].join(" ");
  // the hex nut: at 0° points up and down, flats left and right; it turns round the cap's
  // centre, and its light stays put (the gradient is fixed to the 0° nut's box on screen)
  const cy = y(SW_Y);
  const nr = u(REF.nut.r);
  const nf = nr * (Math.sqrt(3) / 2);
  const tween = useNutTween(nutAngle);
  const nut = nutPath(x, cy, nr, tween.angle);
  const gesture = useNutGestures({
    index,
    enabled: turnable,
    box: { x: x - GROUP.half, y: y0, w, h },
    centre: { x, y: cy },
    r: nr,
    jump: tween.jump,
  });
  // the readout sits in the gap between the nut's tip and the LED
  const readoutY = y(fy((REF.nut.y + REF.nut.r + REF.led.y - REF.led.thick / 2) / 2));
  const tileY = [y(fy(REF.tile.y0)), y(fy(REF.tile.y1))];
  const letterCap = u(REF.letter.cap);
  const [ring, dome] = [u(REF.cap.ring), u(REF.cap.dome)];
  // the selection plate: just outside the group, from above the nut to below the numeral
  const plateY = [y(SW_Y - nr - 8), y(fy(REF.numeral.y + REF.numeral.cap / 2) + 8)];
  const plateHalf = nf + 9;

  return (
    <button
      ref={gesture.ref}
      type="button"
      onClick={() => {
        if (!gesture.swallowClick()) onSelect(index);
      }}
      {...gesture.handlers}
      aria-pressed={selected}
      aria-label={`Switch ${name}: ${label}`}
      className="pedal-switch absolute overflow-visible outline-none"
      data-nut={turnable ? (gesture.dragging ? "drag" : gesture.over ? "over" : "on") : undefined}
      style={{ left: pct(x - GROUP.half, W), top: pct(y0, H), width: pct(w, W), height: pct(h, H) }}
    >
      {/* drawn with a margin round the hit area so the LED's light can spill past it */}
      <svg
        aria-hidden
        viewBox={`${x - GROUP.half - PAD} ${y0 - PAD} ${w + 2 * PAD} ${h + 2 * PAD}`}
        className="pointer-events-none absolute max-w-none"
        style={{
          left: `-${pct(PAD, w)}`,
          top: `-${pct(PAD, h)}`,
          width: pct(w + 2 * PAD, w),
          height: pct(h + 2 * PAD, h),
        }}
      >
        <defs>
          <filter
            id={`${id}-glow-${index}`}
            filterUnits="userSpaceOnUse"
            x={x - 110}
            y={y(LED_Y) - 70}
            width="220"
            height="140"
          >
            <feGaussianBlur stdDeviation="9" />
          </filter>
          <linearGradient
            id={`${id}-nut-${index}`}
            gradientUnits="userSpaceOnUse"
            gradientTransform={`matrix(${2 * nf} 0 0 ${2 * nr} ${x - nf} ${cy - nr})`}
            x1="0"
            y1="0"
            x2="1"
            y2="1"
          >
            {NUT_STOPS.map(([o, c]) => (
              <stop key={o} offset={o} stopColor={c} />
            ))}
          </linearGradient>
        </defs>
        <rect
          className="pedal-plate"
          x={x - plateHalf}
          y={Math.min(...plateY)}
          width={plateHalf * 2}
          height={Math.abs(plateY[1] - plateY[0])}
          rx="16"
        />
        {tile ? (
          <rect
            className="pedal-tile"
            x={x - u(REF.tile.half)}
            y={Math.min(...tileY)}
            width={u(REF.tile.half) * 2}
            height={Math.abs(tileY[1] - tileY[0])}
            rx={u(REF.tile.r)}
            fill={`url(#${id}-tile)`}
            stroke="#fff3d6"
            strokeOpacity="0.35"
          />
        ) : (
          <path
            className="pedal-bracket"
            d={bracket}
            fill="none"
            strokeWidth={u(b.stroke)}
            strokeLinecap="round"
          />
        )}

        <LedBar
          d={ledPath(x, y(LED_Y), top)}
          lamp={lamp}
          glowId={`${id}-glow-${index}`}
          width={u(REF.led.thick)}
        />

        {tile ? (
          // the letter on the tile, its cap height centred on the measured line
          <text
            x={x}
            y={y(fy(REF.letter.y)) + letterCap / 2}
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
        ) : (
          <path className="pedal-label" d={numeralPath(name, x, y(fy(REF.numeral.y)))} />
        )}

        {/* the footswitch: hex nut, then a round nickel cap that sinks when held */}
        {turnable && <circle className="pedal-nut-ring" cx={x} cy={cy} r={nr + 6} fill="none" />}
        <ellipse
          cx={x}
          cy={cy}
          rx={nf + 3}
          ry={nr + 2}
          transform={`translate(3 6) rotate(${tween.angle} ${x} ${cy})`}
          fill="#000"
          opacity="0.45"
        />
        <path
          d={nut}
          fill={`url(#${id}-nut-${index})`}
          stroke="#4b463e"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <rect
          x={x - u(REF.cap.slot.w) / 2}
          y={cy + u(REF.cap.slot.dy) - u(REF.cap.slot.h) / 2}
          width={u(REF.cap.slot.w)}
          height={u(REF.cap.slot.h)}
          rx="1.5"
          fill="#2a2723"
        />
        <g className="pedal-cap" data-held={held}>
          <circle cx={x + 1} cy={cy + 3} r={ring + 1} fill="#000" opacity={held ? 0.2 : 0.45} />
          <circle
            cx={x}
            cy={cy}
            r={ring}
            fill={`url(#${id}-cap)`}
            stroke="#5d574d"
            strokeWidth="1.5"
          />
          <circle cx={x} cy={cy} r={dome} fill={`url(#${id}-captop)`} />
          <circle
            cx={x}
            cy={cy}
            r={dome}
            fill="none"
            stroke="#fff"
            strokeOpacity="0.35"
            strokeWidth="1"
          />
        </g>
      </svg>
      {turnable && (
        <span
          aria-hidden
          className="pedal-nut-readout"
          data-peek={peek || undefined}
          style={{ top: pct(readoutY - y0, h) }}
        >
          {degText(nutAngle)}
        </span>
      )}
    </button>
  );
}

/** Equal label columns; the outer leaders angle back to the physical switches. */
function CaptionRow({
  top,
  config,
  selected,
  onSelect,
  children,
}: {
  top: boolean;
  config: Config | null;
  selected: number;
  onSelect: (n: number) => void;
  children?: React.ReactNode;
}) {
  const indices = top ? [0, 1, 2] : [3, 4, 5];
  return (
    <div className="pedal-captions" data-top={top}>
      <svg aria-hidden viewBox="0 0 1000 72" preserveAspectRatio="none" className="pedal-leaders">
        {indices.map((n) => {
          const x = COL[n % 3];
          const label = (((n % 3) + 0.5) / 3) * W;
          const y = (value: number) => (top ? value : 72 - value);
          return (
            <path
              key={n}
              data-selected={selected === n}
              d={`M ${label} ${y(32)} V ${y(40)} L ${x} ${y(56)} V ${y(72)}`}
            />
          );
        })}
      </svg>
      {indices.map((n) => {
        const sw = config?.switches[n];
        const cap = sw ? actionCaption(sw.tap) : "Not assigned";
        const hold = sw ? longCaption(sw.long) : "";
        return (
          <button
            type="button"
            key={n}
            className="pedal-caption"
            data-selected={selected === n}
            aria-label={`Edit switch ${SWITCH_NAMES[n]}: ${cap}${hold ? `, ${hold}` : ""}`}
            onClick={() => onSelect(n)}
            title={`${cap}${hold ? ` · ${hold}` : ""}`}
            style={{ left: `${((n % 3) / 3) * 100}%` }}
          >
            <span className="pedal-caption-main">
              <span className="@max-md:hidden">{cap}</span>
              <span className="hidden @max-md:inline">
                {sw ? actionCaption(sw.tap, true) : "—"}
              </span>
            </span>
            <span className="pedal-caption-hold">
              <span className="@max-md:hidden">{hold}</span>
              <span className="hidden @max-md:inline">{sw ? longCaption(sw.long, true) : ""}</span>
            </span>
          </button>
        );
      })}
      {children}
    </div>
  );
}

/** Extend each leader to the edge of its switch's nut, using the hardware geometry. */
function SwitchLeaders({ selected }: { selected: number }) {
  const end = fy(REF.nut.y - REF.nut.r) - 7;
  return (
    <svg aria-hidden viewBox={`0 0 ${W} ${H}`} className="pedal-leaders pedal-leaders-body">
      {[0, 1, 2, 3, 4, 5].map((n) => {
        const x = COL[n % 3];
        const top = n < 3;
        const target = top ? end : MIRROR - end;
        return (
          <g key={n} data-selected={selected === n}>
            <path d={`M ${x} ${top ? 0 : H} V ${target}`} />
            <circle cx={x} cy={target} r="3" />
          </g>
        );
      })}
    </svg>
  );
}

/** An expression input on the back edge: a plug and its cable when something is in it. */
function Jack({ n, cable }: { n: number; cable: boolean }) {
  return (
    <span className="absolute bottom-0" style={{ left: `${JACK_X[n] * 100}%` }}>
      <svg
        aria-hidden
        width="14"
        height="30"
        viewBox="0 0 14 30"
        className="absolute bottom-[-2px] left-[-7px] overflow-visible"
        style={{ opacity: cable ? 1 : 0, transition: "opacity var(--dur-up) var(--ease-incand)" }}
      >
        <defs>
          <linearGradient id={`cable-fade-${n}`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#2a2d31" />
            <stop offset="1" stopColor="#1a1d20" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M7 18 L7 0"
          stroke={`url(#cable-fade-${n})`}
          strokeWidth="5"
          strokeLinecap="round"
          fill="none"
        />
        <rect x="2" y="14" width="10" height="13" rx="2.5" fill="#1b1e21" stroke="#41484e" />
        <rect x="3.5" y="26" width="7" height="4" rx="1" fill="#9a9384" />
      </svg>
      <span
        className={cx(
          "absolute left-[10px] bottom-[3px] text-[8px] font-semibold whitespace-nowrap tracking-kicker engraved",
          cable ? "text-muted" : "text-faint",
        )}
      >
        EXP {n + 1}
      </span>
    </span>
  );
}

/** The AMP and APP lamps' hit areas: each dot with its legend under it, half the gap to
 *  its neighbour either side. A gold ring round the dot shows hover and selection. */
const IND = {
  half: u(REF.lamp.app - REF.lamp.amp) / 2,
  y0: MIRROR / 2 - u(0.024),
  y1: fy(REF.legend.bottom) + u(0.008),
  ring: u(REF.lamp.dot) * 1.05,
};

function IndicatorButton({
  i,
  selected,
  onSelect,
}: {
  i: 0 | 1;
  selected: boolean;
  onSelect: (i: 0 | 1) => void;
}) {
  const x = fx(i === 0 ? REF.lamp.amp : REF.lamp.app);
  const w = IND.half * 2;
  const h = IND.y1 - IND.y0;
  return (
    <button
      type="button"
      onClick={() => onSelect(i)}
      aria-pressed={selected}
      aria-label={i === 0 ? "AMP lamp" : "APP lamp"}
      className="pedal-indicator absolute cursor-pointer outline-none"
      style={{
        left: pct(x - IND.half, W),
        top: pct(IND.y0, H),
        width: pct(w, W),
        height: pct(h, H),
      }}
    >
      <svg
        aria-hidden
        viewBox={`${x - IND.half} ${IND.y0} ${w} ${h}`}
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      >
        <circle className="pedal-ring" cx={x} cy={MIRROR / 2} r={IND.ring} fill="none" />
      </svg>
    </button>
  );
}

export function Pedal({
  status,
  config,
  selected,
  onSelect,
  selectedIndicator = null,
  onSelectIndicator,
}: {
  status: Status | null;
  config: Config | null;
  selected: number;
  onSelect: (n: number) => void;
  /** Which connection lamp is being edited: 0 = AMP, 1 = APP. */
  selectedIndicator?: 0 | 1 | null;
  /** Makes the AMP and APP lamps clickable; without it they're just lamps. */
  onSelectIndicator?: (i: 0 | 1) => void;
}) {
  const id = `pedal${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const live = status?.state === "connected";
  const lamps = status?.lamps ?? [];
  const held = status?.held ?? 0;
  const nuts = useNuts();
  return (
    <div className="pedal @container flex flex-col items-center px-2 pt-1 pb-1">
      <Defs id={id} />
      <div className="relative w-full">
        <CaptionRow top config={config} selected={selected} onSelect={onSelect}>
          <Jack n={0} cable={!!status?.cables?.[0]} />
          <Jack n={1} cable={!!status?.cables?.[1]} />
        </CaptionRow>
        <div
          className={cx("pedal-body relative w-full", !live && "pedal-off")}
          style={{
            aspectRatio: `${W} / ${H}`,
            borderRadius: `${(CASE_R / W) * 100}% / ${(CASE_R / H) * 100}%`,
            boxShadow: "var(--shadow-contact), var(--shadow-cast)",
          }}
        >
          <Case id={id} />
          <SwitchLeaders selected={selected} />
          <Lamps
            id={id}
            lamps={lamps}
            power={powerLamp({
              connected: live,
              level: status?.battery ?? -1,
              powered: !!status?.powered,
            })}
          />
          {onSelectIndicator &&
            ([0, 1] as const).map((i) => (
              <IndicatorButton
                key={i}
                i={i}
                selected={selectedIndicator === i}
                onSelect={onSelectIndicator}
              />
            ))}
          {[0, 1, 2, 3, 4, 5].map((n) => {
            const sw = config?.switches[n];
            return (
              <FootSwitch
                key={n}
                id={id}
                index={n}
                lamp={lamps[n]}
                held={(held & (1 << n)) !== 0}
                selected={selected === n}
                label={sw ? actionCaption(sw.tap) : ""}
                onSelect={onSelect}
                nutAngle={nuts.angles[n]}
                turnable={nuts.mode === "custom"}
                peek={nuts.peek}
              />
            );
          })}
        </div>
        <CaptionRow top={false} config={config} selected={selected} onSelect={onSelect} />
      </div>
    </div>
  );
}
