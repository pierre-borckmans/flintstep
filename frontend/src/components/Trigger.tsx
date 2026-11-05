import { useRef, useState } from "react";
import type { Apply } from "../lib/config";
import {
  explainTrigger,
  explainTriggerAction,
  nudge,
  offDelayText,
  releaseAt,
  TRIGGER,
  thresholdAt,
} from "../lib/trigger";
import type { ExpConfig, ExpTrigger, TriggerMode } from "../types";
import { Collapse } from "../ui/Collapse";
import { cx } from "../ui/cx";
import { Kicker } from "../ui/Kicker";
import { Lamp } from "../ui/Lamp";
import { NumField } from "../ui/NumField";
import { Seg } from "../ui/Seg";
import { ActionEditor } from "./ActionEditor";

// THE EXPRESSION TRIGGER: a toe switch faked from the pedal's position. Two parts: the
// threshold drawn on the live travel bar (ThresholdOverlay, draggable), and the block
// under the input's settings that picks the mode and what it sends (TriggerBlock).

const pct = (v: number) => `${v}%`;
/** The data light at a given strength, in percent. */
const COLD = (pct: number) => `color-mix(in srgb, var(--color-cold) ${pct}%, transparent)`;

/** Inside the travel bar, under its fill: the zone that counts as engaged, tinted and
 *  lit while the trigger is engaged, and the hysteresis band below the threshold
 *  (hatched), where a held trigger has not let go yet. */
export function ThresholdZone({ trigger, engaged }: { trigger: ExpTrigger; engaged: boolean }) {
  const th = trigger.threshold;
  const rel = releaseAt(th);
  return (
    <>
      <div
        className="pointer-events-none absolute inset-y-0 right-0"
        style={{
          left: pct(th),
          background: engaged ? "color-mix(in srgb, var(--lamp-halo) 20%, transparent)" : COLD(10),
          boxShadow: engaged
            ? "inset 0 1px 0 color-mix(in srgb, var(--lamp-halo) 55%, transparent), inset 0 0 8px color-mix(in srgb, var(--lamp-halo) 35%, transparent)"
            : `inset 0 1px 0 ${COLD(12)}`,
          transition:
            "background var(--dur-led) var(--ease-led), box-shadow var(--dur-led) var(--ease-led)",
        }}
      />
      {rel < th && (
        <div
          className="pointer-events-none absolute inset-y-0"
          style={{
            left: pct(rel),
            width: pct(th - rel),
            background: `repeating-linear-gradient(135deg, ${COLD(28)} 0 1px, transparent 1px 3px)`,
          }}
        />
      )}
    </>
  );
}

/** The threshold marker, laid over the bar's wrapper: its tab above the bar drags, or
 *  takes the arrow keys (shift for 5 %). Pressing anywhere on the bar moves the marker
 *  there. */
export function ThresholdOverlay({
  trigger,
  onChange,
  label,
}: {
  trigger: ExpTrigger;
  onChange: (threshold: number) => void;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const tab = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const th = trigger.threshold;
  const at = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    return r ? thresholdAt(clientX - r.left, r.width) : th;
  };
  const set = (v: number) => v !== th && onChange(v);

  return (
    <div
      ref={box}
      className={cx(
        "absolute inset-x-0 -top-[18px] bottom-0 touch-none",
        drag ? "cursor-ew-resize" : "cursor-pointer",
      )}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(true);
        tab.current?.focus({ preventScroll: true });
        set(at(e.clientX));
      }}
      onPointerMove={(e) => drag && set(at(e.clientX))}
      onPointerUp={() => setDrag(false)}
      onPointerCancel={() => setDrag(false)}
    >
      {/* the marker line, from the tab down through the bar */}
      <div
        className="pointer-events-none absolute top-[13px] -bottom-[3px] w-[2px] -translate-x-1/2 rounded-full bg-cold"
        style={{ left: pct(th), boxShadow: `0 0 6px ${COLD(60)}` }}
      />
      <div
        ref={tab}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={TRIGGER.min}
        aria-valuemax={TRIGGER.max}
        aria-valuenow={th}
        aria-valuetext={`${th} percent`}
        title={`Trigger threshold, ${th}%\nDrag, or use the arrow keys (Shift for 5%)`}
        onKeyDown={(e) => {
          const v = nudge(th, e.key, e.shiftKey);
          if (v === null) return;
          e.preventDefault();
          set(v);
        }}
        className={cx(
          "absolute top-0 flex h-[13px] -translate-x-1/2 cursor-ew-resize items-center rounded-[3px] px-1 font-mono text-[9px] leading-none font-semibold tabular-nums outline-none",
          "transition-[background-color,color,box-shadow] duration-(--dur-fast) ease-(--ease)",
          drag
            ? "bg-cold text-ink shadow-[var(--glow-cold)]"
            : "border border-cold/45 bg-panel3 text-cold hover:border-cold/80 focus-visible:bg-cold focus-visible:text-ink",
        )}
        style={{ left: pct(th) }}
      >
        {th}%
      </div>
    </div>
  );
}

