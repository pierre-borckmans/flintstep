import { useTick } from "@pixi/react";
import {
  ColorMatrixFilter,
  type Container,
  type Graphics,
  GraphicsPath,
  type Sprite,
  TextStyle,
} from "pixi.js";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { actionCaption, longCaption } from "../lib/caption";
import { isDark, lampLight } from "../lib/colour";
import { SPARK } from "../lib/exppedal";
import { SWEEP_MS, sweepLamps } from "../lib/linkview";
import { degText, easeOutCubic, nearest } from "../lib/nuts";
import { POWER_RGB, powerLamp } from "../lib/power";
import {
  bodyLeader,
  bracketPath,
  COL,
  fx,
  H,
  IND,
  indicatorBox,
  JACK_X,
  LED_Y,
  lampX,
  ledPath,
  MIRROR,
  numeralPath,
  numeralY,
  nutAt,
  plateBox,
  powerPath,
  REF,
  readoutY,
  rowY,
  slot,
  tileBox,
  u,
  W,
} from "../lib/sparkgeom";
import type { Colour } from "../types";
import { LAMP_AMP, LAMP_APP, SWITCH_NAMES } from "../types";
import { DUR, EASE, EASE_INCAND, useFade, useTween } from "./anim";
import {
  CAP_BOX,
  CapSvg,
  CaseCrispSvg,
  CaseMaterialSvg,
  GLOW_BOX,
  type GlowShape,
  GlowSvg,
  NUT_BOX,
  NutSvg,
  SHADOW_PAD,
  ShadowSvg,
} from "./art/sparkArt";
import { useBaked, useHover, useScene } from "./context";
import { CAPTION_H, CAPTION_ROW } from "./hit";
import type { Palette } from "./palette";
import { Rings } from "./Rings";
import type { SceneData } from "./store";
import { fitText } from "./text";

// THE SPARK CONTROL X ON THE CANVAS: one baked texture for everything that never changes
// (the case, see sparkArt), and on top of it, as their own display objects, everything
// that does — each LED (a stroke and a tinted glow sprite), the caps (sink when held),
// the hex nuts (a rotated sprite), the POWER/AMP/APP lamps, the selection plates, the
// leaders and the captions round the case.
//
// Laid out in the Spark block's own px (origin at its top-left, as lib/exppedal places
// it); the case inside is drawn in its viewBox units (sparkgeom), scaled by k = w / 1000.

/** Which nuts were just turned by hand, so they land at once instead of easing there. */
export const nutByHand = new Set<number>();

const BLACK: Colour = { r: 0, g: 0, b: 0 };
const GOLD = 0xc8a96b;
const CREAM = 0xe2cfa5;
const rgbNum = (c: Colour) =>
  (Math.round(Math.max(0, Math.min(255, c.r))) << 16) |
  (Math.round(Math.max(0, Math.min(255, c.g))) << 8) |
  Math.round(Math.max(0, Math.min(255, c.b)));

/**
 * A stroke that stays one CSS pixel wide however far the camera zooms — SVG's
 * vector-effect: non-scaling-stroke. `draw` gets `px`, one CSS px in the Graphics' own
 * units, and runs again when the zoom moves enough to see (ZoomWatch) or `key` changes.
 * `unit` is world px per local unit (k inside the case).
 */
function useHairline(draw: (g: Graphics, px: number) => void, key: string, unit = 1) {
  const { zoom, repaint } = useScene();
  const ref = useRef<Graphics>(null);
  const live = useRef(draw);
  live.current = draw;
  const paint = useCallback(
    (px: number) => {
      const g = ref.current;
      if (!g) return;
      g.clear();
      live.current(g, px / unit);
      repaint.mark();
    },
    [unit, repaint],
  );
  useEffect(() => zoom.onHairline(paint), [zoom, paint]);
  useEffect(() => paint(zoom.px), [paint, key]);
  return ref;
}

