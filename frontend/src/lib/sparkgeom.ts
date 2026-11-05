// THE SPARK CONTROL X, AS GEOMETRY. Pure: where every part of the drawn pedal sits, in the
// case's own viewBox units (the case is W = 1000 wide). The canvas draws from this, and
// the pointer tests against it, so a switch cannot be somewhere other than where it can
// be clicked.
//
// REFERENCE GEOMETRY, measured off the straight top-down product shot (1080x461, face
// 675px wide at x 207..882, y 55.5..388). Every number is normalised to the face width
// (face = 1 wide), origin at the face's top-left corner; y grows downwards. Positions are
// for the top row; the bottom row mirrors them about `axis`, the face's horizontal centre
// line (the photo agrees to within a pixel on brackets, LEDs and numerals; the nuts sit
// ~2px further out from it, which is camera parallax on their height, so they're averaged).
// The constants below are all derived from this table: check edits against it.
// (scripts/site/pedal-svg.mjs re-does it for the site.)
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
//   wordmark   none: the maker's wordmark is left off, so that corner of the face is
//              bare brushed metal (the site's drawing does the same)
//   legends    cap height 0.0135. POWER centre x 0.6652, 0.0541 wide; CONNECT 0.7793,
//              0.0719 wide; both baseline 0.2178. AMP 0.7470 (0.0333 wide), APP 0.8107
//              (0.0304 wide), baseline 0.2830
//   lamps      on the axis: POWER bar centre x 0.6641, 0.0570 long, 0.0222 thick;
//              AMP dot 0.7474, APP dot 0.8111, 0.016 across (lens and halo)

export const REF = {
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
  legend: { cap: 0.0135, top: 0.2178, bottom: 0.283 },
  power: { x: 0.6652, w: 0.0541 },
  connect: { x: 0.7793, w: 0.0719 },
  amp: { x: 0.747, w: 0.0333 },
  app: { x: 0.8107, w: 0.0304 },
  lamp: { power: 0.6641, len: 0.057, thick: 0.0222, amp: 0.7474, app: 0.8111, dot: 0.019 },
};

/** The case is 1000 wide; one face width is U viewBox units. */
export const W = 1000;
export const U = W / (REF.case.x1 - REF.case.x0);
export const H = Math.round((REF.case.y1 - REF.case.y0) * U);
/** Face-normalised -> viewBox: a length, an x, a y. */
export const u = (n: number) => n * U;
export const fx = (n: number) => (n - REF.case.x0) * U;
export const fy = (n: number) => (n - REF.case.y0) * U;
export const CASE_R = u(REF.case.r);
export const FACE = { x: fx(0), y: fy(0), w: u(1), h: u(REF.face.h) };

/** Column centres, and the axis the bottom row mirrors the top row about (MIRROR - y). */
export const COL = REF.col.map(fx);
export const MIRROR = 2 * fy(REF.axis);
/** Each switch's group, top row: from the nut's top point to the numeral's foot, as wide
 *  as the nut. It is the hit area. */
export const GROUP = {
  y0: fy(REF.nut.y - REF.nut.r) - 4,
  y1: fy(REF.numeral.y + REF.numeral.cap / 2) + 4,
  half: u(REF.nut.r) + 2,
};
export const SW_Y = fy(REF.nut.y);
export const LED_Y = fy(REF.led.y);
/** The EXP jacks sit on the back edge, in the gaps between the top row's captions. */
export const JACK_X = [0.323, 0.683];

export const slot = (n: number) => ({ x: COL[n % 3], top: n < 3, tile: n % 3 === 2 });
/** A top-row y, mirrored for the bottom row. */
export const rowY = (top: boolean, v: number) => (top ? v : MIRROR - v);

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A switch's hit area. */
export function switchBox(n: number): Box {
  const { x, top } = slot(n);
  const h = GROUP.y1 - GROUP.y0;
  return { x: x - GROUP.half, y: top ? GROUP.y0 : MIRROR - GROUP.y1, w: GROUP.half * 2, h };
}

/** The nut: centre and vertex radius. */
export function nutAt(n: number) {
  const { x, top } = slot(n);
  return { x, y: rowY(top, SW_Y), r: u(REF.nut.r) };
}

/** The selection plate round a switch: from above the nut to below the numeral. */
export function plateBox(n: number): Box {
  const { x, top } = slot(n);
  const nr = u(REF.nut.r);
  const half = nr * (Math.sqrt(3) / 2) + 9;
  const a = rowY(top, SW_Y - nr - 8);
  const b = rowY(top, fy(REF.numeral.y + REF.numeral.cap / 2) + 8);
  return { x: x - half, y: Math.min(a, b), w: half * 2, h: Math.abs(b - a) };
}

