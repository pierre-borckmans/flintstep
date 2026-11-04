import { Plus, X } from "lucide-react";
import { comboName } from "../lib/caption";
import { fromHex, rgb, SWATCHES, sameColour, toHex } from "../lib/colour";
import type { Op } from "../lib/config";
import type { Colour, Config } from "../types";
import { SWITCH_NAMES } from "../types";
import { Button } from "../ui/Button";
import { cx } from "../ui/cx";
import { Seg } from "../ui/Seg";
import { Toggle } from "../ui/Toggle";
import { ActionEditor } from "./ActionEditor";
import { Section } from "./Section";

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

function ColourPicker({ colour, onChange }: { colour: Colour; onChange: (c: Colour) => void }) {
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

function SwitchSelect({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-7 rounded-ui-sm border border-edge bg-sunken px-2 font-semibold text-ui-sm text-bone outline-none"
    >
      {SWITCH_NAMES.map((n, i) => (
        <option key={n} value={i}>
          {n}
        </option>
      ))}
    </select>
  );
}

export function SwitchEditor({
  config,
  sw,
  onSelect,
  apply,
}: {
  config: Config;
  sw: number;
  onSelect: (n: number) => void;
  apply: (op: Op) => void;
}) {
  const s = config.switches[sw];
  const hasLong = s.long.kind !== "off";
  return (
    <div className="flex flex-col">
      <div className="px-4 pt-3 pb-1">
        <Seg
          label="Switch"
          options={SWITCH_NAMES.map((name, i) => ({ value: String(i), label: name }))}
          value={String(sw)}
          onChange={(v) => onSelect(Number(v))}
        />
      </div>

      <Section title={`Switch ${SWITCH_NAMES[sw]} · tap`}>
        <ActionEditor action={s.tap} onChange={(patch) => apply({ type: "tap", sw, patch })} />
      </Section>

      <Section
        title="Long press"
        aside={
          <>
            <span className="text-ui-xs text-faint">
              {hasLong ? `after ${config.longPressMs} ms` : "off"}
            </span>
            <Toggle
              label="Long press"
              on={hasLong}
              onChange={(on) =>
                apply({
                  type: "long",
                  sw,
                  patch: on
                    ? {
                        kind: "cc",
                        channel: s.tap.channel || 1,
                        number: Math.min(127, 90 + sw),
                        value: 127,
                        mode: "momentary",
                      }
                    : { kind: "off" },
                })
              }
            />
          </>
        }
      >
        {hasLong ? (
          <>
            <ActionEditor
              allowOff={false}
              action={s.long}
              onChange={(patch) => apply({ type: "long", sw, patch })}
            />
            <p className="text-ui-xs leading-snug text-faint">
              With a hold action, the tap fires on release instead of on press.
            </p>
          </>
        ) : (
          <p className="text-ui-xs text-faint">Holding the switch does the same as tapping it.</p>
        )}
      </Section>

      <Section title="LED colour">
        <ColourPicker
          colour={s.colour}
          onChange={(colour) => apply({ type: "colour", sw, colour })}
        />
      </Section>

      <Section
        title="Combos"
        aside={
          <Button
            size="sm"
            kind="plain"
            icon={<Plus size={12} />}
            onClick={() => apply({ type: "addCombo" })}
          >
            Add
          </Button>
        }
      >
        {config.combos.length === 0 ? (
          <p className="text-ui-xs leading-snug text-faint">
            Press two switches together to send a third message. Switches in a combo wait 60 ms
            before acting on their own.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {config.combos.map((k, i) => {
              const mine = k.a === sw || k.b === sw;
              return (
                <li
                  key={i}
                  className={cx(
                    "flex flex-col gap-2 rounded-ui-md border p-2.5 transition-colors duration-(--dur)",
                    mine ? "border-edge-strong bg-panel2" : "border-edge bg-panel",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <SwitchSelect
                      label="First switch"
                      value={k.a}
                      onChange={(a) => apply({ type: "combo", index: i, patch: { a } })}
                    />
                    <span className="text-ui-sm text-muted">+</span>
                    <SwitchSelect
                      label="Second switch"
                      value={k.b}
                      onChange={(b) => apply({ type: "combo", index: i, patch: { b } })}
                    />
                    <div className="flex-1" />
                    <Button
                      size="sm"
                      kind="ghost"
                      aria-label={`Remove combo ${comboName(k)}`}
                      title="Remove"
                      onClick={() => apply({ type: "removeCombo", index: i })}
                      icon={<X size={13} />}
                    />
                  </div>
                  <ActionEditor
                    action={k.action}
                    onChange={(action) => apply({ type: "combo", index: i, patch: {}, action })}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