/** The whole Spark block: captions, case, and everything on the case. */
export function SparkContent({ data }: { data: SceneData }) {
  const w = data.layout.spark.w;
  const k = w / W;
  const live = data.status?.state === "connected";
  return (
    <pixiContainer>
      <Rings data={data} rect={{ x: SPARK.padX, y: SPARK.caseTop, w, h: H * k }} />
      <CaseShadow w={w} palette={data.palette} />
      <Body live={live} k={k}>
        <CaseSprite w={w} k={k} />
        <BodyLeaders selected={data.selected} palette={data.palette} k={k} />
        <Lamps data={data} k={k} />
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <Switch key={n} n={n} data={data} k={k} />
        ))}
      </Body>
      <Captions data={data} />
      <Jacks data={data} />
    </pixiContainer>
  );
}

/** The case and everything on it, at (padX, caseTop), scaled by k. Powered down it
 *  dims and greys (style.css --off-dim): quick to go, slow to come back. */
function Body({ live, k, children }: { live: boolean; k: number; children: React.ReactNode }) {
  const ref = useRef<Container>(null);
  const filter = useMemo(() => new ColorMatrixFilter(), []);
  // Powering up waits a beat and takes its time (the rings fall in first).
  const up = useCallback(
    (t: number) => (t < 120 / 820 ? 0 : EASE_INCAND((t * 820 - 120) / 700)),
    [],
  );
  useTween(
    live ? 0 : 1,
    live ? 820 : DUR.up,
    (off) => {
      const c = ref.current;
      if (!c) return false;
      if (off <= 0.001) {
        c.filters = null;
        return;
      }
      // CSS saturate(s) brightness(b), s 1 → 0.25 and b 1 → 0.6.
      const s = 1 - 0.75 * off;
      const b = 1 - 0.4 * off;
      // biome-ignore format: a matrix
      filter.matrix = [
      (0.213 + 0.787 * s) * b, (0.715 - 0.715 * s) * b, (0.072 - 0.072 * s) * b, 0, 0,
      (0.213 - 0.213 * s) * b, (0.715 + 0.285 * s) * b, (0.072 - 0.072 * s) * b, 0, 0,
      (0.213 - 0.213 * s) * b, (0.715 - 0.715 * s) * b, (0.072 + 0.928 * s) * b, 0, 0,
      0, 0, 0, 1, 0,
    ];
      if (c.filters?.[0] !== filter) c.filters = [filter];
    },
    live ? up : EASE_INCAND,
  );
  return (
    <pixiContainer ref={ref} x={SPARK.padX} y={SPARK.caseTop} scale={k}>
      {children}
    </pixiContainer>
  );
}

/** The case, in two bakes: its noise-filtered materials once per size, and its crisp
 *  trim, type and tiles again whenever the zoom outgrows them. */
function CaseSprite({ w, k }: { w: number; k: number }) {
  const material = useBaked("spark/case", w, (px) => <CaseMaterialSvg px={px} />, {
    unit: k,
    zoom: false,
  });
  const crisp = useBaked("spark/crisp", w, (px) => <CaseCrispSvg px={px} />, { unit: k });
  // Both halves or neither: they bake separately, and a case drawn with its materials but
  // not yet its trim and legends (or the other way round) is a frame of a different pedal.
  // A later re-bake only ever swaps the crisp half's texture for a sharper one of the same
  // drawing, in place, so the two cannot disagree after this.
  if (!material.texture || !crisp.texture) return null;
  return (
    <>
      <pixiSprite ref={material.ref} texture={material.texture} scale={material.scale} />
      <pixiSprite ref={crisp.ref} texture={crisp.texture} scale={crisp.scale} />
    </>
  );
}

/** The case's shadow on the stage: two soft layers, baked white and tinted per theme. */
function CaseShadow({ w, palette }: { w: number; palette: Palette }) {
  const bw = Math.round(w / 8) * 8;
  const { contact, cast, color } = palette.shadow;
  const art = useBaked(
    `spark/shadow/${bw}/${contact}/${cast}`,
    bw + SHADOW_PAD * 2,
    (px) => <ShadowSvg w={bw} px={px} contact={contact} cast={cast} />,
    { zoom: false },
  );
  if (!art.texture) return null;
  const s = (w + SHADOW_PAD * 2) / (bw + SHADOW_PAD * 2);
  return (
    <pixiSprite
      ref={art.ref}
      texture={art.texture}
      tint={color}
      x={SPARK.padX - SHADOW_PAD * s}
      y={SPARK.caseTop - SHADOW_PAD * s}
      scale={art.scale * s}
    />
  );
}

