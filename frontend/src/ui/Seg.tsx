import { cx } from "./cx";

/** Segmented control. The chosen segment is lit, never tinted. */
export function Seg<T extends string>({
  options,
  value,
  onChange,
  className,
  size = "md",
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  size?: "sm" | "md";
  label?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx(
        "flex rounded-ui-md border border-edge bg-sunken p-0.5 shadow-[inset_0_1px_2px_rgb(0_0_0/0.5)]",
        className,
      )}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cx(
              "flex-1 truncate rounded-ui-sm font-semibold transition-[color,background-color,box-shadow] duration-(--dur) ease-(--ease)",
              size === "sm" ? "h-6 px-2 text-ui-xs" : "h-7 px-2.5 text-ui-sm",
              on ? "lit bg-panel3 text-bone" : "text-muted hover:text-text hover:warm",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