const MODES: { value: TriggerMode; label: string; hint: string; title: string }[] = [
  { value: "off", label: "Off", hint: "CC only", title: "No trigger: the pedal only sends its CC" },
  {
    value: "engage",
    label: "Auto-engage",
    hint: "leave the heel",
    title: "On when you rock off the heel, off when you rest it back, like an auto-wah",
  },
  {
    value: "toe",
    label: "Toe click",
    hint: "push the toe",
    title: "Clicks when you push past the threshold, like the switch under a wah's toe",
  },
];

/** The trigger's settings, under the input's own: mode, threshold, off delay, and
 *  what it sends. */
export function TriggerBlock({
  n,
  x,
  engaged,
  cable,
  apply,
}: {
  n: number;
  x: ExpConfig;
  engaged: boolean;
  cable: boolean;
  apply: Apply;
}) {
  const t = x.trigger;
  const on = t.mode !== "off";
  const lit = on && cable && x.enabled && engaged;
  const state = !on
    ? ""
    : !x.enabled
      ? "input off"
      : !cable
        ? "no cable"
        : engaged
          ? "engaged"
          : t.mode === "engage"
            ? "at rest"
            : "waiting";
  const fill = (t.offDelayMs / TRIGGER.offDelay.max) * 100;

  return (
    <div
      className={cx("flex flex-col gap-2.5 border-t border-edge pt-3", !x.enabled && "opacity-50")}
    >
      <div className="flex min-h-4 items-center gap-2">
        <Kicker>Trigger</Kicker>
        <div className="flex-1" />
        {on && (
          <>
            <span
              className={cx(
                "font-mono text-ui-2xs uppercase tracking-kicker",
                lit ? "text-bone" : "text-faint",
              )}
            >
              {state}
            </span>
            <Lamp
              on={lit}
              colour="beam"
              size={8}
              title={lit ? "Trigger engaged" : "Trigger not engaged"}
            />
          </>
        )}
      </div>

      <Seg
        label={`EXP ${n + 1} trigger`}
        options={MODES}
        value={t.mode}
        onChange={(mode) => apply({ type: "triggerMode", n, mode })}
      />
      <p className="text-ui-xs leading-snug text-faint">{explainTrigger(t)}</p>

      <Collapse open={on} className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <NumField
            label={t.mode === "toe" ? "Click at" : "Engage at"}
            hint={
              t.mode === "toe"
                ? "Where it clicks, as a percent of the value sent (after the response curve)"
                : "Where it switches on, as a percent of the value sent (after the response curve)"
            }
            value={t.threshold}
            min={TRIGGER.min}
            max={TRIGGER.max}
            suffix="%"
            className="w-[118px] shrink-0"
            onChange={(threshold, g) => apply({ type: "trigger", n, patch: { threshold } }, g)}
          />
          <span className="text-ui-xs leading-snug text-faint">or drag the marker on the bar</span>
        </div>

        <Collapse open={t.mode === "engage"} className="flex flex-col gap-1">
          <span className="text-ui-xs text-muted">{offDelayText(t.offDelayMs)}</span>
          <div className="flex items-center gap-3">
            <input
              type="range"
              aria-label={`EXP ${n + 1} off delay`}
              min={TRIGGER.offDelay.min}
              max={TRIGGER.offDelay.max}
              step={TRIGGER.offDelay.step}
              value={t.offDelayMs}
              onChange={(e) =>
                apply({ type: "trigger", n, patch: { offDelayMs: Number(e.target.value) } })
              }
              className="min-w-0 flex-1"
              style={{ "--fill": `${fill}%` } as React.CSSProperties}
            />
            <span className="w-14 text-right font-mono text-ui-sm text-bone tabular-nums">
              {t.offDelayMs}
              <span className="text-muted"> ms</span>
            </span>
          </div>
        </Collapse>

        <div className="flex flex-col gap-2">
          <Kicker className="!text-faint">Sends</Kicker>
          <ActionEditor
            action={t.action}
            allowOff={false}
            describe={explainTriggerAction}
            onChange={(action, g) => apply({ type: "trigger", n, patch: {}, action }, g)}
          />
        </div>
      </Collapse>
    </div>
  );
}