/** The leaders inside the case: from its edge to just short of each nut. */
function BodyLeaders({ selected, palette, k }: { selected: number; palette: Palette; k: number }) {
  const ref = useHairline(
    (g, px) => {
      for (let n = 0; n < 6; n++) {
        const l = bodyLeader(n);
        const on = selected === n;
        const color = on ? palette.cold : palette.leader;
        const alpha = on ? 1 : 0.6;
        g.moveTo(l.x, l.y0).lineTo(l.x, l.y1).stroke({ color, alpha, width: px });
        g.circle(l.x, l.y1, 3).fill({ color, alpha: on ? 1 : 0.6 });
      }
    },
    `${selected}/${palette.cold}/${palette.leader}`,
    k,
  );
  return <pixiGraphics ref={ref} draw={noop} />;
}

const noop = () => {};

/** How a lamp is drawn: its stroke, its width, how far its light spills (1 = the switch
 *  LEDs; below 1 the lamp is also flat, with no white-hot core), and its glow's shape. */
interface LedSpec {
  d: string;
  width: number;
  glow: number;
  shape: GlowShape;
  at: { x: number; y: number };
  /** Its index in status.lamps, for the power-up sweep (POWER has none). */
  lamp?: number;
}

/** A lamp: a slate bar when dark; when lit, the colour, a hot core, and a pool of light
 *  spilling onto the face. Dimmed LEDs read dimmer, not browner. The stroke is redrawn
 *  only when the colour changes; the glow is one baked white texture, tinted. */
function Led({ spec, lamp, k }: { spec: LedSpec; lamp: Colour | undefined; k: number }) {
  const g = useRef<Graphics>(null);
  const glow = useRef<Sprite | null>(null);
  const box = GLOW_BOX[spec.shape];
  const art = useBaked(
    `spark/glow/${spec.shape}`,
    box.w * k,
    (px) => <GlowSvg shape={spec.shape} px={px} />,
    { zoom: false, unit: k },
  );
  const path = useMemo(() => new GraphicsPath(spec.d), [spec.d]);
  const { repaint } = useScene();
  const paint = useCallback(
    (c0: Colour | undefined) => {
      const gr = g.current;
      if (!gr) return;
      const { colour: c, level } = lampLight(c0 ?? BLACK);
      const lit = !isDark(c0);
      const a = 0.25 + 0.75 * level;
      gr.clear();
      if (!lit) {
        gr.path(path).stroke({ color: 0x323a42, width: spec.width, cap: "round" });
      } else {
        gr.path(path).stroke({
          color: rgbNum(c),
          alpha: 0.4 + 0.6 * a,
          width: spec.width,
          cap: "round",
        });
        if (spec.glow >= 1) {
          const core = {
            r: (c.r + 255 * 1.4) / 2.4,
            g: (c.g + 255 * 1.4) / 2.4,
            b: (c.b + 255 * 1.4) / 2.4,
          };
          gr.path(path).stroke({
            color: rgbNum(core),
            alpha: 0.35 + 0.6 * a,
            width: spec.width * 0.42,
            cap: "round",
          });
        }
      }
      const s = glow.current;
      if (s) {
        s.visible = lit;
        s.tint = rgbNum(c);
        s.alpha = 0.55 * a * spec.glow;
      }
      repaint.mark();
    },
    [path, spec.width, spec.glow, repaint],
  );
  const shown = useRef<Colour | undefined>(undefined);
  const want = useRef(lamp);
  want.current = lamp;
  const same = (a?: Colour, b?: Colour) =>
    a === b || (!!a && !!b && a.r === b.r && a.g === b.g && a.b === b.b);
  const show = useCallback(
    (c: Colour | undefined) => {
      const cc = c ?? BLACK;
      if (shown.current !== undefined && same(cc, shown.current)) return;
      shown.current = cc;
      paint(cc);
    },
    [paint],
  );
  useEffect(() => show(lamp), [lamp, show]);
  // A glow that arrives after the stroke picks the colour up then.
  const glowRef = useCallback(
    (s: Sprite | null) => {
      glow.current = s;
      art.ref(s);
      if (s) {
        shown.current = undefined;
        show(want.current);
      }
    },
    [art.ref, show],
  );
  // The power-up sweep overrides the lamp for a moment (LedSweep sets it).
  const sweep = useSweep();
  useTick(
    useCallback(() => {
      const c = sweep.colour(spec);
      show(c ?? want.current);
    }, [sweep, spec, show]),
  );
  return (
    <pixiContainer>
      {art.texture && (
        <pixiSprite
          ref={glowRef}
          texture={art.texture}
          scale={art.scale}
          anchor={0.5}
          x={spec.at.x}
          y={spec.at.y}
          visible={false}
        />
      )}
      <pixiGraphics ref={g} draw={noop} />
    </pixiContainer>
  );
}

