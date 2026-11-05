import { useRef } from "react";
import { cx } from "./cx";
import { useIndicator } from "./useIndicator";

export interface SegOption<T extends string> {
  value: T;
  label: string;
  /** A few words under the label (the trigger modes). */
  hint?: string;
  /** A tooltip, for an option whose label does not say enough by itself. */
  title?: string;
}

/** Segmented control. The chosen segment is lit, never tinted: one lit thumb slides
 *  behind the options to the chosen one. ←/→ move the choice, like native radios. */
export function Seg<T extends string>({
  options,
  value,
  onChange,
  className,
  size = "md",
  label,
  fit = false,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  size?: "sm" | "md";
  label?: string;
  /** Segments as wide as their labels (the rest shared out) instead of all equal. */
  fit?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const thumb = useIndicator(box, '[aria-checked="true"]', [value, options.length]);
  const index = options.findIndex((o) => o.value === value);

  const onKey = (e: React.KeyboardEvent) => {
    const d =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (!d) return;
    e.preventDefault();
    const next = options[(Math.max(0, index) + d + options.length) % options.length];
    onChange(next.value);
    box.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus();
  };

  return (
    <div
      ref={box}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKey}
      className={cx(
        "seg relative isolate flex rounded-ui-md border border-edge bg-sunken p-0.5 inset-shadow-groove",
        className,
      )}
    >
      <span
        aria-hidden
        data-ready={thumb.ready}
        className="seg-thumb slide-indicator lit inset-y-0.5 -z-10 rounded-ui-sm bg-panel3"
        style={thumb.style}
      />
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            data-value={o.value}
            title={o.title}
            tabIndex={on || (index < 0 && o === options[0]) ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cx(
              fit ? "flex-auto" : "flex-1",
              "flex min-w-0 rounded-ui-sm font-semibold transition-[color,background-image] duration-(--dur) ease-(--ease) active:brightness-90",
              o.hint
                ? "flex-col items-center gap-0.5 px-1.5 py-1.5"
                : cx(
                    "items-center justify-center",
                    size === "sm" ? "h-7 px-2 text-ui-xs" : "h-8 px-1.5 text-ui-sm",
                  ),
              on ? "text-bone" : "text-muted hover:text-text hover:warm",
              // The thumb carries the light until it has been placed once.
              on && !thumb.shown && "lit bg-panel3",
            )}
          >
            <span className={cx("truncate", o.hint && "text-ui-sm leading-none")}>{o.label}</span>
            {o.hint && (
              <span
                className={cx(
                  "truncate text-ui-2xs leading-none font-normal",
                  on ? "text-muted" : "text-faint",
                )}
              >
                {o.hint}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
