import { type ReactNode, useState } from "react";
import { errorText } from "../api";
import type { Apply } from "../lib/config";
import { expFraction, expValue, rawFraction } from "../lib/exp";
import { cableLabel } from "../lib/expsim";
import type { Config, ExpEdge, Status } from "../types";
import { Button } from "../ui/Button";
import { cx } from "../ui/cx";
import { Kicker } from "../ui/Kicker";
import { Lamp } from "../ui/Lamp";
import { NumField } from "../ui/NumField";
import { Toggle } from "../ui/Toggle";
import { type SimControls, SimRow, SimTag } from "./ExpSim";
import { ThresholdOverlay, ThresholdZone, TriggerBlock } from "./Trigger";

/** The live reading: a bar of the value the input sends (0..127), and under it the raw
 *  jack range with the heel and toe marks, so calibrating is something you can see. */
function Meter({
  raw,
  min,
  max,
  invert,
  trigger,
  zone,
}: {
  raw: number;
  min: number;
  max: number;
  invert: boolean;
  /** The trigger's threshold marker, over the bar, while one is on. */
  trigger?: ReactNode;
  /** The trigger's zones, inside the bar under the fill. */
  zone?: ReactNode;
}) {
  const v = expValue(raw, { min, max, invert });
  const f = expFraction(raw, { min, max, invert }) ?? 0;
  const has = v !== null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className={cx("flex items-end gap-3", !!trigger && "pt-2.5")}>
        <span
          className={cx(
            "w-10 font-mono text-[22px] leading-none font-medium tabular-nums",
            has ? "text-bone" : "text-faint",
          )}
        >
          {has ? v : "--"}
        </span>
        <div className="relative mb-[3px] flex-1">
          <div className="relative h-2.5 overflow-hidden rounded-[3px] bg-sunken inset-shadow-deep">
            {zone}
            <div
              className="absolute inset-y-0 left-0 rounded-[3px]"
              style={{
                width: `${f * 100}%`,
                opacity: has ? 1 : 0,
                background:
                  "linear-gradient(90deg, color-mix(in srgb, var(--color-cold) 35%, transparent), var(--color-cold))",
                boxShadow: "0 0 10px color-mix(in srgb, var(--color-cold) 35%, transparent)",
                transition: "width var(--dur-led) var(--ease-led)",
              }}
            />
            {/* 7-bit ticks */}
            {[0.25, 0.5, 0.75].map((t) => (
              <span
                key={t}
                className="absolute inset-y-0 w-px bg-black/50"
                style={{ left: `${t * 100}%` }}
              />
            ))}
          </div>
          {trigger}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Kicker className="w-10 !text-faint">raw</Kicker>
        <div className="relative h-3 flex-1">
          <div className="absolute top-1/2 h-px w-full -translate-y-1/2 bg-edge-strong" />
          {/* min is the heel and max the toe, whichever reads higher: a pedal whose toe
              reads lower has its toe mark left of its heel mark. */}
          <div
            className="absolute top-1/2 h-[3px] -translate-y-1/2 bg-muted/50"
            style={{
              left: `${Math.min(rawFraction(min), rawFraction(max)) * 100}%`,
              width: `${Math.abs(rawFraction(max) - rawFraction(min)) * 100}%`,
            }}
          />
          {(
            [
              ["heel", min],
              ["toe", max],
            ] as const
          ).map(([edge, m]) => (
            <span
              key={edge}
              title={`${edge} ${m}`}
              className="absolute top-0 h-3 w-px bg-muted"
              style={{ left: `${rawFraction(m) * 100}%` }}
            >
              <span className="absolute -top-2.5 -translate-x-1/2 font-mono text-[8px] leading-none text-faint uppercase">
                {edge[0]}
              </span>
            </span>
          ))}
          {raw >= 0 && (
            <span
              className="absolute top-1/2 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cold"
              style={{
                left: `${rawFraction(raw) * 100}%`,
                boxShadow: "var(--glow-cold)",
                transition: "left var(--dur-led) var(--ease-led)",
              }}
            />
          )}
        </div>
      </div>
      <div className="flex justify-between pl-[52px] font-mono text-ui-2xs text-faint tabular-nums">
        <span>heel {min}</span>
        <span className={raw >= 0 ? "text-muted" : ""}>{raw >= 0 ? raw : "no reading"}</span>
        <span>toe {max}</span>
      </div>
    </div>
  );
}

