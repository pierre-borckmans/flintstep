// Draws the landing page's pedal (site/index.html) as two static SVG layers and writes
// them between the <!-- pedal:start --> and <!-- pedal:end --> markers.
//
//   node scripts/site/pedal-svg.mjs
//
// The geometry is frontend/src/lib/sparkgeom.ts's REF table, re-done without React:
// the case (textured, never repaints) and the lights (LEDs, nuts, caps, lamps), which the
// page's script switches on and off. No wordmark: the site draws the hardware, not the
// brand. The markup is the page's resting frame: II held, A toggled on.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
  numeral: { y: 0.2059, cap: 0.0307, bar: 0.0085, gap: 0.0052, vTop: 0.0311, vFoot: 0.0104, arm: 0.0089 },
  tile: { half: 0.0404, y0: 0.0074, y1: 0.2163, r: 0.0119 },
  letter: { y: 0.1893, cap: 0.0311, w: { A: 0.0267, B: 0.0222 } },
  legend: { cap: 0.0135, top: 0.2178, bottom: 0.283 },
  power: { x: 0.6652, w: 0.0541 },
  connect: { x: 0.7793, w: 0.0719 },
  amp: { x: 0.747, w: 0.0333 },
  app: { x: 0.8107, w: 0.0304 },
  lamp: { power: 0.6641, len: 0.057, thick: 0.0222, amp: 0.7474, app: 0.8111, dot: 0.019 },
};

const W = 1000;
const U = W / (REF.case.x1 - REF.case.x0);
const H = Math.round((REF.case.y1 - REF.case.y0) * U);
const u = (n) => n * U;
const fx = (n) => (n - REF.case.x0) * U;
const fy = (n) => (n - REF.case.y0) * U;
const r2 = (n) => Math.round(n * 10) / 10;
const CAP = 0.708;
const FONT = "-apple-system, 'Helvetica Neue', Arial, sans-serif";
const MONO = "'SF Mono', ui-monospace, Menlo, monospace";
const COL = REF.col.map(fx);
const MIRROR = 2 * fy(REF.axis);
const NAMES = ["I", "II", "A", "III", "IV", "B"];
/** What the demo maps each switch to: the default CCs, with a toggle, a note and a
 *  program change so every kind shows up. */
const CAPTIONS = ["CC 80", "CC 81", "CC 82<tspan class=\"opt\"> · toggle</tspan>", "Note C3", "CC 84", "Program 4"];
/** The default LED colours (internal/mapping/config.go). */
const COLOURS = ["#ff9600", "#ff5000", "#ff00aa", "#00dcff", "#0078ff", "#9600ff"];
/** Hex nuts are never all square on a real pedal. */
const NUT_DEG = [9, 24, 41, 16, 33, 4];
/** Room above and below the case for the captions. */
const TOP = 96;
const BOTTOM = 96;
const VIEW = `0 ${-TOP} ${W} ${H + TOP + BOTTOM}`;

const slot = (n) => ({ x: COL[n % 3], top: n < 3, tile: n % 3 === 2 });

function nutPath(x, cy, r, deg) {
  const pts = Array.from({ length: 6 }, (_, k) => {
    const a = ((deg - 90 + k * 60) * Math.PI) / 180;
    return `${r2(x + r * Math.cos(a))} ${r2(cy + r * Math.sin(a))}`;
  });
  return `M${pts.join(" L")}Z`;
}

function ledPath(x, y, top) {
  const half = u(REF.led.len - REF.led.thick) / 2;
  const sag = u(REF.led.sag) * (top ? 1 : -1);
  return `M${r2(x - half)} ${r2(y - sag / 2)}Q${r2(x)} ${r2(y + sag * 1.5)} ${r2(x + half)} ${r2(y - sag / 2)}`;
}

function numeralPath(name, x, cy) {
  const n = REF.numeral;
  const h = u(n.cap);
  const glyph = (c) => u(c === "V" ? n.vTop : n.bar);
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
      d += `M${r2(left)} ${r2(top)}H${r2(left + arm)}L${r2(mid)} ${r2(top + h * 0.6)}L${r2(left + gw - arm)} ${r2(top)}H${r2(left + gw)}L${r2(mid + foot)} ${r2(bottom)}H${r2(mid - foot)}Z`;
    } else {
      d += `M${r2(left)} ${r2(top)}h${r2(gw)}V${r2(bottom)}h${r2(-gw)}Z`;
    }
    left += gw + u(n.gap);
  }
  return d;
}

