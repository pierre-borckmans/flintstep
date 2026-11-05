import { Plus, X } from "lucide-react";
import { useState } from "react";
import { comboName } from "../lib/caption";
import type { Apply } from "../lib/config";
import type { Config } from "../types";
import { SWITCH_NAMES } from "../types";
import { Button } from "../ui/Button";
import { Collapse } from "../ui/Collapse";
import { ColourPicker } from "../ui/ColourPicker";
import { cx } from "../ui/cx";
import { Seg } from "../ui/Seg";
import { Toggle } from "../ui/Toggle";
import { useListKeys, useMounted } from "../ui/useListKeys";
import { ActionEditor } from "./ActionEditor";
import { Section } from "./Section";

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
      title={label}
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

/** The I II A III IV B row above the editor. sw null (an indicator lamp is being
 *  edited) shows none of them chosen. */
export function SwitchTabs({ sw, onSelect }: { sw: number | null; onSelect: (n: number) => void }) {
  return (
    <div className="switch-selector px-5 pt-4 pb-4">
      <Seg
        label="Switch"
        options={SWITCH_NAMES.map((name, i) => ({ value: String(i), label: name }))}
        value={sw === null ? "" : String(sw)}
        onChange={(v) => onSelect(Number(v))}
      />
    </div>
  );
}

export function SwitchEditor({ config, sw, apply }: { config: Config; sw: number; apply: Apply }) {
  const s = config.switches[sw];
  const hasLong = s.long.kind !== "off";
  const combos = useListKeys(config.combos.length);
  // A combo being removed closes first; the op runs when it has.
  const [removing, setRemoving] = useState<number | null>(null);
  const mounted = useMounted();
  // A fragment: the parent puts SwitchTabs above, and the first section keeps its rule.
  return (
    <>
      <Section title={`Switch ${SWITCH_NAMES[sw]} · tap`}>
        <ActionEditor
          action={s.tap}
          onChange={(patch, g) => apply({ type: "tap", sw, patch }, g)}
        />
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
              title={
                hasLong
                  ? "Turn off: holding does the same as tapping"
                  : `Give this switch a second message when held for ${config.longPressMs} ms`
              }
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
        <Collapse open={hasLong} className="flex flex-col gap-3">
          <ActionEditor
            allowOff={false}
            action={s.long}
            onChange={(patch, g) => apply({ type: "long", sw, patch }, g)}
          />
          <p className="text-ui-xs leading-snug text-faint">
            With a hold action, the tap fires on release instead of on press.
          </p>
        </Collapse>
        <Collapse open={!hasLong}>
          <p className="text-ui-xs text-faint">Holding the switch does the same as tapping it.</p>
        </Collapse>
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
            title="Add a combo: two switches pressed together send a third message"
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
          <div role="list" className="flex flex-col gap-2">
            {config.combos.map((k, i) => {
              const mine = k.a === sw || k.b === sw;
              const key = combos.keys[i];
              return (
                <Collapse
                  key={key}
                  open={removing !== key}
                  appear={mounted.current}
                  onClosed={() => {
                    combos.remove(i);
                    setRemoving(null);
                    apply({ type: "removeCombo", index: i });
                  }}
                >
                  <div
                    role="listitem"
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
                        title={`Remove combo ${comboName(k)}`}
                        onClick={() => setRemoving(key)}
                        icon={<X size={13} />}
                      />
                    </div>
                    <ActionEditor
                      action={k.action}
                      onChange={(action, g) =>
                        apply({ type: "combo", index: i, patch: {}, action }, g)
                      }
                    />
                  </div>
                </Collapse>
              );
            })}
          </div>
        )}
      </Section>
    </>
  );
}
