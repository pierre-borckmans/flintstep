import { cx } from "./cx";

/** An on/off switch: a slider cap in a groove, with a lamp in the groove that lights
 *  when on. The cap is metal; only the lamp carries colour. */
export function Toggle({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cx(
        "relative h-[18px] w-[34px] shrink-0 rounded-full border border-edge bg-sunken shadow-[inset_0_1px_2px_rgb(0_0_0/0.6)] disabled:opacity-40",
      )}
    >
      <span
        className="absolute top-1/2 left-[7px] h-[5px] w-[5px] -translate-y-1/2 rounded-full"
        style={{
          background: on ? "var(--color-beam)" : "#23272b",
          boxShadow: on ? "var(--glow-accent)" : "none",
          transition: "all var(--dur-led) var(--ease-led)",
        }}
      />
      <span
        className={cx(
          "absolute top-[1px] h-[14px] w-[14px] rounded-full transition-[left] duration-(--dur) ease-(--ease)",
          on ? "left-[17px]" : "left-[1px]",
        )}
        style={{
          background: "radial-gradient(circle at 38% 30%, #9aa2a9, #50585f 60%, #3a4046)",
          boxShadow: "0 1px 2px rgb(0 0 0 / 0.7), inset 0 1px 0 rgb(255 255 255 / 0.25)",
        }}
      />
    </button>
  );
}
