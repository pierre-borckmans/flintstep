import { fromHex, rgb, SWATCHES, sameColour, toHex } from "../lib/colour";
import type { Colour } from "../types";
import { cx } from "./cx";

// LED colours: the curated swatches the pedal's LEDs render cleanly, and a custom one.
// The switch lamps and the Amp/App lamps both pick from it.

function Swatch({
  colour,
  name,
  on,
  onPick,
}: {
  colour: Colour;
  name: string;
  on: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      title={name}
      aria-label={name}
      aria-pressed={on}
      onClick={onPick}
      className="relative grid h-7 w-7 place-items-center rounded-full"
    >
      <span
        className={cx(
          "absolute inset-0 rounded-full border transition-colors duration-(--dur)",
          on ? "border-key/70" : "border-transparent",
        )}
      />
      <span
        className="h-[18px] w-[18px] rounded-full"
        style={{
          background: `radial-gradient(circle at 38% 30%, rgb(255 255 255 / 0.75), ${rgb(colour)} 68%)`,
          boxShadow: `0 0 6px ${rgb(colour, 0.6)}, 0 0 0 1px rgb(0 0 0 / 0.5)`,
        }}
      />
    </button>
  );
}

export function ColourPicker({
  colour,
  onChange,
}: {
  colour: Colour;
  onChange: (c: Colour) => void;
}) {
  const curated = SWATCHES.some((s) => sameColour(s.colour, colour));
  return (
    <div className="flex flex-wrap items-center gap-0.5">
      {SWATCHES.map((s) => (
        <Swatch
          key={s.name}
          name={s.name}
          colour={s.colour}
          on={sameColour(s.colour, colour)}
          onPick={() => onChange(s.colour)}
        />
      ))}
      <label
        title="Custom colour"
        className={cx(
          "relative ml-1 flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2 text-ui-xs",
          curated ? "border-edge text-muted hover:text-text" : "border-key/70 text-text",
        )}
      >
        <span
          className="h-3 w-3 rounded-full"
          style={{
            background: curated
              ? "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)"
              : rgb(colour),
          }}
        />
        {curated ? "Custom" : toHex(colour)}
        <input
          type="color"
          className="absolute inset-0 cursor-pointer opacity-0"
          value={toHex(colour)}
          onChange={(e) => {
            const c = fromHex(e.target.value);
            if (c) onChange(c);
          }}
        />
      </label>
    </div>
  );
}
