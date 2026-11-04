import { memo, useId } from "react";
import { actionCaption, longCaption } from "../lib/caption";
import { isDark, lampLight, rgb } from "../lib/colour";
import type { Colour, Config, Status } from "../types";
import { LAMP_AMP, LAMP_APP, SWITCH_NAMES } from "../types";
import { cx } from "../ui/cx";
import "./Pedal.css";

// THE PEDAL, TOP-DOWN, drawn as the Spark Control X looks: a black brushed-metal face in a
// tolex case with gold trim, three columns of nickel footswitches (I/III, II/IV, A/B), each
// with a curved LED bar showing exactly what status.lamps says the hardware is showing.
//
// Three layers share one viewBox: the case (static, textured, memoised so the LEDs never
// repaint its filters), the status lamps, and one <button> per switch whose own <svg> crops
// the same coordinate space to its group. Captions sit outside the case, above the top row
// and below the bottom row. The jacks are on the back edge, the top of this view.

const W = 1000;
const H = 575;
const FONT = "'Avenir Next', Avenir, Futura, 'Helvetica Neue', system-ui, sans-serif";
const BLACK: Colour = { r: 0, g: 0, b: 0 };

/** Column centres, and the axis the bottom row mirrors the top row about. */
const COL = [115, 507, 893];
const MIRROR = 560;
/** Each switch's group, top row: bracket 62..258, switch, LED bar, label. */
const GROUP = { y0: 52, y1: 274, half: 58 };
/** Margin drawn round each switch's hit area, in viewBox units. */
const PAD = 40;
const SW_Y = 118;
const LED_Y = 197;
const LABEL_Y = 240;

const slot = (n: number) => ({ x: COL[n % 3], top: n < 3, tile: n % 3 === 2 });
const pct = (v: number, of: number) => `${(v / of) * 100}%`;
/** The EXP jacks sit on the back edge, in the gaps between the top row's captions. */
const JACK_X = [0.323, 0.683];

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
        <linearGradient id={`${id}-nut`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f1eadb" />
          <stop offset="0.35" stopColor="#bfb6a3" />
          <stop offset="0.7" stopColor="#8e8676" />
          <stop offset="1" stopColor="#5f594f" />
        </linearGradient>
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
      <rect width={W} height={H} rx="46" fill="#121110" />
      <rect width={W} height={H} rx="46" fill="#000" filter={`url(#${id}-tolex)`} />
      <rect width={W} height={H} rx="46" fill={`url(#${id}-shade)`} />
      <rect
        x="1"
        y="1"
        width={W - 2}
        height={H - 2}
        rx="45"
        fill="none"
        stroke="#fff4e4"
        strokeOpacity="0.07"
        strokeWidth="2"
      />

      {/* gold trim strips, top to bottom along each side */}
      {[47, 945].map((x) => (
        <rect key={x} x={x} y="5" width="8" height={H - 10} rx="3" fill={`url(#${id}-trim)`} />
      ))}

      {/* the brushed face */}
      <rect x="57" y="56" width="886" height="466" rx="5" fill="#0d0d0e" />
      <rect
        x="57"
        y="56"
        width="886"
        height="466"
        rx="5"
        fill="#000"
        filter={`url(#${id}-brush)`}
      />
      <rect x="57" y="56" width="886" height="466" rx="5" fill={`url(#${id}-key)`} />
      <rect
        x="57.5"
        y="56.5"
        width="885"
        height="465"
        rx="5"
        fill="none"
        stroke="#000"
        strokeOpacity="0.8"
      />
      <line x1="60" y1="521" x2="940" y2="521" stroke="#fff4e4" strokeOpacity="0.08" />

      {/* wordmark: set in type, not traced */}
      <g fontFamily={FONT} fill={`url(#${id}-gold)`}>
        <text
          x="312"
          y="292"
          textAnchor="middle"
          fontSize="70"
          fontWeight="800"
          letterSpacing="-1.5"
        >
          Spark
        </text>
        <text x="414" y="322" textAnchor="end" fontSize="19" fontWeight="700" letterSpacing="1.6">
          CONTROL X
        </text>
      </g>

      {/* panel legends */}
      <g
        fontFamily={FONT}
        fontWeight="600"
        fill="#e2cfa5"
        fillOpacity="0.88"
        textAnchor="middle"
        letterSpacing="1"
      >
        <text x="652" y="254" fontSize="16">
          POWER
        </text>
        <text x="757" y="254" fontSize="16">
          CONNECT
        </text>
        <text x="729" y="316" fontSize="15">
          AMP
        </text>
        <text x="786" y="316" fontSize="15">
          APP
        </text>
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
  const bow = top ? 4 : -4;
  return `M${x - 25} ${y - bow / 2} Q${x} ${y + bow * 1.5} ${x + 25} ${y - bow / 2}`;
}

