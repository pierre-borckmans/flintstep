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
  warn: "0 0 7px var(--color-warn), 0 0 16px rgb(232 163 61 / 0.4)",
  key: "0 0 8px var(--color-key), 0 0 18px rgb(255 244 228 / 0.35)",
};

const LIT: Record<LampColour, string> = {
  beam: "radial-gradient(circle at 38% 30%, #ffe0ae, var(--color-beam))",
  live: "radial-gradient(circle at 38% 30%, #c3f5d5, var(--color-live))",
  hot: "radial-gradient(circle at 38% 30%, #ffb0a6, var(--color-hot))",
  cold: "radial-gradient(circle at 38% 30%, #ecf7fd, var(--color-cold))",
  warn: "radial-gradient(circle at 38% 30%, #ffd79b, var(--color-warn))",
  key: "radial-gradient(circle at 38% 30%, #fffaf1, var(--color-key))",
};

export const UNLIT = "linear-gradient(#23272b, #1a1e21)";

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
        boxShadow: on ? GLOW[colour] : "inset 0 1px 0 rgb(255 244 228 / 0.06)",
        // An LED: on at once, off with the shortest decay.
        transition: on
          ? "none"
          : "background var(--dur-led) var(--ease-led), box-shadow var(--dur-led) var(--ease-led)",
        ...style,
      }}
    />
  );
}