/** The power-up sweep's colour for a lamp right now, or null when it is not sweeping.
 *  Read per frame; the lamp index is found from the spec's x. */
function useSweep() {
  const { store, repaint } = useScene();
  return useMemo(
    () => ({
      colour(spec: LedSpec): Colour | null {
        const d = store.current;
        const at = d?.link.sweepAt;
        if (!d || at == null || d.status?.state !== "connected" || spec.lamp === undefined) {
          return null;
        }
        const t = performance.now() - at - 260;
        if (t >= SWEEP_MS) return null;
        repaint.mark();
        if (t < 0) return null;
        const lamps = sweepLamps(t, d.status?.lamps ?? [], d.config);
        return lamps[spec.lamp] ?? BLACK;
      },
    }),
    [store, repaint],
  );
}

/** POWER, AMP and APP: POWER's colour from the charge level, breathing while charging;
 *  AMP and APP as status.lamps says, with a ring when hovered and a plate when selected. */
function Lamps({ data, k }: { data: SceneData; k: number }) {
  const status = data.status;
  const power = powerLamp({
    connected: status?.state === "connected",
    level: status?.battery ?? -1,
    powered: !!status?.powered,
  });
  const hover = useHover();
  const blink = useRef<Container>(null);
  const { repaint } = useScene();
  const blinking = power.blink && !data.reducedMotion;
  useTick(
    useCallback(() => {
      const c = blink.current;
      if (!c) return;
      if (!blinking) {
        c.alpha = 1;
        return;
      }
      // A slow breath, 1.7 s, never fully dark: 1 → 0.25 → 1, eased.
      const t = (performance.now() % 1700) / 1700;
      c.alpha = 0.625 + 0.375 * Math.cos(t * 2 * Math.PI);
      repaint.mark();
    }, [blinking, repaint]),
  );
  const specs = useMemo(() => {
    const y = MIRROR / 2;
    const dot = (i: 0 | 1): LedSpec => ({
      d: `M${lampX(i)} ${y} h0.01`,
      width: u(REF.lamp.dot),
      glow: 0.25,
      shape: "dot",
      at: { x: lampX(i), y },
      lamp: i === 0 ? LAMP_AMP : LAMP_APP,
    });
    return {
      power: {
        d: powerPath(),
        width: u(REF.lamp.thick),
        glow: 0.4,
        shape: "bar" as const,
        at: { x: fx(REF.lamp.power), y },
      },
      dots: [dot(0), dot(1)],
    };
  }, []);
  const lamps = status?.lamps ?? [];
  return (
    <pixiContainer>
      <pixiContainer ref={blink}>
        <Led spec={specs.power} lamp={POWER_RGB[power.colour]} k={k} />
      </pixiContainer>
      {specs.dots.map((s) => (
        <Led key={s.lamp} spec={s} lamp={lamps[s.lamp ?? 0]} k={k} />
      ))}
      {data.indicators &&
        ([0, 1] as const).map((i) => (
          <Indicator
            key={i}
            i={i}
            hovered={hover?.kind === "indicator" && hover.i === i}
            selected={data.selectedIndicator === i}
            palette={data.palette}
            k={k}
          />
        ))}
    </pixiContainer>
  );
}

/** AMP or APP, when it can be edited: a faint ring round the dot on hover; when
 *  selected, a plate round the dot and its legend. */
