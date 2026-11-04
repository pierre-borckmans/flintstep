import { useEffect, useState } from "react";
import { cx } from "./cx";

/** A small numeric entry: type a value, or use the arrow keys (shift for 10).
 *  `parse` / `format` let a field speak another unit, like note names. The value is
 *  committed on every valid keystroke, so the pedal preview follows the typing. */
export function NumField({
  value,
  onChange,
  min,
  max,
  label,
  parse,
  format,
  suffix,
  className,
  disabled,
  wide,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  label: string;
  parse?: (s: string) => number | null;
  format?: (v: number) => string;
  suffix?: string;
  className?: string;
  disabled?: boolean;
  wide?: boolean;
}) {
  const show = format ?? String;
  const [text, setText] = useState(show(value));
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setText(show(value));
  }, [value, focus]);

  const read = (s: string): number | null => {
    const v = parse ? parse(s) : /^-?\d+$/.test(s.trim()) ? Number(s) : null;
    return v !== null && v >= min && v <= max ? v : null;
  };
  const bad = read(text) === null;
  const bump = (d: number) => {
    const v = Math.min(max, Math.max(min, value + d));
    onChange(v);
    setText(show(v));
  };

  return (
    <label
      className={cx(
        "flex h-9 items-center gap-1.5 rounded-ui-sm border bg-sunken px-2 shadow-[inset_0_1px_2px_rgb(0_0_0/0.5)]",
        bad && focus ? "border-hot/60" : "border-edge focus-within:border-edge-strong",
        disabled && "opacity-40",
        className,
      )}
    >
      <span className="text-ui-2xs font-semibold uppercase tracking-kicker text-faint">
        {label}
      </span>
      <input
        type="text"
        inputMode="numeric"
        disabled={disabled}
        aria-label={label}
        value={text}
        onFocus={(e) => {
          setFocus(true);
          e.currentTarget.select();
        }}
        onBlur={() => {
          setFocus(false);
          setText(show(value));
        }}
        onChange={(e) => {
          setText(e.target.value);
          const v = read(e.target.value);
          if (v !== null) onChange(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            bump((e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1));
          } else if (e.key === "Enter") e.currentTarget.blur();
        }}
        className={cx(
          "min-w-0 flex-1 bg-transparent text-right font-mono text-ui-md text-bone tabular-nums outline-none",
          wide ? "w-14" : "w-8",
        )}
      />
      {suffix && <span className="text-ui-xs text-muted">{suffix}</span>}
    </label>
  );
}
