import { type RefObject, useMemo } from "react";
import type { Backend } from "../api";
import { actionCaption, longCaption } from "../lib/caption";
import { expFraction, expValue } from "../lib/exp";
import { dragFraction, jackFraction, readout } from "../lib/exppedal";
import { modeLabel } from "../lib/indicators";
import { bearing, round1, turn, wheelStep } from "../lib/nuts";
import { nutAt } from "../lib/sparkgeom";
import { INDICATOR_NAMES, SWITCH_NAMES } from "../types";
import { hideTooltip, showTooltipAt } from "../ui/tooltip";
import { nuts } from "../useNuts";
import { toScreen, toWorld } from "./camera/camera";
import type { Grab, PointerHandlers } from "./camera/usePointerCamera";
import type { Scene } from "./context";
import { heldTreadle } from "./ExpView";
import { caseFrame, probe, targetBox } from "./hit";
import { nutByHand } from "./SparkView";
import type { HoverTarget, SceneData } from "./store";

/** What the pointer acts on, read through a ref so the handlers keep their identity. */
export interface PointerState {
  data: SceneData | null;
  backend: Backend;
  onSelect: (n: number) => void;
  onSelectIndicator?: (i: 0 | 1) => void;
  onSelectExp?: (n: 0 | 1) => void;
  /** The canvas's place in the viewport, for tooltips. */
  canvasRect: () => DOMRect | null;
}

/**
 * EVERYTHING THE POINTER CAN DO TO THE PEDAL (Beam's usePointer): what is under a point,
 * what the cursor should say about it, and what pressing it does. All of it is geometry
 * the scene also draws from (hit.ts), so there is no second set of hit rectangles.
 */
export function usePedalPointer(scene: Scene, state: RefObject<PointerState>): PointerHandlers {
  return useMemo(() => {
    const { rig, hover, repaint } = scene;

    /** Canvas px → the layout's own px. */
    const toLayout = (at: { x: number; y: number }, d: SceneData) => {
      const w = toWorld(rig.current, at);
      return { x: w.x + d.layout.box.w / 2, y: w.y + d.layout.box.h / 2 };
    };
    const hit = (at: { x: number; y: number }): HoverTarget | null => {
      const d = state.current.data;
      if (!d || Number.isNaN(at.x)) return null;
      const p = toLayout(at, d);
      return probe(
        {
          layout: d.layout,
          present: [d.presence[0] > 0.5, d.presence[1] > 0.5],
          simulated: d.simulated,
          turnable: d.nuts.mode === "custom",
          indicators: d.indicators,
        },
        p.x,
        p.y,
      );
    };

    const tooltip = (t: HoverTarget | null) => {
      const d = state.current.data;
      const r = state.current.canvasRect();
      if (!t || !d || !r) {
        hideTooltip();
        return;
      }
      const text = describe(t, d);
      if (!text) {
        hideTooltip();
        return;
      }
      const b = targetBox(d.layout, t);
      const off = { x: -d.layout.box.w / 2, y: -d.layout.box.h / 2 };
      const a = toScreen(rig.current, { x: b.x + off.x, y: b.y + off.y });
      const s = rig.current.scale;
      // Every move, with a stable key per target: the open chip follows rather than
      // restarting its delay.
      showTooltipAt({ x: r.left + a.x, y: r.top + a.y, width: b.w * s, height: b.h * s }, text, {
        key: `pedal:${JSON.stringify(t)}`,
      });
    };

    // A simulated treadle's position goes to the backend at most every 16 ms, the last
    // one always.
    const sent = [0, 0];
    const trailing: (ReturnType<typeof setTimeout> | null)[] = [null, null];
    const send = (n: 0 | 1, f: number) => {
      const t = trailing[n];
      if (t) clearTimeout(t);
      const go = () => {
        sent[n] = performance.now();
        trailing[n] = null;
        const x = state.current.data?.config?.exp[n];
        state.current.backend.SetSimExp(n, x ? jackFraction(f, x) : f).catch(() => {});
      };
      const since = performance.now() - sent[n];
      if (since >= 16) go();
      else trailing[n] = setTimeout(go, 16 - since);
    };

    const handlers: PointerHandlers = {
      onHover(at) {
        const t = hit(at);
        const changed = hover.set(t);
        if (t || changed) tooltip(t);
        if (!t) return "";
        switch (t.kind) {
          case "nut":
            return "grab";
          case "exp":
            return t.treadle ? "ns-resize" : "pointer";
          case "power":
          case "jack":
            return "";
          default:
            return "pointer";
        }
      },
      onTap(at) {
        const t = hit(at);
        const s = state.current;
        if (!t) return;
        if (t.kind === "switch" || t.kind === "nut" || t.kind === "caption") s.onSelect(t.n);
        else if (t.kind === "indicator") s.onSelectIndicator?.(t.i);
        else if (t.kind === "exp") s.onSelectExp?.(t.n);
      },
      onGrab(at): Grab | null {
        const t = hit(at);
        const d = state.current.data;
        if (!t || !d) return null;
        if (t.kind === "nut") {
          // Turning a nut by hand, round its centre; Shift for fine steps.
          const c = caseFrame(d.layout);
          const nut = nutAt(t.n);
          const centre = toScreen(rig.current, {
            x: c.x + nut.x * c.k - d.layout.box.w / 2,
            y: c.y + nut.y * c.k - d.layout.box.h / 2,
          });
          let last = bearing(centre.x, centre.y, at.x, at.y);
          let angle = d.nuts.angles[t.n] ?? 0;
          const n = t.n;
          return {
            cursor: "grabbing",
            move(_dx, _dy, p, ev) {
              const now = bearing(centre.x, centre.y, p.x, p.y);
              angle += turn(last, now) * (ev.shiftKey ? 0.25 : 1);
              last = now;
              nutByHand.add(n);
              nuts.setAngle(n, ev.shiftKey ? round1(angle) : Math.round(angle));
            },
          };
        }
        if (t.kind === "exp" && t.treadle) {
          const n = t.n;
          const x = d.config?.exp[n];
          const raw = d.status?.expRaw?.[n] ?? -1;
          const f0 = heldTreadle[n] ?? (x && raw >= 0 ? (expFraction(raw, x) ?? 0) : 0);
          const span = Math.max(60, d.layout.units[n].w * 0.35);
          let f = f0;
          return {
            cursor: "ns-resize",
            move(_dx, dy) {
              f = dragFraction(f0, dy, span);
              heldTreadle[n] = f;
              repaint.mark();
              send(n, f);
            },
            end(moved) {
              if (!moved) return;
              send(n, f);
              // keep the hand's position until the State that follows has caught up
              setTimeout(() => {
                heldTreadle[n] = null;
                repaint.mark();
              }, 160);
            },
          };
        }
        return null;
      },
      onWheel(at, e) {
        const d = state.current.data;
        if (d?.nuts.mode !== "custom") return false;
        const t = hit(at);
        if (t?.kind !== "nut") return false;
        nutByHand.add(t.n);
        nuts.setAngle(t.n, (d.nuts.angles[t.n] ?? 0) + wheelStep(e, e.shiftKey));
        return true;
      },
      onDoubleTap(at) {
        const d = state.current.data;
        const t = hit(at);
        if (t?.kind === "nut" && d?.nuts.mode === "custom") {
          nuts.setAngle(t.n, 0);
          return;
        }
        // On a control it keeps its own meaning; on the stage it fits the pedal again.
        if (!t && !rig.isFitted()) rig.fit(d?.reducedMotion ? 0 : 220);
      },
      onGesture() {
        hideTooltip();
      },
    };
    return handlers;
  }, [scene, state]);
}