function Indicator({
  i,
  hovered,
  selected,
  palette,
  k,
}: {
  i: 0 | 1;
  hovered: boolean;
  selected: boolean;
  palette: Palette;
  k: number;
}) {
  const b = indicatorBox(i);
  const ring = useHairline(
    (g, px) => {
      g.circle(lampX(i), MIRROR / 2, IND.ring).stroke({ color: palette.lampCold, width: 1.5 * px });
    },
    `${palette.lampCold}`,
    k,
  );
  const plate = useHairline(
    (g, px) => {
      const r = 8 * px;
      // the glow round the plate (box-shadow 0 0 6px / 0 0 16px), then the plate
      g.roundRect(b.x, b.y, b.w, b.h, r).stroke({ color: 0xc9e4f2, alpha: 0.06, width: 12 * px });
      g.roundRect(b.x, b.y, b.w, b.h, r).stroke({ color: 0xc9e4f2, alpha: 0.16, width: 5 * px });
      g.roundRect(b.x, b.y, b.w, b.h, r).fill({ color: palette.lampCold, alpha: 0.07 });
      g.roundRect(b.x + px, b.y + px, b.w - 2 * px, b.h - 2 * px, r).stroke({
        color: palette.lampCold,
        width: 2 * px,
      });
    },
    `${palette.lampCold}/${b.w}`,
    k,
  );
  useFade(ring, hovered, DUR.up, 0.55);
  useFade(plate, selected);
  return (
    <>
      <pixiGraphics ref={ring} draw={noop} alpha={0} visible={false} />
      <pixiGraphics ref={plate} draw={noop} alpha={0} visible={false} />
    </>
  );
}

/** One footswitch: its plate, bracket or tile, LED, numeral, nut and cap. */
function Switch({ n, data, k }: { n: number; data: SceneData; k: number }) {
  const { x, top, tile } = slot(n);
  const hover = useHover();
  const selected = data.selected === n;
  const turnable = data.nuts.mode === "custom";
  const over = hover && (hover.kind === "switch" || hover.kind === "nut") && hover.n === n;
  const overNut = !!over && hover?.kind === "nut";
  const held = ((data.status?.held ?? 0) & (1 << n)) !== 0;
  const lamp = data.status?.lamps?.[n];
  const name = SWITCH_NAMES[n];
  const nut = nutAt(n);
  const nf = nut.r * (Math.sqrt(3) / 2);

  const plate = useHairline(
    (g, px) => {
      const b = plateBox(n);
      g.roundRect(b.x, b.y, b.w, b.h, 16).fill({ color: data.palette.lampCold, alpha: 0.07 });
      g.roundRect(b.x, b.y, b.w, b.h, 16).stroke({ color: data.palette.lampCold, width: px });
    },
    `${data.palette.lampCold}`,
    k,
  );
  useFade(plate, selected);

  const bracket = useRef<Graphics>(null);
  const drawBracket = useCallback(
    (g: Graphics) => {
      g.clear();
      if (tile) {
        // the tile is in the case's bake; this is its hover brightening
        const t = tileBox(n);
        g.roundRect(t.x, t.y, t.w, t.h, u(REF.tile.r)).fill({ color: 0xffffff, alpha: 0.08 });
      } else {
        g.path(new GraphicsPath(bracketPath(n))).stroke({
          color: GOLD,
          width: u(REF.bracket.stroke),
          cap: "round",
        });
      }
    },
    [n, tile],
  );
  useTween(over ? 1 : 0, DUR.up, (v) => {
    const g = bracket.current;
    if (!g) return false;
    g.alpha = tile ? v : 0.62 + 0.28 * v;
  });

  const numeral = useRef<Graphics>(null);
  const drawNumeral = useCallback(
    (g: Graphics) => {
      g.clear();
      if (!tile) g.path(new GraphicsPath(numeralPath(name, x, numeralY(n)))).fill({ color: CREAM });
    },
    [name, x, n, tile],
  );
  useTween(over || selected ? 1 : 0.82, DUR.up, (v) => {
    const g = numeral.current;
    if (!g) return false;
    g.alpha = v;
  });

  const led = useMemo<LedSpec>(
    () => ({
      d: ledPath(n),
      width: u(REF.led.thick),
      glow: 1,
      shape: top ? "smile" : "frown",
      at: { x, y: rowY(top, LED_Y) },
      lamp: n,
    }),
    [n, top, x],
  );

  return (
    <pixiContainer>
      <pixiGraphics ref={plate} draw={noop} alpha={0} visible={false} />
      <pixiGraphics ref={bracket} draw={drawBracket} alpha={tile ? 0 : 0.62} />
      <Led spec={led} lamp={lamp} k={k} />
      <pixiGraphics ref={numeral} draw={drawNumeral} alpha={0.82} />
      {turnable && <NutRing n={n} on={!!over && overNut} palette={data.palette} k={k} />}
      <Nut n={n} angle={data.nuts.angles[n] ?? 0} k={k} nf={nf} />
      <pixiGraphics
        draw={useCallback(
          (g: Graphics) => {
            g.clear();
            g.roundRect(
              x - u(REF.cap.slot.w) / 2,
              nut.y + u(REF.cap.slot.dy) - u(REF.cap.slot.h) / 2,
              u(REF.cap.slot.w),
              u(REF.cap.slot.h),
              1.5,
            ).fill({ color: 0x2a2723 });
          },
          [x, nut.y],
        )}
      />
      <Cap x={x} y={nut.y} held={held} k={k} />
      {turnable && (
        <NutReadout
          n={n}
          angle={data.nuts.angles[n] ?? 0}
          shown={(!!over && overNut) || data.nuts.peek}
          palette={data.palette}
          k={k}
        />
      )}
    </pixiContainer>
  );
}

