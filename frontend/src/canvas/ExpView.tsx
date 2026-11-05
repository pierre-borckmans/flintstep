import { useTick } from "@pixi/react";
import { ColorMatrixFilter, type Container, type Graphics, TextStyle } from "pixi.js";
import { useCallback, useMemo, useRef } from "react";
import { expFraction, expOutput, expValue, rawFraction } from "../lib/exp";
import {
  ART,
  ART_ASPECT,
  cableBehind,
  cableBeside,
  gaugeMarks,
  jackPoint,
  type Layout,
  type Placement,
  readout,
  SPARK,
  socketPoint,
  springStep,
  tiltDeg,
} from "../lib/exppedal";
import type { ExpConfig } from "../types";
import { DUR, useFade, useTween } from "./anim";
import { ExpOverSvg, ExpTreadleSvg, ExpUnderSvg, TREADLE_BOX } from "./art/expArt";
import { useBaked, useHover, useScene } from "./context";
import type { Palette } from "./palette";
import { flatten as flattenPath, head } from "./pathPoly";
import type { SceneData } from "./store";
import { fitText } from "./text";

// THE EXPRESSION PEDALS ON THE CANVAS: a treadle pedal in side view per plugged-in jack,
// its treadle a sprite turned on the axle by a spring in the ticker, a gauge and readout
// under it, and a cable back to its jack. Where everything goes is lib/exppedal's.
//
// Each unit is built at its target place and size, in its own px (origin at its
// top-left); the World's ticker moves and scales the unit's container while the layout
// springs and fades it in and out with its presence.

const MODE_WORD = { engage: "auto-engage", toe: "toe click" } as const;

/** A simulated treadle under the hand: the position it is held at, ahead of the State
 *  that follows. Written by the pointer, read by the ticker; never React state. */
export const heldTreadle: [number | null, number | null] = [null, null];

/** Treadle spring: stiff, so it follows the jack closely. */
const TILT_OMEGA = 26;

const noop = () => {};

export function ExpUnit({ n, data }: { n: 0 | 1; data: SceneData }) {
  const x = data.config?.exp[n];
  const u = data.layout.units[n];
  if (!x) return null;
  return <Unit n={n} x={x} w={u.w} mirror={u.mirror} data={data} />;
}

function Unit({
  n,
  x,
  w,
  mirror,
  data,
}: {
  n: 0 | 1;
  x: ExpConfig;
  w: number;
  mirror: boolean;
  data: SceneData;
}) {
  const p = data.palette;
  const hover = useHover();
  const hovered = hover?.kind === "exp" && hover.n === n;
  const selected = data.selectedExp === n;
  const simulated = !!data.simulated[n];
  const raw = data.status?.expRaw?.[n] ?? -1;
  const engaged = !!data.engaged[n];
  const artH = w * ART_ASPECT;
  const k = w / ART.w;
  const trig = x.trigger.mode !== "off" ? x.trigger.mode : null;
  const lit = trig !== null && x.enabled && engaged;
  const value = raw >= 0 ? expValue(raw, x) : null;

  const plate = useRef<Graphics>(null);
  const plateDraw = useCallback(
    (g: Graphics) => {
      g.clear();
      g.roundRect(-8, -6, w + 16, artH + 56 + 10, 10).fill({ color: p.cold, alpha: 0.07 });
      g.roundRect(-8, -6, w + 16, artH + 56 + 10, 10).stroke({ color: p.cold, width: 1 });
    },
    [w, artH, p.cold],
  );
  useFade(plate, selected || hovered, DUR.up, selected ? 1 : 0.35);

  // The art: brighter under the pointer, dimmed when the input is off.
  const art = useRef<Container>(null);
  const filter = useMemo(() => new ColorMatrixFilter(), []);
  useTween(hovered ? 1 : 0, DUR.up, (h) => {
    const c = art.current;
    if (!c) return false;
    const off = !x.enabled;
    if (!off && h <= 0.001) {
      c.filters = null;
      return;
    }
    if (off) {
      // --off-dim: saturate(0.25) brightness(0.6)
      const s = 0.25;
      const b = 0.6;
      // biome-ignore format: a matrix
      filter.matrix = [
        (0.213 + 0.787 * s) * b, (0.715 - 0.715 * s) * b, (0.072 - 0.072 * s) * b, 0, 0,
        (0.213 - 0.213 * s) * b, (0.715 + 0.285 * s) * b, (0.072 - 0.072 * s) * b, 0, 0,
        (0.213 - 0.213 * s) * b, (0.715 - 0.715 * s) * b, (0.072 + 0.928 * s) * b, 0, 0,
        0, 0, 0, 1, 0,
      ];
    } else {
      const b = 1 + 0.12 * h;
      // biome-ignore format: a matrix
      filter.matrix = [b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0];
    }
    if (c.filters?.[0] !== filter) c.filters = [filter];
  });

  return (
    <pixiContainer>
      <pixiGraphics ref={plate} draw={plateDraw} alpha={0} visible={false} />
      <pixiContainer
        ref={art}
        alpha={x.enabled ? 1 : 0.75}
        x={mirror ? w : 0}
        y={-ART.y0 * k}
        scale={{ x: mirror ? -k : k, y: k }}
      >
        <ExpArt n={n} w={w} x={x} raw={raw} k={k} />
      </pixiContainer>
      {simulated && <SimTag w={w} mirror={mirror} palette={p} />}
      <pixiContainer y={artH}>
        <Gauge x={x} raw={x.enabled ? raw : -1} engaged={lit} mirror={mirror} w={w} palette={p} />
        <Readout
          y={27}
          w={w}
          name={`EXP ${n + 1}`}
          text={x.enabled ? readout(x.cc, x.channel, value) : "off"}
          off={!x.enabled}
          palette={p}
        />
        {trig && x.enabled && <Trigger y={44} w={w} lit={lit} word={MODE_WORD[trig]} palette={p} />}
      </pixiContainer>
    </pixiContainer>
  );
}

