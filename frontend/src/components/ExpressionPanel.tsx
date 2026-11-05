import { ChevronRight, Eye, EyeOff, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { errorText } from "../api";
import type { Apply } from "../lib/config";
import { CURVE_LABEL, CURVE_TIP, formatAmount, type TaperHint, taperText } from "../lib/curve";
import { expFraction, expOutput, expValue, LINEAR, rawFraction } from "../lib/exp";
import { cableLabel } from "../lib/expsim";
import { calibrationHint, sweepProgress, sweepPrompt } from "../lib/sweep";
import { STORAGE_PREFIX } from "../product";
import type { Capture, Config, ExpConfig, ExpCurve, ExpEdge, Status } from "../types";
import { Button } from "../ui/Button";
import { Collapse } from "../ui/Collapse";
import { cx } from "../ui/cx";
import { Kicker } from "../ui/Kicker";
import { Lamp } from "../ui/Lamp";
import { NumField } from "../ui/NumField";
import { Toggle } from "../ui/Toggle";
import type { ExpLive } from "../useExpLive";
import { useStoredFlags } from "../useStoredFlags";
import { type SimControls, SimRow, SimTag } from "./ExpSim";
import { RawTrace } from "./RawTrace";
import { ResponseRow } from "./Response";
import { ThresholdOverlay, ThresholdZone, TriggerBlock } from "./Trigger";

/** The live reading: a bar of the value the input sends (0..127), and under it the raw
 *  jack range with the heel and toe marks, so calibrating is something you can see. */
function Meter({
  raw,
  min,
  max,
  invert,
  curve,
  trigger,
  zone,
}: {
  raw: number;
  min: number;
  max: number;
  invert: boolean;
  curve: ExpCurve;
  /** The trigger's threshold marker, over the bar, while one is on. */
  trigger?: ReactNode;
  /** The trigger's zones, inside the bar under the fill. */
  zone?: ReactNode;
}) {
  // The bar is the value going out (after the curve): the threshold marker reads on it.
  const v = expValue(raw, { min, max, invert, curve });
  const f = expOutput(raw, { min, max, invert, curve }) ?? 0;
  const has = v !== null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className={cx("flex items-end gap-3", !!trigger && "pt-2.5")}>
        <span
          title={has ? "The value going out now, 0–127" : "No reading: no pedal on this jack"}
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
        <div
          className="relative h-3 flex-1"
          title={"Raw reading from the jack\nH and T mark where heel and toe were set"}
        >
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
              title={`${edge === "heel" ? "Heel" : "Toe"} calibrated at raw ${m}`}
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

const thousands = (v: number) => (v < 0 ? "--" : v.toLocaleString("en-US").replace(/,/g, " "));

/** A sweep running: what to do, the extremes so far on the jack's range, how far along
 *  it looks, and Done / Cancel (it ends on its own once the pedal rests). */
function SweepCapture({
  n,
  c,
  onDone,
  onCancel,
}: {
  n: number;
  c: Capture;
  onDone: () => void;
  onCancel: () => void;
}) {
  // The rest phase moves with no new values: tick while it runs.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);
  const p = sweepProgress(c, now);
  const has = c.low >= 0;
  return (
    <section
      aria-label={`EXP ${n + 1} calibration sweep`}
      aria-live="polite"
      className="flex flex-col gap-2 rounded-ui-sm border border-cold/40 bg-sunken/60 p-2.5"
    >
      <p className="text-ui-sm font-medium text-bone">{sweepPrompt(c)}</p>
      <div
        className="relative h-2 rounded-[3px] bg-sunken inset-shadow-deep"
        title="Range swept so far, on the jack's 0–65535"
      >
        {has && (
          <div
            className="absolute inset-y-0 rounded-[3px] bg-cold/70"
            style={{
              left: `${rawFraction(c.low) * 100}%`,
              width: `${Math.max(0.5, (rawFraction(c.high) - rawFraction(c.low)) * 100)}%`,
            }}
          />
        )}
      </div>
      <div className="flex justify-between font-mono text-ui-2xs text-muted tabular-nums">
        <span>low {thousands(c.low)}</span>
        <span>span {has ? thousands(c.high - c.low) : "--"}</span>
        <span>high {thousands(c.high)}</span>
      </div>
      <div className="flex items-center gap-2">
        <div
          className="h-1 flex-1 overflow-hidden rounded-full bg-edge"
          role="progressbar"
          aria-label="Sweep progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(p * 100)}
        >
          <div
            className="h-full rounded-full bg-live"
            style={{ width: `${p * 100}%`, transition: "width 120ms linear" }}
          />
        </div>
        <Button
          size="sm"
          kind={c.ready ? "primary" : "plain"}
          onClick={onDone}
          title="Finish now with what was swept"
        >
          Done
        </Button>
        <Button
          size="sm"
          kind="ghost"
          onClick={onCancel}
          title="Stop without changing the calibration"
        >
          Cancel
        </Button>
      </div>
    </section>
  );
}

/** The quiet line under Calibrate: a calibration that looks wrong, or a curve the last
 *  sweep suggests (with a button that applies it). */
function Attention({
  hint,
  taper,
  onTaper,
  onDismiss,
}: {
  hint: string | null;
  taper: TaperHint | null;
  onTaper: () => void;
  onDismiss: () => void;
}) {
  if (hint) {
    return (
      <p className="text-ui-xs text-warn" role="status">
        {hint}
      </p>
    );
  }
  if (!taper) return null;
  return (
    <div className="flex items-center gap-2" role="status">
      <p className="min-w-0 flex-1 text-ui-xs leading-snug text-muted">{taperText(taper)}</p>
      <Button
        size="sm"
        kind="plain"
        onClick={onTaper}
        title={`${CURVE_TIP[taper.curve]}\nChange it any time under Tuning`}
      >
        Apply
      </Button>
      <Button size="sm" kind="ghost" onClick={onDismiss} title="Keep Linear" aria-label="Dismiss">
        <X size={12} aria-hidden />
      </Button>
    </div>
  );
}

/** "Gentle start · inverted": what Tuning holds that differs from the defaults, so a
 *  closed disclosure still says what it changed. */
function tuningSummary(x: ExpConfig): string {
  const parts: string[] = [];
  const c = x.curve ?? LINEAR;
  if (c.kind !== "linear") {
    parts.push(c.kind === "custom" ? `custom ${formatAmount(c.amount)}` : CURVE_LABEL[c.kind]);
  }
  if (x.invert) parts.push("inverted");
  return parts.join(" · ");
}

/** Per-input view flags kept across launches: Tuning open, the trace shown. */
export interface CardView {
  tuning: boolean;
  setTuning: (on: boolean) => void;
  trace: boolean;
  setTrace: (on: boolean) => void;
}

function ExpCard({
  n,
  config,
  status,
  engaged,
  apply,
  calibrate,
  focused = false,
  sim,
  live,
  view,
}: {
  n: number;
  /** Selected on the canvas: lit, and scrolled into view. */
  focused?: boolean;
  config: Config;
  status: Status | null;
  engaged: boolean;
  apply: Apply;
  calibrate: (n: number, edge: ExpEdge) => Promise<void>;
  sim?: SimControls;
  /** Traces, sweeps and learning (useExpLive); without it the card has none of them. */
  live?: ExpLive;
  view: CardView;
}) {
  const x = config.exp[n];
  const curve = x.curve ?? LINEAR;
  const trigOn = x.trigger.mode !== "off";
  // A simulated jack reads as having a cable (Go reports one), connected or not.
  const simulated = !!sim?.on[n];
  const realCable = !simulated && !!status?.cables?.[n] && status?.state === "connected";
  const cable = realCable || simulated;
  const raw = status?.expRaw?.[n] ?? -1;
  const travel = cable && raw >= 0 ? expFraction(raw, x) : null;
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<ExpEdge | null>(null);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focused) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    card.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [focused]);
  const set = (edge: ExpEdge) =>
    calibrate(n, edge)
      .then(() => {
        setErr(null);
        setFlash(edge);
        setTimeout(() => setFlash(null), 900);
      })
      .catch((e) => setErr(errorText(e)));
  // The raw stream runs while a pedal is in, trace shown or not: the calibration hint
  // and the sweep's curve suggestion read what it brings.
  const watch = live?.watch;
  useEffect(() => (watch && cable ? watch() : undefined), [watch, cable]);
  const capture = live?.captures[n];
  const sweeping = !!capture?.on;
  const sweepErr = live?.errors[n] ?? null;
  const hint = live && cable && !sweeping ? calibrationHint(x, live.seen[n]) : null;
  // A suggestion only while the curve is still the default: never second-guess a choice.
  const taper = live && !sweeping && curve.kind === "linear" ? live.tapers[n] : null;
  const attention = !!hint || !!taper;
  const summary = tuningSummary(x);
  const off = !x.enabled;

  return (
    <div
      ref={card}
      data-focused={focused || undefined}
      className={cx(
        "flex scroll-m-4 flex-col gap-3 rounded-ui-lg border bg-panel2/60 p-3 rim",
        "transition-[border-color,box-shadow] duration-(--dur-up) ease-(--ease-incand)",
        focused
          ? "border-cold/60 shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-cold)_25%,transparent),0_0_14px_-4px_color-mix(in_srgb,var(--color-cold)_40%,transparent)]"
          : "border-edge",
      )}
    >
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
          title={x.enabled ? "Stop this input sending MIDI" : "Let this input send MIDI"}
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
          curve={curve}
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

      <div className={cx("grid grid-cols-2 gap-2", off && "opacity-50")}>
        <NumField
          label="Ch"
          hint="MIDI channel"
          value={x.channel}
          min={1}
          max={16}
          onChange={(channel, g) => apply({ type: "exp", n, patch: { channel } }, g)}
        />
        <NumField
          label="CC"
          hint="Controller number the pedal's position goes out on"
          value={x.cc}
          min={0}
          max={127}
          onChange={(cc, g) => apply({ type: "exp", n, patch: { cc } }, g)}
        />
      </div>

      {live && sweeping && capture ? (
        <SweepCapture
          n={n}
          c={capture}
          onDone={() => void live.sweep.finish(n)}
          onCancel={() => void live.sweep.cancel(n)}
        />
      ) : (
        live && (
          <Button
            kind="primary"
            disabled={!cable}
            className="self-start"
            onClick={() => {
              setErr(null);
              void live.sweep.start(n);
            }}
            title={
              cable
                ? "Rock the pedal all the way back and forth: heel and toe are set from the ends it reaches"
                : "Plug in or simulate a pedal first"
            }
          >
            Calibrate
          </Button>
        )
      )}
      {sweepErr && <p className="text-ui-xs text-hot">{sweepErr}</p>}
      {!sweepErr && live && (
        <Attention
          hint={hint}
          taper={taper}
          onTaper={() =>
            taper && apply({ type: "exp", n, patch: { curve: { ...curve, kind: taper.curve } } })
          }
          onDismiss={() => live.dismissTaper(n)}
        />
      )}
      {err && <p className="text-ui-xs text-hot">{err}</p>}
      {!cable && (
        <p className="text-ui-xs text-faint">
          Plug an expression pedal into EXP {n + 1} to see it and calibrate it
          {sim ? ", or simulate one." : "."}
        </p>
      )}
      {sim && <SimRow n={n} sim={sim} realCable={realCable} raw={raw} />}

      <div className="flex flex-col gap-3 border-t border-edge pt-2">
        <button
          type="button"
          aria-expanded={view.tuning}
          aria-controls={`exp-tuning-${n}`}
          onClick={() => view.setTuning(!view.tuning)}
          title={
            view.tuning
              ? "Hide the response curve, heel and toe, invert and the live input"
              : "Response curve, heel and toe, invert, learning the range, and the live input"
          }
          className="group -mx-1 flex items-center gap-1.5 rounded-ui-sm px-1 py-0.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-cold/70"
        >
          <ChevronRight
            size={12}
            aria-hidden
            className={cx(
              "text-faint transition-transform duration-(--dur) ease-(--ease) group-hover:text-muted",
              view.tuning && "rotate-90",
            )}
          />
          <Kicker className="group-hover:!text-text">Tuning</Kicker>
          {attention && !view.tuning && (
            <span
              role="img"
              className="h-1.5 w-1.5 rounded-full bg-warn"
              style={{
                boxShadow: "0 0 6px color-mix(in srgb, var(--color-warn) 60%, transparent)",
              }}
              aria-label="needs attention"
            />
          )}
          <div className="flex-1" />
          {summary && <span className="truncate font-mono text-ui-2xs text-faint">{summary}</span>}
        </button>
        <Collapse open={view.tuning} className="flex flex-col gap-3">
          <div id={`exp-tuning-${n}`} className={cx("flex flex-col gap-3", off && "opacity-50")}>
            <ResponseRow n={n} x={x} travel={travel} apply={apply} />

            {live && cable && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <Kicker className="!text-faint">Input</Kicker>
                  <div className="flex-1" />
                  <Button
                    size="sm"
                    kind="ghost"
                    className="!h-5 !px-1"
                    aria-pressed={view.trace}
                    onClick={() => view.setTrace(!view.trace)}
                    title={view.trace ? "Hide the live input trace" : "Show the live input trace"}
                    icon={
                      view.trace ? <Eye size={12} aria-hidden /> : <EyeOff size={12} aria-hidden />
                    }
                  >
                    {view.trace ? "Hide" : "Show"}
                  </Button>
                </div>
                <Collapse open={view.trace}>
                  <RawTrace
                    ring={live.rings[n]}
                    n={n}
                    min={x.min}
                    max={x.max}
                    invert={x.invert}
                    curve={curve}
                    swept={sweeping && capture ? capture : null}
                    watch={live.watch}
                  />
                </Collapse>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <Button
                size="sm"
                kind={flash === "min" ? "primary" : "plain"}
                disabled={!cable || sweeping}
                onClick={() => set("min")}
                title={
                  cable
                    ? "Set heel: rock the pedal fully back, then click to make that 0"
                    : "Plug in or simulate a pedal first"
                }
              >
                Set heel
              </Button>
              <Button
                size="sm"
                kind={flash === "max" ? "primary" : "plain"}
                disabled={!cable || sweeping}
                onClick={() => set("max")}
                title={
                  cable
                    ? "Set toe: push the pedal fully forward, then click to make that 127"
                    : "Plug in or simulate a pedal first"
                }
              >
                Set toe
              </Button>
              <div className="flex-1" />
              <span
                className="flex items-center gap-1.5"
                title="Send 127 at the heel and 0 at the toe"
              >
                <span className="text-ui-xs text-muted">Invert</span>
                <Toggle
                  label={`Invert EXP ${n + 1}`}
                  on={x.invert}
                  onChange={(invert) => apply({ type: "exp", n, patch: { invert } })}
                />
              </span>
              {live && (
                <span
                  className="flex items-center gap-1.5"
                  title="Learn range: widen heel or toe when the pedal goes past them while you play"
                >
                  <span className="text-ui-xs text-muted">Learn</span>
                  <Toggle
                    label={`Learn EXP ${n + 1} range while playing`}
                    on={live.learn[n]}
                    onChange={(on) => live.setLearn(n, on)}
                  />
                </span>
              )}
            </div>
          </div>
        </Collapse>
      </div>

      <TriggerBlock n={n} x={x} engaged={engaged} cable={cable} apply={apply} />
    </div>
  );
}

const TUNING_KEY = `${STORAGE_PREFIX}expTuning`;
const TRACE_KEY = `${STORAGE_PREFIX}expTrace`;

export function ExpressionPanel({
  engaged,
  focus = null,
  ...props
}: {
  /** The input selected on the canvas. */
  focus?: number | null;
  config: Config;
  status: Status | null;
  /** Each input's trigger engaged now (State.expTrigger). */
  engaged: boolean[];
  apply: Apply;
  calibrate: (n: number, edge: ExpEdge) => Promise<void>;
  /** The simulated pedals; without it the cards have no "Simulate pedal" row. */
  sim?: SimControls;
  /** Traces, sweeps and learning the range. */
  live?: ExpLive;
}) {
  // Tuning starts closed, the trace inside it shown; both remembered per input.
  // ?tuning=open: both open, whatever was left (screenshots).
  const forceOpen =
    new URLSearchParams(window.location.search).get("tuning") === "open" ? [true, true] : undefined;
  const [tuning, setTuning] = useStoredFlags(TUNING_KEY, [false, false], forceOpen);
  const [trace, setTrace] = useStoredFlags(TRACE_KEY, [true, true]);
  const view = (n: number): CardView => ({
    tuning: tuning[n],
    setTuning: (on) => setTuning(n, on),
    trace: trace[n],
    setTrace: (on) => setTrace(n, on),
  });
  return (
    <div className="flex flex-col gap-3 p-4">
      <ExpCard n={0} engaged={!!engaged[0]} focused={focus === 0} view={view(0)} {...props} />
      <ExpCard n={1} engaged={!!engaged[1]} focused={focus === 1} view={view(1)} {...props} />
      <p className="px-1 text-ui-xs leading-snug text-faint">
        <Kicker className="mr-1">Tip</Kicker>
        Press Calibrate and rock the pedal heel to toe and back: it finishes on its own once the
        pedal rests. Tuning holds the response curve, heel and toe by hand, and the live input.
      </p>
    </div>
  );
}