/** Match my pedal: a faint dashed cold ring round a nut says it turns. */
function NutRing({ n, on, palette, k }: { n: number; on: boolean; palette: Palette; k: number }) {
  const nut = nutAt(n);
  const ref = useHairline(
    (g, px) => {
      // stroke-dasharray 3 4, as arcs
      const r = nut.r + 6;
      const dash = 3 * px;
      const gap = 4 * px;
      const step = (dash + gap) / r;
      for (let a = 0; a < Math.PI * 2 - step / 2; a += step) {
        g.moveTo(nut.x + r * Math.cos(a), nut.y + r * Math.sin(a));
        g.arc(nut.x, nut.y, r, a, a + dash / r);
      }
      g.stroke({ color: palette.lampCold, width: px });
    },
    `${palette.lampCold}`,
    k,
  );
  useFade(ref, on, DUR.up, 0.6);
  return <pixiGraphics ref={ref} draw={noop} alpha={0} visible={false} />;
}

/** The hex nut: one texture at 0°, turned on the GPU. It eases to each new angle the short
 *  way round (a hexagon repeats every 60°), or lands at once when the hand turned it. Its
 *  shadow turns with it; the light turns with it too, where the DOM's stayed put. */
function Nut({ n, angle, k, nf }: { n: number; angle: number; k: number; nf: number }) {
  const nut = nutAt(n);
  const art = useBaked("spark/nut", NUT_BOX * k, (px) => <NutSvg px={px} />, { unit: k });
  const sprite = useRef<Sprite | null>(null);
  const shadow = useRef<Graphics>(null);
  const { repaint, store } = useScene();
  const t = useRef({
    target: angle,
    from: angle,
    to: angle,
    at: 0,
    shown: Number.NaN,
    on: null as Sprite | null,
  });
  if (t.current.target !== angle) {
    const instant = nutByHand.has(n) || store.current?.reducedMotion;
    nutByHand.delete(n);
    const from = Number.isNaN(t.current.shown) ? angle : t.current.shown;
    t.current = {
      target: angle,
      from,
      to: nearest(from, angle),
      at: instant ? 0 : performance.now(),
      shown: from,
      on: null,
    };
  }
  useTick(
    useCallback(() => {
      const s = t.current;
      const kk = easeOutCubic((performance.now() - s.at) / 420);
      const a = s.from + (s.to - s.from) * kk;
      // Compared with what was written: Pixi keeps radians, and degrees read back are
      // never quite equal.
      if (a === s.shown && s.on === sprite.current) return;
      s.shown = a;
      s.on = sprite.current;
      if (sprite.current) sprite.current.angle = a;
      if (shadow.current) shadow.current.angle = a;
      repaint.mark();
    }, [repaint]),
  );
  const ref = useCallback(
    (s: Sprite | null) => {
      sprite.current = s;
      art.ref(s);
      if (s) s.angle = t.current.shown || t.current.to;
    },
    [art.ref],
  );
  return (
    <>
      <pixiGraphics
        ref={shadow}
        x={nut.x + 3}
        y={nut.y + 6}
        draw={useCallback(
          (g: Graphics) => {
            g.clear();
            g.ellipse(0, 0, nf + 3, nut.r + 2).fill({ color: 0x000000, alpha: 0.45 });
          },
          [nf, nut.r],
        )}
      />
      {art.texture && (
        <pixiSprite
          ref={ref}
          texture={art.texture}
          scale={art.scale}
          anchor={0.5}
          x={nut.x}
          y={nut.y}
        />
      )}
    </>
  );
}

