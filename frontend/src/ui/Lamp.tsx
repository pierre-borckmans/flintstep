import type { CSSProperties } from "react";
import { cx } from "./cx";

/** A status lamp: the only coloured thing in the chrome. Unlit is a dark plastic dome,
 *  not a hidden element. LED timing: it switches, it does not fade. */
export type LampColour = "beam" | "live" | "hot" | "cold" | "warn" | "key";

const GLOW: Record<LampColour, string> = {
  beam: "var(--glow-accent)",
  live: "var(--glow-good)",
  hot: "var(--glow-hot)",
  cold: "var(--glow-cold)",
  warn: "var(--glow-warn)",
  key: "var(--glow-key)",
};

const LIT: Record<LampColour, string> = {
  beam: "radial-gradient(circle at 38% 30%, #ffe0ae, var(--lamp-beam))",
  live: "radial-gradient(circle at 38% 30%, #c3f5d5, var(--lamp-live))",
  hot: "radial-gradient(circle at 38% 30%, #ffb0a6, var(--lamp-hot))",
  cold: "radial-gradient(circle at 38% 30%, #ecf7fd, var(--lamp-cold))",
  warn: "radial-gradient(circle at 38% 30%, #ffd79b, var(--lamp-warn))",
  key: "radial-gradient(circle at 38% 30%, #fffaf1, var(--lamp-key))",
};

export const UNLIT = "var(--lamp-unlit)";

export function Lamp({
  on = false,
  colour = "beam",
  size = 6,
  className,
  title,
  style,
}: {
  on?: boolean;
  colour?: LampColour;
  size?: number;
  className?: string;
  title?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      title={title}
      aria-hidden
      className={cx("inline-block shrink-0 rounded-full", className)}
      style={{
        width: size,
        height: size,
        background: on ? LIT[colour] : UNLIT,
        boxShadow: on
          ? `${GLOW[colour]}, var(--lamp-bezel)`
          : "inset 0 1px 0 var(--lamp-unlit-edge)",
        // An LED: on at once, off with the shortest decay.
        transition: on
          ? "none"
          : "background var(--dur-led) var(--ease-led), box-shadow var(--dur-led) var(--ease-led)",
        ...style,
      }}
    />
  );
}