/** The pedal's three layers, the treadle turning between them. */
function ExpArt({
  n,
  w,
  x,
  raw,
  k,
}: {
  n: 0 | 1;
  w: number;
  x: ExpConfig;
  raw: number;
  k: number;
}) {
  const { repaint, store } = useScene();
  const under = useBaked("exp/under", w, (px) => <ExpUnderSvg px={px} />, { unit: k });
  const over = useBaked("exp/over", w, (px) => <ExpOverSvg px={px} />, { unit: k });
  const tw = TREADLE_BOX.w * k;
  const treadle = useBaked("exp/treadle", tw, (px) => <ExpTreadleSvg px={px} />, { unit: k });
  const axle = useRef<Container>(null);
  const live = useRef({ x, raw });
  live.current = { x, raw };
  const spring = useRef({
    v: 0,
    tilt: Number.NaN,
    drawn: Number.NaN,
    on: null as Container | null,
  });
  useTick(
    useCallback(
      (ticker: { deltaMS: number }) => {
        const c = axle.current;
        if (!c) return;
        const held = heldTreadle[n];
        const { x: cfg, raw: r } = live.current;
        const f = held ?? (r >= 0 ? (expFraction(r, cfg) ?? 0) : 0);
        const want = tiltDeg(f);
        const s = spring.current;
        if (Number.isNaN(s.tilt) || held !== null || store.current?.reducedMotion) {
          s.tilt = want;
          s.v = 0;
        } else if (Math.abs(s.tilt - want) > 0.001 || Math.abs(s.v) > 0.001) {
          const st = springStep(
            s.tilt,
            s.v,
            want,
            Math.min(0.05, ticker.deltaMS / 1000),
            TILT_OMEGA,
          );
          s.tilt = st.x;
          s.v = st.v;
          repaint.mark();
        }
        // Compared with what was written, not read back: Pixi stores radians, and the
        // round trip through degrees never compares equal.
        if (s.drawn !== s.tilt || s.on !== c) {
          s.drawn = s.tilt;
          s.on = c;
          c.angle = -s.tilt;
          repaint.mark();
        }
      },
      [n, repaint, store],
    ),
  );
  const { x: px, y: py } = ART.pivot;
  return (
    <>
      {under.texture && (
        <pixiSprite ref={under.ref} texture={under.texture} scale={under.scale} y={ART.y0} />
      )}
      <pixiContainer ref={axle} x={px} y={py}>
        {treadle.texture && (
          <pixiSprite
            ref={treadle.ref}
            texture={treadle.texture}
            scale={treadle.scale}
            x={TREADLE_BOX.x - px}
            y={TREADLE_BOX.y - py}
          />
        )}
      </pixiContainer>
      {over.texture && (
        <pixiSprite ref={over.ref} texture={over.texture} scale={over.scale} y={ART.y0} />
      )}
    </>
  );
}

function SimTag({ w, mirror, palette }: { w: number; mirror: boolean; palette: Palette }) {
  const style = useMemo(
    () =>
      new TextStyle({
        fontFamily: palette.mono,
        fontSize: 8,
        fontWeight: "600",
        letterSpacing: 8 * 0.12,
        fill: palette.beam,
      }),
    [palette.mono, palette.beam],
  );
  const text = "SIMULATED";
  const tw = text.length * 6.2 + 8;
  const x = mirror ? 2 : w - 2 - tw;
  return (
    <pixiContainer x={x} y={0}>
      <pixiGraphics
        draw={useCallback(
          (g: Graphics) => {
            g.clear();
            g.roundRect(0, 0, tw, 13, 3).stroke({ color: palette.beam, alpha: 0.5, width: 1 });
          },
          [tw, palette.beam],
        )}
      />
      <pixiText text={text} style={style} x={tw / 2} y={6.5} anchor={0.5} />
    </pixiContainer>
  );
}

