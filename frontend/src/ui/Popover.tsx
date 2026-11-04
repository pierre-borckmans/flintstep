import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { cx } from "./cx";

/** Stays mounted while `open`, and for as long as its exit runs after. */
export function usePresence(open: boolean, el: React.RefObject<HTMLElement | null>) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  useEffect(() => {
    if (open || !mounted) return;
    const node = el.current;
    const done = () => setMounted(false);
    // The exit's own end (not a child's), or a timeout if it never runs (a hidden window).
    const onEnd = (e: AnimationEvent) => e.target === node && done();
    const t = setTimeout(done, 600);
    node?.addEventListener("animationend", onEnd);
    return () => {
      clearTimeout(t);
      node?.removeEventListener("animationend", onEnd);
    };
  }, [open, mounted]);
  return mounted || open;
}

/** A floating panel over its anchor: scales and fades in from the anchor's side, fades
 *  out on close. Esc and a press outside close it; presses on `ignore` (the toggle
 *  button, which closes it itself) do not. Children mount when it opens. */
export function Popover({
  open,
  onClose,
  side = "below",
  ignore,
  className,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  side?: "below" | "above";
  /** A selector for elements whose presses are not "outside". */
  ignore?: string;
  className?: string;
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mounted = usePresence(open, ref);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (ref.current?.contains(t) || (ignore && t.closest?.(ignore))) return;
      close.current();
    };
    // Rows that use Esc themselves (renaming) stop it before it gets here.
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, ignore]);

  if (!mounted) return null;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      data-state={open ? "open" : "closed"}
      className={cx("popover", className)}
      style={
        {
          "--pop-origin": side === "below" ? "top center" : "bottom center",
          "--pop-from": side === "below" ? "-4px" : "4px",
        } as CSSProperties
      }
    >
      {children}
    </div>
  );
}