function bracketPath(x, top) {
  const y = (v) => (top ? v : MIRROR - v);
  const b = REF.bracket;
  const bx = u(b.half);
  const [rt, rb] = [u(b.rTop), u(b.rBot)];
  const [bt, bb] = [y(fy(b.y0)), y(fy(b.y1))];
  const sy = top ? 1 : -1;
  const arc = (r) => `A${r2(r)} ${r2(r)} 0 0 ${top ? 1 : 0}`;
  return [
    `M${r2(x - bx + rb)} ${r2(bb)}`,
    `${arc(rb)} ${r2(x - bx)} ${r2(bb - sy * rb)}`,
    `V${r2(bt + sy * rt)}`,
    `${arc(rt)} ${r2(x - bx + rt)} ${r2(bt)}`,
    `H${r2(x + bx - rt)}`,
    `${arc(rt)} ${r2(x + bx)} ${r2(bt + sy * rt)}`,
    `V${r2(bb - sy * rb)}`,
    `${arc(rb)} ${r2(x + bx - rb)} ${r2(bb)}`,
  ].join("");
}

/** The case layer: tolex, trim, brushed face, legends, brackets, numerals, tiles. */
function caseSvg() {
  const R = r2(u(REF.case.r));
  const F = { x: r2(fx(0)), y: r2(fy(0)), w: r2(u(1)), h: r2(u(REF.face.h)) };
  const out = [];
  out.push(`<svg class="pedal-case" viewBox="${VIEW}" aria-hidden="true" focusable="false">`);
  out.push(`<defs>
<filter id="pc-tolex" x="0" y="0" width="1" height="1"><feTurbulence type="turbulence" baseFrequency="0.11" numOctaves="2" seed="4"/><feDiffuseLighting surfaceScale="1.4" lighting-color="#1f1f1f"><feDistantLight azimuth="235" elevation="58"/></feDiffuseLighting><feComposite in2="SourceGraphic" operator="in"/></filter>
<filter id="pc-brush" x="0" y="0" width="1" height="1"><feTurbulence type="fractalNoise" baseFrequency="0.0025 0.75" numOctaves="2" seed="9"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.16 0 0 0 -0.03"/><feComposite in2="SourceGraphic" operator="in"/></filter>
<radialGradient id="pc-key" cx="0.2" cy="0" r="1"><stop offset="0" stop-color="#fff4e4" stop-opacity="0.07"/><stop offset="0.7" stop-color="#fff4e4" stop-opacity="0"/></radialGradient>
<linearGradient id="pc-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.05"/><stop offset="0.5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.35"/></linearGradient>
<linearGradient id="pc-trim" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7a6136"/><stop offset="0.45" stop-color="#e9cf96"/><stop offset="1" stop-color="#8d7142"/></linearGradient>
<linearGradient id="pc-tile" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#ead7a8"/><stop offset="0.55" stop-color="#d2b882"/><stop offset="1" stop-color="#b49967"/></linearGradient>
</defs>`);
  // the cast shadow under the case
  out.push(`<filter id="pc-drop" x="-0.1" y="-0.1" width="1.2" height="1.3"><feGaussianBlur stdDeviation="16"/></filter>`);
  out.push(`<rect x="20" y="34" width="${W - 40}" height="${H - 20}" rx="${R}" fill="#000" filter="url(#pc-drop)" class="pedal-drop"/>`);
  out.push(`<rect width="${W}" height="${H}" rx="${R}" fill="#121110"/>`);
  out.push(`<rect width="${W}" height="${H}" rx="${R}" fill="#000" filter="url(#pc-tolex)"/>`);
  out.push(`<rect width="${W}" height="${H}" rx="${R}" fill="url(#pc-shade)"/>`);
  out.push(`<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="${R - 1}" fill="none" stroke="#fff4e4" stroke-opacity="0.07" stroke-width="2"/>`);
  for (const x of REF.strip.x) {
    const w = u(REF.strip.w);
    out.push(`<rect x="${r2(fx(x) - w / 2)}" y="${r2(fy(REF.strip.y0))}" width="${r2(w)}" height="${r2(u(REF.strip.y1 - REF.strip.y0))}" rx="${r2(w / 2.5)}" fill="url(#pc-trim)"/>`);
  }
  out.push(`<rect x="${F.x}" y="${F.y}" width="${F.w}" height="${F.h}" rx="3" fill="#0d0d0e"/>`);
  out.push(`<rect x="${F.x}" y="${F.y}" width="${F.w}" height="${F.h}" rx="3" fill="#000" filter="url(#pc-brush)"/>`);
  out.push(`<rect x="${F.x}" y="${F.y}" width="${F.w}" height="${F.h}" rx="3" fill="url(#pc-key)"/>`);
  out.push(`<rect x="${F.x + 0.5}" y="${F.y + 0.5}" width="${F.w - 1}" height="${F.h - 1}" rx="3" fill="none" stroke="#000" stroke-opacity="0.8" stroke-width="2"/>`);
  // panel legends
  out.push(`<g font-family="${FONT}" font-weight="700" font-size="${r2(u(REF.legend.cap) / CAP)}" fill="#e2cfa5" fill-opacity="0.88" text-anchor="middle">`);
  for (const [t, at, base] of [
    ["POWER", REF.power, REF.legend.top],
    ["CONNECT", REF.connect, REF.legend.top],
    ["AMP", REF.amp, REF.legend.bottom],
    ["APP", REF.app, REF.legend.bottom],
  ]) {
    out.push(`<text x="${r2(fx(at.x))}" y="${r2(fy(base))}" textLength="${r2(u(at.w))}" lengthAdjust="spacingAndGlyphs">${t}</text>`);
  }
  out.push(`</g>`);
  // jacks on the back edge
  for (const f of [0.323, 0.683]) out.push(`<rect x="${r2(f * W - 13)}" y="-2" width="26" height="9" rx="4" fill="#050505"/>`);
  // brackets, tiles, numerals, letters, unlit LED slots
  for (let n = 0; n < 6; n++) {
    const { x, top, tile } = slot(n);
    const y = (v) => (top ? v : MIRROR - v);
    if (tile) {
      const ty = [y(fy(REF.tile.y0)), y(fy(REF.tile.y1))];
      const lc = u(REF.letter.cap);
      out.push(`<rect x="${r2(x - u(REF.tile.half))}" y="${r2(Math.min(...ty))}" width="${r2(u(REF.tile.half) * 2)}" height="${r2(Math.abs(ty[1] - ty[0]))}" rx="${r2(u(REF.tile.r))}" fill="url(#pc-tile)" stroke="#fff3d6" stroke-opacity="0.35"/>`);
      out.push(`<text x="${r2(x)}" y="${r2(y(fy(REF.letter.y)) + lc / 2)}" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="${r2(lc / CAP)}" textLength="${r2(u(REF.letter.w[NAMES[n]]))}" lengthAdjust="spacingAndGlyphs" fill="#241b10">${NAMES[n]}</text>`);
    } else {
      out.push(`<path d="${bracketPath(x, top)}" fill="none" stroke="#c8a96b" stroke-opacity="0.62" stroke-width="${r2(u(REF.bracket.stroke))}" stroke-linecap="round"/>`);
      out.push(`<path d="${numeralPath(NAMES[n], x, y(fy(REF.numeral.y)))}" fill="#e2cfa5" fill-opacity="0.82"/>`);
    }
    const d = ledPath(x, y(fy(REF.led.y)), top);
    const w = u(REF.led.thick);
    out.push(`<path d="${d}" stroke="#0a0b0c" stroke-width="${r2(w + 4)}" stroke-linecap="round" fill="none"/>`);
    out.push(`<path d="${d}" stroke="#323a42" stroke-width="${r2(w)}" stroke-linecap="round" fill="none"/>`);
  }
  // unlit lamp windows
  const ly = r2(MIRROR / 2);
  const ph = u(REF.lamp.len - REF.lamp.thick) / 2;
  out.push(`<path d="M${r2(fx(REF.lamp.power) - ph)} ${ly}h${r2(2 * ph)}" stroke="#0a0b0c" stroke-width="${r2(u(REF.lamp.thick) + 4)}" stroke-linecap="round"/>`);
  for (const x of [REF.lamp.amp, REF.lamp.app]) {
    out.push(`<circle cx="${r2(fx(x))}" cy="${ly}" r="${r2(u(REF.lamp.dot) / 2 + 2)}" fill="#0a0b0c"/><circle cx="${r2(fx(x))}" cy="${ly}" r="${r2(u(REF.lamp.dot) / 2)}" fill="#323a42"/>`);
  }
  // captions above and below, with a short leader to each switch
  out.push(`<g class="pedal-captions" font-family="${MONO}" font-size="25" text-anchor="middle">`);
  for (let n = 0; n < 6; n++) {
    const { x, top } = slot(n);
    const ty = top ? -54 : H + 76;
    const l0 = top ? -36 : H + 18;
    const l1 = top ? -8 : H + 46;
    out.push(`<g class="cap-label${n === 1 ? " on" : ""}" data-sw="${n}"><text x="${r2(x)}" y="${ty}">${CAPTIONS[n]}</text><path d="M${r2(x)} ${l0}V${l1}" stroke-width="1.5"/></g>`);
  }
  out.push(`</g>`);
  out.push(`</svg>`);
  return out.join("\n");
}

