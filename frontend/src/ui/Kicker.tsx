import type { ReactNode } from "react";
import { cx } from "./cx";

/** Small uppercase label: the legend printed on a panel. */
export function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "text-ui-2xs font-semibold uppercase tracking-kicker text-muted engraved",
        className,
      )}
    >
      {children}
    </span>
  );
}
