import { type ComponentProps, useEffect, useRef, useState } from "react";
import { Pedal } from "./Pedal";

/** Keep the entire pedal and its mapping captions inside the available space. */
export function PedalViewer(props: ComponentProps<typeof Pedal>) {
  const viewer = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(480);

  useEffect(() => {
    const el = viewer.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect;
      // Observe the grid-sized outer panel, not its content: WebKit can size
      // a flex child from the pedal itself, creating a resize feedback loop.
      const availableWidth = w - 64;
      const availableHeight = h - 64;
      setWidth(Math.max(0, Math.min(availableWidth, (availableHeight - 168) / 0.557 + 16)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={viewer} className="pedal-viewer" aria-label="Pedal viewer">
      <div className="viewer-stage">
        <div className="viewer-object" style={{ width }}>
          <Pedal {...props} />
        </div>
      </div>
    </section>
  );
}