/** One LED's light: glow, colour, white-hot core. Off until the page lights it. */
function litPath(d, colour, width, glowId, core = true) {
  const parts = [
    `<path d="${d}" stroke="${colour}" stroke-width="${r2(width * 3.2)}" filter="url(#${glowId})" opacity="0.55"/>`,
    `<path d="${d}" stroke="${colour}" stroke-width="${r2(width)}"/>`,
  ];
  if (core) parts.push(`<path d="${d}" stroke="#fff" stroke-opacity="0.72" stroke-width="${r2(width * 0.42)}"/>`);
  return parts.join("");
}

/** The lights layer: LEDs, lamps, and the footswitches that sink when pressed. */
function lightsSvg() {
  const out = [];
  out.push(`<svg class="pedal-lights" viewBox="${VIEW}" aria-hidden="true" focusable="false">`);
  out.push(`<defs>
<radialGradient id="pl-cap" cx="0.38" cy="0.32" r="0.75"><stop offset="0" stop-color="#fbf6ea"/><stop offset="0.45" stop-color="#d9d0bd"/><stop offset="0.85" stop-color="#9d9483"/><stop offset="1" stop-color="#6f685c"/></radialGradient>
<radialGradient id="pl-captop" cx="0.42" cy="0.36" r="0.7"><stop offset="0" stop-color="#fffaf0"/><stop offset="0.6" stop-color="#e3dac6"/><stop offset="1" stop-color="#b8ae99"/></radialGradient>
<filter id="pl-lampglow" filterUnits="userSpaceOnUse" x="${r2(fx(REF.lamp.power) - 80)}" y="${r2(MIRROR / 2 - 60)}" width="${r2(fx(REF.lamp.app) - fx(REF.lamp.power) + 160)}" height="120"><feGaussianBlur stdDeviation="7"/></filter>`);
  for (let n = 0; n < 6; n++) {
    const { x, top } = slot(n);
    const ly = top ? fy(REF.led.y) : MIRROR - fy(REF.led.y);
    out.push(`<filter id="pl-glow-${n}" filterUnits="userSpaceOnUse" x="${r2(x - 110)}" y="${r2(ly - 70)}" width="220" height="140"><feGaussianBlur stdDeviation="9"/></filter>`);
  }
  out.push(`</defs>`);

  // lamps: POWER green (battery above the yellow band), AMP = MIDI out, APP = connected
  const ly = r2(MIRROR / 2);
  const ph = u(REF.lamp.len - REF.lamp.thick) / 2;
  out.push(`<g fill="none" stroke-linecap="round">`);
  out.push(`<g class="lamp lamp-power">${litPath(`M${r2(fx(REF.lamp.power) - ph)} ${ly}h${r2(2 * ph)}`, "#28ff5a", u(REF.lamp.thick), "pl-lampglow", false)}</g>`);
  out.push(`<g class="lamp lamp-amp">${litPath(`M${r2(fx(REF.lamp.amp))} ${ly}h0.01`, "#00ff73", u(REF.lamp.dot), "pl-lampglow", false)}</g>`);
  out.push(`<g class="lamp lamp-app">${litPath(`M${r2(fx(REF.lamp.app))} ${ly}h0.01`, "#5a2dff", u(REF.lamp.dot), "pl-lampglow", false)}</g>`);
  for (let n = 0; n < 6; n++) {
    const { x, top } = slot(n);
    const y = top ? fy(REF.led.y) : MIRROR - fy(REF.led.y);
    out.push(`<g class="led${n === 1 || n === 2 ? " on" : ""}" data-sw="${n}">${litPath(ledPath(x, y, top), COLOURS[n], u(REF.led.thick), `pl-glow-${n}`)}</g>`);
  }
  out.push(`</g>`);

  // footswitches
  const NUT = [
    [0, "#f1eadb"],
    [0.35, "#bfb6a3"],
    [0.7, "#8e8676"],
    [1, "#5f594f"],
  ];
  for (let n = 0; n < 6; n++) {
    const { x, top } = slot(n);
    const cy = top ? fy(REF.nut.y) : MIRROR - fy(REF.nut.y);
    const nr = u(REF.nut.r);
    const nf = nr * (Math.sqrt(3) / 2);
    const [ring, dome] = [u(REF.cap.ring), u(REF.cap.dome)];
    const deg = NUT_DEG[n];
    out.push(`<linearGradient id="pl-nut-${n}" gradientUnits="userSpaceOnUse" x1="${r2(x - nf)}" y1="${r2(cy - nr)}" x2="${r2(x + nf)}" y2="${r2(cy + nr)}">${NUT.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join("")}</linearGradient>`);
    out.push(`<ellipse cx="${r2(x)}" cy="${r2(cy)}" rx="${r2(nf + 3)}" ry="${r2(nr + 2)}" transform="translate(3 6) rotate(${deg} ${r2(x)} ${r2(cy)})" fill="#000" opacity="0.45"/>`);
    out.push(`<path d="${nutPath(x, cy, nr, deg)}" fill="url(#pl-nut-${n})" stroke="#4b463e" stroke-width="2" stroke-linejoin="round"/>`);
    out.push(`<rect x="${r2(x - u(REF.cap.slot.w) / 2)}" y="${r2(cy + u(REF.cap.slot.dy) - u(REF.cap.slot.h) / 2)}" width="${r2(u(REF.cap.slot.w))}" height="${r2(u(REF.cap.slot.h))}" rx="1.5" fill="#2a2723"/>`);
    out.push(`<g class="fs${n === 1 ? " held" : ""}" data-sw="${n}"><circle cx="${r2(x + 1)}" cy="${r2(cy + 3)}" r="${r2(ring + 1)}" fill="#000" opacity="0.45"/><circle cx="${r2(x)}" cy="${r2(cy)}" r="${r2(ring)}" fill="url(#pl-cap)" stroke="#5d574d" stroke-width="1.5"/><circle cx="${r2(x)}" cy="${r2(cy)}" r="${r2(dome)}" fill="url(#pl-captop)"/><circle cx="${r2(x)}" cy="${r2(cy)}" r="${r2(dome)}" fill="none" stroke="#fff" stroke-opacity="0.35"/></g>`);
  }
  out.push(`</svg>`);
  return out.join("\n");
}

const svg = `${caseSvg()}\n${lightsSvg()}`;

const target = process.argv[2] ?? fileURLToPath(new URL("../../site/index.html", import.meta.url));
const html = readFileSync(target, "utf8");
const re = /(<!-- pedal:start -->)[\s\S]*?(<!-- pedal:end -->)/;
if (!re.test(html)) throw new Error(`no pedal markers in ${target}`);
writeFileSync(target, html.replace(re, `$1\n${svg}\n$2`));
console.log(`pedal drawn into ${target} (${svg.length} bytes)`);