/** The footswitch cap: a round nickel cap that sinks and darkens when held. */
function Cap({ x, y, held, k }: { x: number; y: number; held: boolean; k: number }) {
  const art = useBaked("spark/cap", CAP_BOX * k, (px) => <CapSvg px={px} />, { unit: k });
  const sprite = useRef<Sprite | null>(null);
  const shadow = useRef<Graphics>(null);
  const ring = u(REF.cap.ring);
  useTween(
    held ? 1 : 0,
    DUR.fast,
    (v) => {
      const s = sprite.current;
      const sh = shadow.current;
      if (!s || !sh) return false;
      s.y = y + 1.5 * v;
      s.scale.set(art.scale * (1 - 0.07 * v));
      const g = Math.round(255 * (1 - 0.28 * v));
      s.tint = (g << 16) | (g << 8) | g;
      sh.alpha = 0.45 - 0.25 * v;
    },
    EASE,
  );
  const ref = useCallback(
    (s: Sprite | null) => {
      sprite.current = s;
      art.ref(s);
    },
    [art.ref],
  );
  return (
    <>
      <pixiGraphics
        ref={shadow}
        alpha={0.45}
        draw={useCallback(
          (g: Graphics) => {
            g.clear();
            g.circle(x + 1, y + 3, ring + 1).fill({ color: 0x000000 });
          },
          [x, y, ring],
        )}
      />
      {art.texture && (
        <pixiSprite ref={ref} texture={art.texture} scale={art.scale} anchor={0.5} x={x} y={y} />
      )}
    </>
  );
}

/** A tiny readout of a nut's angle, in the gap between its tip and the LED. */
function NutReadout({
  n,
  angle,
  shown,
  palette,
  k,
}: {
  n: number;
  angle: number;
  shown: boolean;
  palette: Palette;
  k: number;
}) {
  const ref = useRef<Container>(null);
  useFade(ref, shown);
  const style = useMemo(
    () => new TextStyle({ fontFamily: palette.mono, fontSize: 9, fill: palette.lampCold }),
    [palette.mono, palette.lampCold],
  );
  const text = degText(angle);
  const bg = useCallback(
    (g: Graphics) => {
      g.clear();
      const w = text.length * 5.6 + 8;
      g.roundRect(-w / 2, -6.5, w, 13, 3).fill({ color: 0x08090b, alpha: 0.82 });
    },
    [text],
  );
  return (
    <pixiContainer ref={ref} x={COL[n % 3]} y={readoutY(n)} scale={1 / k} alpha={0} visible={false}>
      <pixiGraphics draw={bg} />
      <pixiText text={text} style={style} anchor={0.5} />
    </pixiContainer>
  );
}

// ---- captions -----------------------------------------------------------------------

/** The mapping captions above and below the case, each joined to its switch by a leader:
 *  equal columns, the outer leaders angling back to the physical switches. */
function Captions({ data }: { data: SceneData }) {
  const w = data.layout.spark.w;
  const caseH = (H * w) / W;
  const k = w / W;
  const hover = useHover();
  const p = data.palette;
  const leaders = useHairline((g, px) => {
    for (const top of [true, false]) {
      const oy = top ? 4 : SPARK.caseTop + caseH;
      for (const n of top ? [0, 1, 2] : [3, 4, 5]) {
        const c = n % 3;
        const label = SPARK.padX + ((c + 0.5) / 3) * w;
        const sx = SPARK.padX + COL[c] * k;
        const y = (v: number) => oy + (top ? v : CAPTION_ROW - v);
        const on = data.selected === n;
        g.moveTo(label, y(32))
          .lineTo(label, y(40))
          .lineTo(sx, y(56))
          .lineTo(sx, y(72))
          .stroke({ color: on ? p.cold : p.leader, alpha: on ? 1 : 0.6, width: px });
      }
    }
  }, `${w}/${data.selected}/${p.cold}/${p.leader}`);
  return (
    <pixiContainer>
      <pixiGraphics ref={leaders} draw={noop} />
      {[0, 1, 2, 3, 4, 5].map((n) => (
        <Caption
          key={n}
          n={n}
          data={data}
          hot={data.selected === n || (hover?.kind === "caption" && hover.n === n)}
        />
      ))}
    </pixiContainer>
  );
}

