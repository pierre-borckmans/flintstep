import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cx } from "./cx";

type Phase = "closed" | "opening" | "open" | "closing";

/** Content that opens and closes by animating its height. While closing it keeps showing
 *  what it last showed open, then unmounts (out of the tab order). It cancels the
 *  parent's flex/grid gap while closed, so the space around it never jumps.
 *  `appear` animates a first mount that is already open (a list item just added);
 *  `onClosed` runs once a close has finished (to remove the item for real). */
export function Collapse({
  open,
  appear = false,
  onClosed,
  className,
  children,
}: {
  open: boolean;
  appear?: boolean;
  onClosed?: () => void;
  /** On the inner box: layout for the children (flex, gap...). */
  className?: string;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>(() =>
    open ? (appear ? "opening" : "open") : "closed",
  );
  // Already open on mount, with nothing to animate: settled from the start.
  const settledAtMount = useRef(open && !appear);
  const last = useRef(children);
  if (open) last.current = children;
  const closed = useRef(onClosed);
  closed.current = onClosed;

  useLayoutEffect(() => {
    if (open && (phase === "closed" || phase === "closing")) setPhase("opening");
    else if (!open && (phase === "open" || phase === "opening")) setPhase("closing");
  }, [open]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Set straight on the element, so the closed styles below already include it.
    const parent = el.parentElement;
    if (parent) {
      const cs = getComputedStyle(parent);
      const column = cs.display.includes("grid") || cs.flexDirection.startsWith("column");
      el.style.setProperty("--collapse-gap", column ? cs.rowGap : "0px");
    }
    if (phase === "opening") {
      void el.offsetHeight; // commit the closed styles, so opening transitions from them
      const id = requestAnimationFrame(() => setPhase("open"));
      return () => cancelAnimationFrame(id);
    }
  }, [phase]);

  useEffect(() => {
    const el = ref.current;
    if (!el || (phase !== "closing" && phase !== "open")) return;
    if (settledAtMount.current) {
      settledAtMount.current = false;
      el.dataset.settled = "true";
      return () => {
        delete el.dataset.settled;
      };
    }
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      if (phase === "closing") {
        setPhase("closed");
        closed.current?.();
      } else el.dataset.settled = "true";
    };
    const onEnd = (e: TransitionEvent) =>
      e.target === el && e.propertyName === "grid-template-rows" && end();
    el.addEventListener("transitionend", onEnd);
    const t = setTimeout(end, 700);
    return () => {
      el.removeEventListener("transitionend", onEnd);
      clearTimeout(t);
      delete el.dataset.settled;
    };
  }, [phase]);

  if (phase === "closed") return null;
  return (
    <div
      ref={ref}
      className="collapsible"
      data-open={phase === "open"}
      inert={phase === "closing" || undefined}
    >
      <div className={cx(className)}>{phase === "closing" ? last.current : children}</div>
    </div>
  );
}