function ExpCard({
  n,
  config,
  status,
  engaged,
  apply,
  calibrate,
  sim,
}: {
  n: number;
  config: Config;
  status: Status | null;
  engaged: boolean;
  apply: Apply;
  calibrate: (n: number, edge: ExpEdge) => Promise<void>;
  sim?: SimControls;
}) {
  const x = config.exp[n];
  const trigOn = x.trigger.mode !== "off";
  // A simulated jack reads as having a cable (Go reports one), connected or not.
  const simulated = !!sim?.on[n];
  const realCable = !simulated && !!status?.cables?.[n] && status?.state === "connected";
  const cable = realCable || simulated;
  const raw = status?.expRaw?.[n] ?? -1;
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<ExpEdge | null>(null);
  const set = (edge: ExpEdge) =>
    calibrate(n, edge)
      .then(() => {
        setErr(null);
        setFlash(edge);
        setTimeout(() => setFlash(null), 900);
      })
      .catch((e) => setErr(errorText(e)));

  return (
    <div className="flex flex-col gap-3 rounded-ui-lg border border-edge bg-panel2/60 p-3 rim">
      <div className="flex items-center gap-2">
        <span className="text-ui-base font-semibold text-bone engraved">EXP {n + 1}</span>
        {simulated && <SimTag />}
        <Lamp on={cable} colour="live" size={6} />
        <span className={cx("text-ui-xs", cable ? "text-muted" : "text-faint")}>
          {cableLabel(cable, simulated)}
        </span>
        <div className="flex-1" />
        <span className="text-ui-xs text-muted">{x.enabled ? "On" : "Off"}</span>
        <Toggle
          label={`EXP ${n + 1} enabled`}
          on={x.enabled}
          onChange={(enabled) => apply({ type: "exp", n, patch: { enabled } })}
        />
      </div>

      <div
        className="transition-[filter] duration-(--dur-down) ease-(--ease-incand)"
        style={{ filter: cable && x.enabled ? "none" : "var(--off-dim)" }}
      >
        <Meter
          raw={cable ? raw : -1}
          min={x.min}
          max={x.max}
          invert={x.invert}
          zone={
            trigOn && <ThresholdZone trigger={x.trigger} engaged={cable && x.enabled && engaged} />
          }
          trigger={
            trigOn && (
              <ThresholdOverlay
                trigger={x.trigger}
                label={`EXP ${n + 1} trigger threshold`}
                onChange={(threshold) => apply({ type: "trigger", n, patch: { threshold } })}
              />
            )
          }
        />
      </div>

      <div className={cx("grid grid-cols-2 gap-2", !x.enabled && "opacity-50")}>
        <NumField
          label="Ch"
          value={x.channel}
          min={1}
          max={16}
          onChange={(channel, g) => apply({ type: "exp", n, patch: { channel } }, g)}
        />
        <NumField
          label="CC"
          value={x.cc}
          min={0}
          max={127}
          onChange={(cc, g) => apply({ type: "exp", n, patch: { cc } }, g)}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          kind={flash === "min" ? "primary" : "plain"}
          disabled={!cable}
          onClick={() => set("min")}
          title="Rock the pedal fully back, then click"
        >
          Set heel
        </Button>
        <Button
          size="sm"
          kind={flash === "max" ? "primary" : "plain"}
          disabled={!cable}
          onClick={() => set("max")}
          title="Push the pedal fully forward, then click"
        >
          Set toe
        </Button>
        <div className="flex-1" />
        <span className="text-ui-xs text-muted">Invert</span>
        <Toggle
          label={`Invert EXP ${n + 1}`}
          on={x.invert}
          onChange={(invert) => apply({ type: "exp", n, patch: { invert } })}
        />
      </div>
      {err && <p className="text-ui-xs text-hot">{err}</p>}
      {!cable && (
        <p className="text-ui-xs text-faint">
          Plug an expression pedal into EXP {n + 1} to see it and calibrate it
          {sim ? ", or simulate one." : "."}
        </p>
      )}
      {sim && <SimRow n={n} sim={sim} realCable={realCable} raw={raw} />}
      <TriggerBlock n={n} x={x} engaged={engaged} cable={cable} apply={apply} />
    </div>
  );
}

export function ExpressionPanel({
  engaged,
  ...props
}: {
  config: Config;
  status: Status | null;
  /** Each input's trigger engaged now (State.expTrigger). */
  engaged: boolean[];
  apply: Apply;
  calibrate: (n: number, edge: ExpEdge) => Promise<void>;
  /** The simulated pedals; without it the cards have no "Simulate pedal" row. */
  sim?: SimControls;
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <ExpCard n={0} engaged={!!engaged[0]} {...props} />
      <ExpCard n={1} engaged={!!engaged[1]} {...props} />
      <p className="px-1 text-ui-xs leading-snug text-faint">
        <Kicker className="mr-1">Tip</Kicker>
        Set heel and toe with the pedal resting where you want each end. The value only moves when
        the pedal is clearly past a step, so a resting pedal does not flicker.
      </p>
    </div>
  );
}