function Caption({ n, data, hot }: { n: number; data: SceneData; hot: boolean }) {
  const w = data.layout.spark.w;
  const p = data.palette;
  const top = n < 3;
  const sw = data.config?.switches[n];
  const main = sw ? actionCaption(sw.tap) : "Not assigned";
  const hold = sw ? longCaption(sw.long) : "";
  const mainStyle = useMemo(
    () => new TextStyle({ fontFamily: p.font, fontSize: 11, fill: hot ? p.cold : p.muted }),
    [p.font, p.cold, p.muted, hot],
  );
  const holdStyle = useMemo(
    () => new TextStyle({ fontFamily: p.font, fontSize: 10, fill: p.faint }),
    [p.font, p.faint],
  );
  const max = w / 3 - 12;
  const cx = SPARK.padX + ((n % 3) + 0.5) * (w / 3);
  const caseH = (H * w) / W;
  const y0 = top ? 4 : SPARK.caseTop + caseH + CAPTION_ROW - CAPTION_H;
  const mainText = useMemo(() => fitTextCached(main, mainStyle, max), [main, mainStyle, max]);
  const holdText = useMemo(() => fitTextCached(hold, holdStyle, max), [hold, holdStyle, max]);
  return (
    <pixiContainer x={Math.round(cx)} y={y0}>
      <pixiText text={mainText} style={mainStyle} anchor={{ x: 0.5, y: 0 }} y={0.5} />
      {holdText && (
        <pixiText text={holdText} style={holdStyle} anchor={{ x: 0.5, y: 0 }} y={16.5} />
      )}
    </pixiContainer>
  );
}

const fitCache = new Map<string, string>();
function fitTextCached(text: string, style: TextStyle, max: number): string {
  const key = `${text}|${style.fontSize}|${style.fontFamily}|${Math.round(max)}`;
  let hit = fitCache.get(key);
  if (hit === undefined) {
    hit = fitText(text, style, max);
    if (fitCache.size > 500) fitCache.clear();
    fitCache.set(key, hit);
  }
  return hit;
}

/** The EXP jacks on the back edge: a plug when something is in it, and the label. The
 *  canvas draws each cable to its pedal (ExpView), so only the plug. */
function Jacks({ data }: { data: SceneData }) {
  const w = data.layout.spark.w;
  const p = data.palette;
  return (
    <>
      {[0, 1].map((n) => (
        <Jack
          key={n}
          n={n}
          x={SPARK.padX + JACK_X[n] * w}
          y={SPARK.caseTop}
          cable={!!data.status?.cables?.[n]}
          palette={p}
        />
      ))}
    </>
  );
}

function Jack({
  n,
  x,
  y,
  cable,
  palette,
}: {
  n: number;
  x: number;
  y: number;
  cable: boolean;
  palette: Palette;
}) {
  const plug = useRef<Graphics>(null);
  useFade(plug, cable, DUR.up);
  const style = useMemo(
    () =>
      new TextStyle({
        fontFamily: palette.font,
        fontSize: 8,
        fontWeight: "600",
        letterSpacing: 8 * 0.12,
        fill: cable ? palette.muted : palette.faint,
      }),
    [palette.font, palette.muted, palette.faint, cable],
  );
  return (
    <pixiContainer x={x} y={y}>
      <pixiGraphics
        ref={plug}
        alpha={0}
        visible={false}
        draw={useCallback((g: Graphics) => {
          g.clear();
          // the 14 x 30 plug, its bottom 2px into the case's edge
          g.roundRect(-5, -16, 10, 13, 2.5)
            .fill({ color: 0x1b1e21 })
            .stroke({ color: 0x41484e, width: 1 });
          g.roundRect(-3.5, -4, 7, 4, 1).fill({ color: 0x9a9384 });
        }, [])}
      />
      <pixiText text={`EXP ${n + 1}`} style={style} x={10} y={-3} anchor={{ x: 0, y: 1 }} />
    </pixiContainer>
  );
}