/** Under the drawing: a gauge of the value going out, and the trigger threshold. The
 *  calibration lives in the Expression card, not here. Heel to toe
 *  follows the drawing: on a mirrored pedal the toe end is on the left. */
function Gauge({
  x,
  raw,
  engaged,
  mirror,
  w,
  palette: p,
}: {
  x: ExpConfig;
  raw: number;
  engaged: boolean;
  mirror: boolean;
  w: number;
  palette: Palette;
}) {
  const trig = x.trigger.mode !== "off" ? x.trigger.threshold : null;
  const m = gaugeMarks({
    // The value going out (after the curve): the threshold is measured on it too.
    fraction: raw >= 0 ? expOutput(raw, x) : null,
    rawFraction: raw >= 0 ? rawFraction(raw) : null,
    heelRaw: rawFraction(x.min),
    toeRaw: rawFraction(x.max),
    threshold: trig,
  });
  const x0 = w * 0.03;
  const gw = w * 0.94;
  const at = (f: number) => x0 + (mirror ? 1 - f : f) * gw;
  const span = (a: number, b: number) => {
    const l = at(a);
    const r = at(b);
    return [Math.min(l, r), Math.abs(r - l)] as const;
  };
  const key = JSON.stringify([m, mirror, w, engaged, p.cold, p.beam, x.enabled]);
  const draw = useCallback(
    (g: Graphics) => {
      g.clear();
      g.roundRect(x0, 13, gw, 3, 1.5).fill({ color: p.edgeStrong });
      if (m.threshold !== null && m.release !== null) {
        const [bl, bw] = span(m.release, m.threshold);
        // hatched: 1px lines every 3px at 135°
        for (let i = -7; i < bw + 7; i += 3) {
          const a = Math.max(0, i);
          const b = Math.min(bw, i + 7);
          if (b <= a) continue;
          g.moveTo(bl + a, 11 + 7 - (a - i)).lineTo(bl + b, 11 + 7 - (b - i));
        }
        g.stroke({ color: p.beam, alpha: 0.4, width: 1 });
        const tx = at(m.threshold);
        if (engaged) g.roundRect(tx - 4, 7, 8, 13, 4).fill({ color: p.lampBeam, alpha: 0.35 });
        g.roundRect(tx - 1, 10, 2, 9, 1).fill({ color: p.beam });
      }
      if (m.value !== null) {
        const [fl, fw] = span(0, m.value);
        g.roundRect(fl, 13, fw, 3, 1.5).fill({ color: p.cold, alpha: 0.55 });
        const nx = at(m.value);
        g.roundRect(nx - 4, 6, 8, 15, 4).fill({ color: p.cold, alpha: 0.18 });
        g.roundRect(nx - 1.5, 9, 3, 11, 1.5).fill({ color: p.cold });
      }
    },
    [key],
  );
  return (
    <pixiContainer alpha={x.enabled ? 1 : 0.4}>
      <pixiGraphics draw={draw} />
    </pixiContainer>
  );
}

/** "EXP 1  CC 11 · 64": the name (dropped on a small pedal) and the value sent. */
function Readout({
  y,
  w,
  name,
  text,
  off,
  palette: p,
}: {
  y: number;
  w: number;
  name: string;
  text: string;
  off: boolean;
  palette: Palette;
}) {
  const nameStyle = useMemo(
    () =>
      new TextStyle({
        fontFamily: p.font,
        fontSize: 8.5,
        fontWeight: "600",
        letterSpacing: 8.5 * 0.12,
        fill: p.faint,
      }),
    [p.font, p.faint],
  );
  const ccStyle = useMemo(
    () =>
      new TextStyle({
        fontFamily: p.mono,
        fontSize: 11,
        fontWeight: "500",
        fill: off ? p.faint : p.bone,
      }),
    [p.mono, p.faint, p.bone, off],
  );
  const small = w <= 200;
  const x0 = w * 0.03;
  const nameW = small ? 0 : name.length * 6.4 + 6;
  const shown = useMemo(() => fitText(text, ccStyle, w * 0.94 - nameW), [text, ccStyle, w, nameW]);
  return (
    <pixiContainer y={y}>
      {!small && <pixiText text={name} style={nameStyle} x={x0} y={11} anchor={{ x: 0, y: 1 }} />}
      <pixiText text={shown} style={ccStyle} x={x0 + nameW} y={12} anchor={{ x: 0, y: 1 }} />
    </pixiContainer>
  );
}

