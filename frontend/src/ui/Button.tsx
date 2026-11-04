import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

type Kind = "primary" | "plain" | "ghost" | "danger" | "destroy";

/** primary is lit (the one thing to press); plain is a raised neutral key; ghost is
 *  type only; danger is plain until hovered, then its legend glows hot; destroy is the
 *  confirmed form of danger, hot from the start. */
export function Button({
  kind = "plain",
  size = "md",
  icon,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: Kind;
  size?: "sm" | "md";
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-ui-sm font-semibold whitespace-nowrap transition-[color,background-color,box-shadow,filter,translate] duration-(--dur-fast) ease-(--ease) enabled:active:translate-y-px enabled:active:brightness-90 disabled:cursor-default disabled:opacity-40",
        size === "sm" ? "h-6 px-2 text-ui-xs" : "h-7 px-3 text-ui-sm",
        kind === "primary" && "lit bg-panel3 text-bone enabled:hover:brightness-110",
        kind === "plain" && "rim bg-panel2 text-text enabled:hover:bg-panel3 enabled:hover:warm",
        kind === "ghost" && "text-muted enabled:hover:text-text enabled:hover:warm",
        kind === "danger" && "rim bg-panel2 text-text enabled:hover:text-hot",
        kind === "destroy" && "rim bg-panel2 text-hot enabled:hover:bg-panel3",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}
