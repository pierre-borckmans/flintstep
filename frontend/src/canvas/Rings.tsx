import { useTick } from "@pixi/react";
import type { Graphics } from "pixi.js";
import { useCallback, useRef } from "react";
import { useScene } from "./context";
import { ringsAt } from "./motion";
import type { SceneData } from "./store";

// THE LINK, SHOWN ROUND THE PEDAL (LinkOverlay's rings, on the GPU). While the pedal is
// not connected, sonar goes out from the case (searching) or closes in on it
// (connecting); when the link comes up the rings fall into the case and it flashes once.
// Three rounded rectangles redrawn per frame while they move — what the DOM did with an
// animated custom property and a box-shadow per ring.

export function Rings({
  data,
  rect,
}: {
  data: SceneData;
  rect: { x: number; y: number; w: number; h: number };
}) {
  const g = useRef<Graphics>(null);
  const { repaint, zoom } = useScene();
  const view = data.link.view;
  const mode =
    !view || data.link.phase === "gone" || view.rings === "none"
      ? null
      : data.link.phase === "leaving"
        ? ("collapse" as const)
        : view.rings;
  // The collapse runs from when the phase turned; the loops from whenever.
  const since = useRef({ mode: null as typeof mode, at: 0 });
  if (since.current.mode !== mode) since.current = { mode, at: performance.now() };
  const live = useRef({ data, rect, mode });
  live.current = { data, rect, mode };

  useTick(
    useCallback(() => {
      const gr = g.current;
      if (!gr) return;
      const { data: d, rect: r, mode: m } = live.current;
      gr.clear();
      if (!m) return;
      const t = d.freezeMs ?? performance.now() - since.current.at;
      const { rings, bloom } = ringsAt(m, t, d.palette.ringPeak, d.reducedMotion);
      const ink = d.palette.cold;
      const caseR = r.w * 0.05;
      const px = zoom.px;
      const rr = (o: number) => gr.roundRect(r.x - o, r.y - o, r.w + 2 * o, r.h + 2 * o, caseR + o);
      for (const ring of rings) {
        if (ring.alpha <= 0.002) continue;
        // the soft glow either side of the line (box-shadow 0 0 12px -2px), then the line
        rr(ring.out).stroke({ color: ink, alpha: ring.alpha * 0.1, width: 9 });
        rr(ring.out).stroke({ color: ink, alpha: ring.alpha * 0.16, width: 4 });
        rr(ring.out).stroke({ color: ink, alpha: ring.alpha, width: Math.max(px, 1) });
      }
      if (bloom > 0) {
        rr(0).stroke({ color: ink, alpha: bloom * 0.25, width: 26 });
        rr(0).stroke({ color: ink, alpha: bloom, width: 1.5 });
      }
      const moving = d.freezeMs === null && !d.reducedMotion;
      if (moving) repaint.mark();
    }, [repaint, zoom]),
  );
  return <pixiGraphics ref={g} draw={noop} />;
}

const noop = () => {};
