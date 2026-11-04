import type { Apply } from "../lib/config";
import { INDICATOR_MODES, STOCK_USE } from "../lib/indicators";
import type { Config, IndicatorIndex } from "../types";
import { INDICATOR_NAMES } from "../types";
import { ColourPicker } from "../ui/ColourPicker";
import { cx } from "../ui/cx";
import { Section } from "./Section";

/** The Amp or App lamp: what lights it and in which colour. Shown in the Switches tab
 *  when its dot on the drawn pedal is clicked. A fragment, like SwitchEditor. */
export function IndicatorEditor({
  config,
  n,
  apply,
}: {
  config: Config;
  n: IndicatorIndex;
  apply: Apply;
}) {
  const ind = config.indicators[n];
  const name = INDICATOR_NAMES[n];
  return (
    <>
      <Section title={`${name} lamp`}>
        <div role="radiogroup" aria-label={`${name} lamp lights`} className="flex flex-col gap-0.5">
          {INDICATOR_MODES.map((m) => {
            const on = m.value === ind.mode;
            return (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => apply({ type: "indicator", n, patch: { mode: m.value } })}
                className={cx(
                  "flex flex-col items-start rounded-ui-sm px-2.5 py-1.5 text-left transition-[color,background-color,box-shadow] duration-(--dur) ease-(--ease)",
                  on ? "lit bg-panel3" : "hover:warm",
                )}
              >
                <span
                  className={cx(
                    "text-ui-sm font-semibold",
                    on ? "text-bone" : "text-muted hover:text-text",
                  )}
                >
                  {m.label}
                </span>
                <span className="text-ui-xs leading-snug text-faint">{m.hint}</span>
              </button>
            );
          })}
        </div>
        <p className="text-ui-xs leading-snug text-faint">
          {STOCK_USE[n]} Here it shows what you pick, dimmed with the other lamps.
        </p>
      </Section>

      <Section title="LED colour">
        <ColourPicker
          colour={ind.colour}
          onChange={(colour) => apply({ type: "indicator", n, patch: { colour } })}
        />
      </Section>
    </>
  );
}