/** The light: a slate bar when dark; when lit, a hot core, the colour, and a pool of
 *  light spilling onto the face. Dimmed LEDs read dimmer, not browner. */
function LedBar({
  d,
  lamp,
  glowId,
  width = 17,
}: {
  d: string;
  lamp: Colour | undefined;
  glowId: string;
  width?: number;
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
        strokeWidth={width * 3.2}
        filter={`url(#${glowId})`}
        style={{ opacity: lit ? 0.55 * a : 0 }}
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
        style={{ opacity: lit ? 0.35 + 0.6 * a : 0 }}
      />
    </g>
  );
}

function Lamps({ id, lamps, live }: { id: string; lamps: Colour[]; live: boolean }) {
  const power: Colour = live ? { r: 40, g: 255, b: 90 } : BLACK;
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
          x="580"
          y="220"
          width="280"
          height="120"
        >
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>
      <LedBar d="M640 280 L664 280" lamp={power} glowId={`${id}-lampglow`} width={19} />
      {(
        [
          [729, LAMP_AMP],
          [786, LAMP_APP],
        ] as const
      ).map(([x, n]) => (
        <LedBar
          key={n}
          d={`M${x} 280 L${x + 0.01} 280`}
          lamp={lamps[n]}
          glowId={`${id}-lampglow`}
          width={13}
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
}: {
  id: string;
  index: number;
  lamp: Colour | undefined;
  held: boolean;
  selected: boolean;
  label: string;
  onSelect: (n: number) => void;
}) {
  const { x, top, tile } = slot(index);
  const y = (v: number) => (top ? v : MIRROR - v);
  const y0 = top ? GROUP.y0 : MIRROR - GROUP.y1;
  const h = GROUP.y1 - GROUP.y0;
  const w = GROUP.half * 2;
  const name = SWITCH_NAMES[index];
  // the bracket: up the sides, round the switch, curling in at the label
  const bracket = `M${x - 17} ${y(258)} Q${x - 42} ${y(258)} ${x - 42} ${y(236)} L${x - 42} ${y(84)} Q${x - 42} ${y(62)} ${x - 20} ${y(62)} L${x + 20} ${y(62)} Q${x + 42} ${y(62)} ${x + 42} ${y(84)} L${x + 42} ${y(236)} Q${x + 42} ${y(258)} ${x + 17} ${y(258)}`;
  // the hex nut, flats left and right
  const cy = y(SW_Y);
  const nut = `M${x} ${cy - 47} L${x + 39} ${cy - 24} L${x + 39} ${cy + 24} L${x} ${cy + 47} L${x - 39} ${cy + 24} L${x - 39} ${cy - 24} Z`;

  return (
    <button
      type="button"
      onClick={() => onSelect(index)}
      aria-pressed={selected}
      aria-label={`Switch ${name}: ${label}`}
      className="pedal-switch absolute overflow-visible outline-none"
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
        </defs>
        {tile ? (
          <rect
            className="pedal-tile"
            x={x - 42}
            y={top ? 62 : MIRROR - 258}
            width="84"
            height="196"
            rx="11"
            fill={`url(#${id}-tile)`}
            stroke="#fff3d6"
            strokeOpacity="0.35"
          />
        ) : (
          <path className="pedal-bracket" d={bracket} fill="none" strokeWidth="2.6" />
        )}

        <LedBar d={ledPath(x, y(LED_Y), top)} lamp={lamp} glowId={`${id}-glow-${index}`} />

        <text
          className={tile ? undefined : "pedal-label"}
          x={x}
          y={y(LABEL_Y)}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily={FONT}
          fontWeight={tile ? 800 : 700}
          fontSize={tile ? 38 : 36}
          letterSpacing={tile ? 0 : -1}
          fill={tile ? "#241b10" : undefined}
          transform={`scale(${tile ? 1 : 1.05} 1)`}
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
        >
          {name}
        </text>

        {/* the footswitch: hex nut, then a round nickel cap that sinks when held */}
        <ellipse cx={x + 3} cy={cy + 8} rx="43" ry="47" fill="#000" opacity="0.45" />
        <path
          d={nut}
          fill={`url(#${id}-nut)`}
          stroke="#4b463e"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <rect x={x - 5} y={cy - 46} width="10" height="7" rx="1.5" fill="#2a2723" />
        <g className="pedal-cap" data-held={held}>
          <circle cx={x + 1} cy={cy + 3} r="31" fill="#000" opacity={held ? 0.2 : 0.45} />
          <circle
            cx={x}
            cy={cy}
            r="30"
            fill={`url(#${id}-cap)`}
            stroke="#5d574d"
            strokeWidth="1.5"
          />
          <circle cx={x} cy={cy} r="23" fill={`url(#${id}-captop)`} />
          <circle
            cx={x}
            cy={cy}
            r="23"
            fill="none"
            stroke="#fff"
            strokeOpacity="0.35"
            strokeWidth="1"
          />
        </g>
      </svg>
    </button>
  );
}

function Caption({
  n,
  config,
  selected,
  top,
}: {
  n: number;
  config: Config | null;
  selected: boolean;
  top: boolean;
}) {
  const sw = config?.switches[n];
  const cap = sw ? actionCaption(sw.tap) : "";
  const capShort = sw ? actionCaption(sw.tap, true) : "";
  const hold = sw ? longCaption(sw.long) : "";
  const holdShort = sw ? longCaption(sw.long, true) : "";
  // centred on the column, held inside the case's width
  const centre = Math.min(Math.max(COL[n % 3] / W, 0.14), 0.86);
  return (
    <span
      className={cx(
        "absolute flex w-[28%] min-w-0 flex-col items-center leading-tight",
        top ? "bottom-0" : "top-0",
      )}
      style={{ left: `${(centre - 0.14) * 100}%` }}
    >
      <span
        className={cx(
          "max-w-full truncate text-ui-xs transition-colors duration-(--dur)",
          selected ? "text-text" : "text-muted",
        )}
      >
        <span className="@max-md:hidden">{cap}</span>
        <span className="hidden @max-md:inline">{capShort}</span>
      </span>
      <span className="h-3 max-w-full truncate text-ui-2xs text-faint">
        <span className="@max-md:hidden">{hold}</span>
        <span className="hidden @max-md:inline">{holdShort}</span>
      </span>
    </span>
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

export function Pedal({
  status,
  config,
  selected,
  onSelect,
}: {
  status: Status | null;
  config: Config | null;
  selected: number;
  onSelect: (n: number) => void;
}) {
  const id = `pedal${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const live = status?.state === "connected";
  const lamps = status?.lamps ?? [];
  const held = status?.held ?? 0;
  return (
    <div className="pedal @container flex flex-col items-center px-2 pt-1 pb-1">
      <Defs id={id} />
      <div className="relative w-full max-w-[500px]">
        <div className="relative h-8">
          {[0, 1, 2].map((n) => (
            <Caption key={n} n={n} config={config} selected={selected === n} top />
          ))}
          <Jack n={0} cable={!!status?.cables?.[0]} />
          <Jack n={1} cable={!!status?.cables?.[1]} />
        </div>
        <div
          className={cx("pedal-body relative w-full", !live && "pedal-off")}
          style={{
            aspectRatio: `${W} / ${H}`,
            borderRadius: `${(46 / W) * 100}% / ${(46 / H) * 100}%`,
            boxShadow: "var(--shadow-contact), var(--shadow-cast)",
          }}
        >
          <Case id={id} />
          <Lamps id={id} lamps={lamps} live={live} />
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
              />
            );
          })}
        </div>
        <div className="relative h-8">
          {[3, 4, 5].map((n) => (
            <Caption key={n} n={n} config={config} selected={selected === n} top={false} />
          ))}
        </div>
      </div>
    </div>
  );
}