/** A trigger: its lamp and what it does, or ENGAGED (and the mode, if there is room). */
function Trigger({
  y,
  w,
  lit,
  word,
  palette: p,
}: {
  y: number;
  w: number;
  lit: boolean;
  word: string;
  palette: Palette;
}) {
  const litStyle = useMemo(
    () =>
      new TextStyle({
        fontFamily: p.font,
        fontSize: 9.5,
        fontWeight: "600",
        letterSpacing: 9.5 * 0.08,
        fill: p.beam,
      }),
    [p.font, p.beam],
  );
  const style = useMemo(
    () => new TextStyle({ fontFamily: p.font, fontSize: 9.5, fill: p.faint }),
    [p.font, p.faint],
  );
  const x0 = w * 0.03;
  const lamp = useCallback(
    (g: Graphics) => {
      g.clear();
      if (lit) {
        // --glow-accent: 0 0 8px lamp, 0 0 20px halo, at a 6px lamp
        g.circle(3, 6, 6.5).fill({ color: 0xffb454, alpha: 0.12 });
        g.circle(3, 6, 4.5).fill({ color: p.lampBeam, alpha: 0.3 });
        g.circle(3, 6, 3).fill({ color: p.lampBeam });
        g.circle(2.3, 5.2, 1.2).fill({ color: 0xffe0ae });
      } else {
        g.circle(3, 6, 3).fill({ color: p.light ? 0xc2bdb1 : 0x23272b });
      }
    },
    [lit, p.lampBeam, p.light],
  );
  const main = lit ? "ENGAGED" : word;
  const mainW = lit ? main.length * 7.2 : 0;
  return (
    <pixiContainer x={x0} y={y}>
      <pixiGraphics draw={lamp} />
      <pixiText text={main} style={lit ? litStyle : style} x={11} y={0} />
      {lit && w > 200 && <pixiText text={word} style={style} x={11 + mainW + 5} y={0} />}
    </pixiContainer>
  );
}

// ---- cables -------------------------------------------------------------------------

/** Both cables, drawn from each jack outward so they retract toward the jack, under the
 *  Spark and the pedals so the plugs and sockets cover their ends. In layout px; redrawn
 *  only on the frames the layout or a presence moved. */
export function Cables({ placement, palette }: { placement: Placement; palette: Palette }) {
  const g = useRef<Graphics>(null);
  const { motion } = useScene();
  const drawn = useRef({ version: -1, key: "" });
  const live = useRef({ placement, palette });
  live.current = { placement, palette };
  useTick(
    useCallback(() => {
      const gr = g.current;
      if (!gr) return;
      const key = `${placement}/${palette.cableShadow}`;
      if (drawn.current.version === motion.version && drawn.current.key === key) return;
      drawn.current = { version: motion.version, key };
      gr.clear();
      drawCables(gr, motion.layout, motion.presence, live.current.placement, live.current.palette);
    }, [motion, placement, palette.cableShadow]),
  );
  return <pixiGraphics ref={g} draw={noop} />;
}

function drawCables(
  g: Graphics,
  l: Layout,
  presence: [number, number],
  placement: Placement,
  p: Palette,
) {
  for (const n of [0, 1] as const) {
    const pr = presence[n];
    if (pr <= 0.001) continue;
    const u = l.units[n];
    const s = socketPoint(u);
    // the unit slides in from where it fades: the socket travels with it
    const away = 1 - pr;
    const sock =
      placement === "behind" ? { x: s.x, y: s.y - away * 16 } : { x: s.x + away * 16, y: s.y };
    const j = jackPoint(l, n);
    const jack = { x: j.x, y: j.y + SPARK.plug - 6 };
    const d =
      placement === "behind" ? cableBehind(jack, sock, u.mirror ? 1 : -1) : cableBeside(l, n, sock);
    const pts = head(flattenPath(d), pr);
    if (pts.length < 2) continue;
    const line = (dx: number, dy: number) => {
      g.moveTo(pts[0].x + dx, pts[0].y + dy);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x + dx, pts[i].y + dy);
    };
    // the shadow on the stage (blurred 2px in the DOM: two soft strokes)
    line(2, 4);
    g.stroke({
      color: 0x000000,
      alpha: p.cableShadow * 0.5,
      width: 9,
      cap: "round",
      join: "round",
    });
    line(2, 4);
    g.stroke({ color: 0x000000, alpha: p.cableShadow, width: 6, cap: "round", join: "round" });
    line(0, 0);
    g.stroke({ color: 0x1c1f22, width: 5, cap: "round", join: "round" });
    line(-0.6, -0.8);
    g.stroke({ color: 0x4a5157, alpha: 0.55, width: 1.2, cap: "round", join: "round" });
  }
}
