import { useApplication, useTick } from "@pixi/react";
import type { Container, Ticker } from "pixi.js";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { flatten, springStep, unflatten } from "../lib/exppedal";
import { contentBounds } from "./camera/camera";
import { useScene, useSceneData } from "./context";
import { Cables, ExpUnit } from "./ExpView";
import { SparkContent } from "./SparkView";
import { textResolution, textsIn } from "./text";

/** How the pedals settle into a new layout: a critically damped spring, ~0.3 s. */
const LAYOUT_OMEGA = 15;

/**
 * THE WORLD — everything that pans and zooms (Beam's World).
 *
 * React builds this scene graph when the DATA changes — the status, the mapping, the
 * selection, the theme, the layout's target — and at no other time. Panning, zooming
 * and gliding are transform writes inside the ticker, and so is the layout's spring when
 * an expression pedal comes or goes: the containers React built at the target are moved
 * and scaled toward it a frame at a time.
 *
 * World coordinates are the layout's units with its centre at (0, 0), so the layout's own
 * spring cannot pull the drawing off-centre while its box changes size. They do not
 * depend on the canvas: a resize only changes the camera's scale.
 *
 * The effects here, named: handing the rig the box the camera may travel in (and a fit,
 * animated, when an expression pedal comes or goes); keeping text crisp after a zoom
 * settles. Everything else is a ticker callback.
 */
export function World() {
  const scene = useScene();
  const { rig, zoom, motion, repaint, store } = scene;
  const data = useSceneData();
  const world = useRef<Container>(null);
  const layer = useRef<Container>(null);
  const spark = useRef<Container>(null);
  const units = [useRef<Container>(null), useRef<Container>(null)];
  const spring = useRef<{ x: number[]; v: number[]; snap: number } | null>(null);
  const { app, isInitialised } = useApplication();

  // EFFECT: the box the camera may travel in, centred on the world's origin. It moves
  // only when the layout does (a pedal plugged in or out, the placement), and the camera
  // glides to fit the new one.
  const box = data?.layout.box;
  useLayoutEffect(() => {
    if (!box) return;
    const content = contentBounds({ x: -box.w / 2, y: -box.h / 2, w: box.w, h: box.h });
    rig.setContent(content, store.current?.reducedMotion ? 0 : 340);
  }, [rig, store, box?.w, box?.h]);

  // EFFECT: text re-rasterised once a zoom or a resize settles, and whenever new text
  // arrives (a mapping edit while zoomed in). Only ever UP: text rasterised for a bigger
  // view is still crisp in a smaller one, and the geometry does not change either way.
  useEffect(() => {
    if (!isInitialised) return;
    let raf = 0;
    const crisp = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const root = world.current;
        if (!root) return;
        const res = textResolution(zoom.settled);
        let changed = false;
        for (const t of textsIn(root)) {
          if (t.resolution < res) {
            t.resolution = res;
            changed = true;
          }
        }
        if (changed) repaint.mark();
      });
    };
    const offZoom = zoom.onSettle(crisp);
    const offData = store.subscribe(crisp);
    crisp();
    return () => {
      cancelAnimationFrame(raf);
      offZoom();
      offData();
    };
  }, [isInitialised, app, zoom, store, repaint]);

  const draw = useCallback(
    (ticker: Ticker) => {
      const w = world.current;
      if (!w) return;
      const cam = rig.tick(performance.now());
      w.position.set(cam.x, cam.y);
      w.scale.set(cam.scale);
      zoom.update(cam.scale);

      const d = store.current;
      if (!d) return;
      // THE LAYOUT SPRING, on the canvas's clock.
      const target = [...flatten(d.layout), ...d.presence];
      let s = spring.current;
      let moved = false;
      if (!s || s.snap !== d.snap || d.reducedMotion || s.x.length !== target.length) {
        const same = s?.x.every((v, i) => v === target[i]);
        s = { x: [...target], v: target.map(() => 0), snap: d.snap };
        spring.current = s;
        moved = !same;
      } else {
        const dt = Math.min(0.05, Math.max(0, ticker.deltaMS / 1000));
        let busy = false;
        for (let i = 0; i < s.x.length; i++) {
          if (s.x[i] === target[i] && s.v[i] === 0) continue;
          const st = springStep(s.x[i], s.v[i], target[i], dt, LAYOUT_OMEGA);
          const near = Math.abs(st.x - target[i]) < 0.01 && Math.abs(st.v) < 0.05;
          s.x[i] = near ? target[i] : st.x;
          s.v[i] = near ? 0 : st.v;
          busy ||= !near;
          moved = true;
        }
        if (busy) repaint.mark();
      }
      if (moved || motion.version === 0) {
        const mirror: [boolean, boolean] = [d.layout.units[0].mirror, d.layout.units[1].mirror];
        motion.layout = unflatten(s.x, mirror);
        motion.presence = [s.x[s.x.length - 2], s.x[s.x.length - 1]];
        motion.version++;
      }
      // Applied every frame it moved, or when React has just rebuilt the containers.
      const l = motion.layout;
      const t = d.layout;
      layer.current?.position.set(-l.box.w / 2, -l.box.h / 2);
      const sp = spark.current;
      if (sp) {
        sp.position.set(l.spark.x, l.spark.y);
        sp.scale.set(t.spark.w > 0 ? l.spark.w / t.spark.w : 1);
      }
      for (const n of [0, 1] as const) {
        const c = units[n].current;
        if (!c) continue;
        const pr = motion.presence[n];
        const away = 1 - pr;
        const u = l.units[n];
        c.visible = pr > 0.001;
        c.alpha = pr;
        c.position.set(
          u.x + (d.placement === "beside" ? away * 16 : 0),
          u.y - (d.placement === "behind" ? away * 16 : 0),
        );
        c.scale.set(t.units[n].w > 0 ? u.w / t.units[n].w : 1);
      }
    },
    [rig, zoom, store, motion, repaint],
  );
  useTick(draw);

  if (!data) return null;
  return (
    <pixiContainer ref={world}>
      <pixiContainer ref={layer}>
        <Cables placement={data.placement} palette={data.palette} />
        <pixiContainer ref={spark}>
          <SparkContent data={data} />
        </pixiContainer>
        {([0, 1] as const).map((n) => (
          <pixiContainer key={n} ref={units[n]} visible={false}>
            <ExpUnit n={n} data={data} />
          </pixiContainer>
        ))}
      </pixiContainer>
    </pixiContainer>
  );
}