/** Where a nut's angle readout sits: in the gap between the nut's tip and the LED. */
export function readoutY(n: number): number {
  return rowY(slot(n).top, fy((REF.nut.y + REF.nut.r + REF.led.y - REF.led.thick / 2) / 2));
}

/** The AMP and APP lamps' hit areas: each dot with its legend under it, half the gap to
 *  its neighbour either side. */
export const IND = {
  half: u(REF.lamp.app - REF.lamp.amp) / 2,
  y0: MIRROR / 2 - u(0.024),
  y1: fy(REF.legend.bottom) + u(0.008),
  ring: u(REF.lamp.dot) * 1.05,
};

export const lampX = (i: 0 | 1) => fx(i === 0 ? REF.lamp.amp : REF.lamp.app);

export function indicatorBox(i: 0 | 1): Box {
  return { x: lampX(i) - IND.half, y: IND.y0, w: IND.half * 2, h: IND.y1 - IND.y0 };
}

/** The POWER lamp's area, for its tooltip: the bar and its legend. */
export function powerBox(): Box {
  const half = u(REF.power.w) / 2 + 6;
  return {
    x: fx(REF.power.x) - half,
    y: fy(REF.legend.top) - u(REF.legend.cap) - 4,
    w: half * 2,
    h: MIRROR / 2 + u(REF.lamp.thick) - fy(REF.legend.top) + u(REF.legend.cap) + 6,
  };
}

/** A curved LED bar: a smile on the top row, a frown on the bottom row. */
export function ledPath(n: number): string {
  const { x, top } = slot(n);
  const y = rowY(top, LED_Y);
  // the stroke's round caps add half its width at each end; the quadratic's control point
  // sits twice the sag off the chord, so its middle sags by exactly the measured amount
  const half = u(REF.led.len - REF.led.thick) / 2;
  const sag = u(REF.led.sag) * (top ? 1 : -1);
  return `M${x - half} ${y - sag / 2} Q${x} ${y + sag * 1.5} ${x + half} ${y - sag / 2}`;
}

/** The numerals as drawn shapes, not type: upright bars and a flat-footed V, so their
 *  width (and so their centring in the bracket's gap) never depends on a font. */
export function numeralPath(name: string, x: number, cy: number): string {
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

/** The bracket round a numbered switch: up the sides and round the top; at the bottom each
 *  corner arc stops as it turns horizontal, and the numeral sits centred in the gap. */
export function bracketPath(n: number): string {
  const { x, top } = slot(n);
  const b = REF.bracket;
  const bx = u(b.half);
  const [rt, rb] = [u(b.rTop), u(b.rBot)];
  const [bt, bb] = [rowY(top, fy(b.y0)), rowY(top, fy(b.y1))];
  const sy = top ? 1 : -1;
  // clockwise on screen for the top row; the bottom row's mirror image runs the other way
  const arc = (r: number) => `A${r} ${r} 0 0 ${top ? 1 : 0}`;
  return [
    `M${x - bx + rb} ${bb}`,
    `${arc(rb)} ${x - bx} ${bb - sy * rb}`,
    `V${bt + sy * rt}`,
    `${arc(rt)} ${x - bx + rt} ${bt}`,
    `H${x + bx - rt}`,
    `${arc(rt)} ${x + bx} ${bt + sy * rt}`,
    `V${bb - sy * rb}`,
    `${arc(rb)} ${x + bx - rb} ${bb}`,
  ].join(" ");
}

/** A switch's numeral (or tile letter) centre. */
export function numeralY(n: number): number {
  return rowY(slot(n).top, fy(REF.numeral.y));
}

/** The A/B tile. */
export function tileBox(n: number): Box {
  const { x, top } = slot(n);
  const a = rowY(top, fy(REF.tile.y0));
  const b = rowY(top, fy(REF.tile.y1));
  return {
    x: x - u(REF.tile.half),
    y: Math.min(a, b),
    w: u(REF.tile.half) * 2,
    h: Math.abs(b - a),
  };
}

/** The leader inside the case: from the case edge to just short of the nut's tip. */
export function bodyLeader(n: number): { x: number; y0: number; y1: number } {
  const { x, top } = slot(n);
  const end = fy(REF.nut.y - REF.nut.r) - 7;
  return { x, y0: top ? 0 : H, y1: top ? end : MIRROR - end };
}

/** The POWER bar and the AMP/APP dots, as stroke paths on the axis. */
export function powerPath(): string {
  const half = u(REF.lamp.len - REF.lamp.thick) / 2;
  return `M${fx(REF.lamp.power) - half} ${MIRROR / 2} h${2 * half}`;
}

/** Point in a box. */
export const inBox = (b: Box, x: number, y: number) =>
  x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