/** A tooltip's words for what the pointer is over. */
function describe(t: HoverTarget, d: SceneData): string {
  switch (t.kind) {
    case "switch":
    case "caption": {
      const sw = d.config?.switches[t.n];
      const name = SWITCH_NAMES[t.n];
      if (!sw) return `${name}\nClick to edit`;
      const hold = longCaption(sw.long);
      return `${name} · ${actionCaption(sw.tap)}${hold ? ` · ${hold}` : ""}\nClick to edit`;
    }
    case "nut":
      return `Nut ${SWITCH_NAMES[t.n]}: drag or scroll to turn, Shift for fine steps\nDouble-click to reset`;
    case "indicator": {
      const ind = d.config?.indicators[t.i];
      const name = INDICATOR_NAMES[t.i];
      return `${name} lamp${ind ? ` · ${modeLabel(ind.mode)}` : ""}\nClick to set`;
    }
    case "power": {
      const s = d.status;
      if (s?.state !== "connected" || (s.battery ?? -1) < 0) return "Battery";
      return `Battery ${s.battery}%${s.powered ? " · charging" : ""}`;
    }
    case "exp": {
      const x = d.config?.exp[t.n];
      const name = `EXP ${t.n + 1}`;
      if (!x) return name;
      if (!x.enabled) return `${name} · off\nClick to edit`;
      const raw = d.status?.expRaw?.[t.n] ?? -1;
      const v = raw >= 0 ? expValue(raw, x) : null;
      const sim = d.simulated[t.n] ? "\nSimulated: drag the treadle up or down" : "";
      return `${name} · ${readout(x.cc, x.channel, v)}${sim}\nClick to edit`;
    }
    case "jack":
      return d.status?.cables?.[t.n]
        ? `EXP ${t.n + 1} jack · a pedal is plugged in`
        : `EXP ${t.n + 1} jack · empty`;
  }
}
