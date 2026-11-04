import { useRef, useState } from "react";
import type { Op } from "../lib/config";
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
import { cx } from "../ui/cx";
import { Kicker } from "../ui/Kicker";
import { Lamp } from "../ui/Lamp";
import { NumField } from "../ui/NumField";
import { ActionEditor } from "./ActionEditor";

// THE EXPRESSION TRIGGER: a toe switch faked from the pedal's position. Two parts: the
// threshold drawn on the live travel bar (ThresholdOverlay, draggable), and the block
// under the input's settings that picks the mode and what it sends (TriggerBlock).

const pct = (v: number) => `${v}%`;

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
          background: engaged ? "rgb(255 180 84 / 0.2)" : "rgb(201 228 242 / 0.1)",
          boxShadow: engaged
            ? "inset 0 1px 0 rgb(255 200 130 / 0.55), inset 0 0 8px rgb(255 180 84 / 0.35)"
            : "inset 0 1px 0 rgb(201 228 242 / 0.12)",
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
            background:
              "repeating-linear-gradient(135deg, rgb(201 228 242 / 0.28) 0 1px, transparent 1px 3px)",
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
        style={{ left: pct(th), boxShadow: "0 0 6px rgb(201 228 242 / 0.6)" }}
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
        title="Drag, or use the arrow keys (shift for 5%)"
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

const MODES: { value: TriggerMode; label: string; hint: string }[] = [
  { value: "off", label: "Off", hint: "CC only" },
  { value: "engage", label: "Auto-engage", hint: "leave the heel" },
  { value: "toe", label: "Toe click", hint: "push the toe" },
];

/** Off · Auto-engage · Toe click, each with a few words under it. Like Seg: the chosen
 *  one is lit, never tinted. */
function ModePicker({
  value,
  onChange,
  label,
}: {
  value: TriggerMode;
  onChange: (m: TriggerMode) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex rounded-ui-md border border-edge bg-sunken p-0.5 shadow-[inset_0_1px_2px_rgb(0_0_0/0.5)]"
    >
      {MODES.map((m) => {
        const on = m.value === value;
        return (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(m.value)}
            className={cx(
              "flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-ui-sm px-1.5 py-1.5 transition-[color,background-color,box-shadow] duration-(--dur) ease-(--ease)",
              on ? "lit bg-panel3" : "hover:warm",
            )}
          >
            <span
              className={cx(
                "truncate text-ui-sm leading-none font-semibold",
                on ? "text-bone" : "text-muted",
              )}
            >
              {m.label}
            </span>
            <span
              className={cx("truncate text-ui-2xs leading-none", on ? "text-muted" : "text-faint")}
            >
              {m.hint}
            </span>
          </button>
        );
      })}
    </div>
  );
}

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
  apply: (op: Op) => void;
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
            <Lamp on={lit} colour="beam" size={8} title={lit ? "Engaged" : "Not engaged"} />
          </>
        )}
      </div>

      <ModePicker
        label={`EXP ${n + 1} trigger`}
        value={t.mode}
        onChange={(mode) => apply({ type: "triggerMode", n, mode })}
      />
      <p className="text-ui-xs leading-snug text-faint">{explainTrigger(t)}</p>

      {on && (
        <>
          <div className="flex items-center gap-2">
            <NumField
              label={t.mode === "toe" ? "Click at" : "Engage at"}
              value={t.threshold}
              min={TRIGGER.min}
              max={TRIGGER.max}
              suffix="%"
              className="w-[118px] shrink-0"
              onChange={(threshold) => apply({ type: "trigger", n, patch: { threshold } })}
            />
            <span className="text-ui-xs leading-snug text-faint">
              or drag the marker on the bar
            </span>
          </div>

          {t.mode === "engage" && (
            <div className="flex flex-col gap-1">
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
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Kicker className="!text-faint">Sends</Kicker>
            <ActionEditor
              action={t.action}
              allowOff={false}
              describe={explainTriggerAction}
              onChange={(action) => apply({ type: "trigger", n, patch: {}, action })}
            />
          </div>
        </>
      )}
    </div>
  );
}
