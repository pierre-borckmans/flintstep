import type { Action, ExpTrigger, TriggerMode } from "../types";
import { noteName } from "./notes";

// EXPRESSION TRIGGERS. The Spark Control X reads one value per expression jack, so a
// pedal's own toe switch has nowhere to go; the bridge fakes one from the position
// (internal/mapping/trigger.go). This file is the UI's side: the same ranges and
// defaults as Go, what picking a mode fills in, and the maths of the draggable
// threshold marker.

/** mapping.MinTriggerThreshold.. and friends: Go's Normalize clamps to these. */
export const TRIGGER = {
  min: 1,
  max: 99,
  hysteresis: 3,
  engage: 4,
  toe: 96,
  offDelay: { min: 0, max: 2000, step: 50, default: 400 },
} as const;

/** Exp n's trigger action by default: CC 102+n on channel 1, value 127. 102..119 are
 *  undefined in the MIDI spec, so nothing else is listening there. Toe click defaults
 *  to a toggle (each push flips it, like a real toe switch), auto-engage to momentary. */
export function triggerAction(n: number, mode: TriggerMode = "engage"): Action {
  return {
    kind: "cc",
    channel: 1,
    number: 102 + n,
    value: 127,
    mode: mode === "toe" ? "toggle" : "momentary",
  };
}

/** mapping.defaultTrigger: off, with what auto-engage uses already filled in. */
export function defaultTrigger(n: number): ExpTrigger {
  return {
    mode: "off",
    action: triggerAction(n),
    threshold: TRIGGER.engage,
    offDelayMs: TRIGGER.offDelay.default,
  };
}

/** Whether a threshold belongs with a mode: auto-engage sits near the heel, a toe
 *  click near the toe. A threshold on the wrong half is a leftover from the other
 *  mode. */
const fits = (mode: TriggerMode, th: number) => (mode === "toe" ? th >= 50 : th < 50);

/** Whether an action is one of exp n's defaults, untouched by the user. */
function isDefaultAction(n: number, a: Action): boolean {
  if (a.kind === "off") return true;
  const d = triggerAction(n);
  return a.kind === "cc" && a.channel === d.channel && a.number === d.number && a.value === d.value;
}

/** The trigger after the user picks `mode`, so one click gives one that works: the
 *  mode's default threshold unless the current one already fits it, and the mode's
 *  default action unless the user chose their own. Turning it off keeps the rest, so
 *  turning it back on restores what was there. */
export function pickMode(t: ExpTrigger, mode: TriggerMode, n: number): ExpTrigger {
  if (mode === "off") return { ...t, mode };
  return {
    ...t,
    mode,
    threshold: fits(mode, t.threshold)
      ? t.threshold
      : mode === "toe"
        ? TRIGGER.toe
        : TRIGGER.engage,
    action: isDefaultAction(n, t.action) ? triggerAction(n, mode) : t.action,
  };
}

const clampTh = (v: number) => Math.min(TRIGGER.max, Math.max(TRIGGER.min, Math.round(v)));

/** The threshold under a pointer at x on a bar of the given width: the bar is the
 *  calibrated travel, heel at the left. */
export function thresholdAt(x: number, width: number): number {
  if (width <= 0) return TRIGGER.min;
  return clampTh((x / width) * 100);
}

/** The threshold after a key on the marker, or null for a key it ignores: arrows nudge
 *  1 % (5 % with shift), Page Up/Down 10 %, Home/End go to the ends. */
export function nudge(th: number, key: string, shift = false): number | null {
  const step = shift ? 5 : 1;
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return clampTh(th + step);
    case "ArrowLeft":
    case "ArrowDown":
      return clampTh(th - step);
    case "PageUp":
      return clampTh(th + 10);
    case "PageDown":
      return clampTh(th - 10);
    case "Home":
      return TRIGGER.min;
    case "End":
      return TRIGGER.max;
    default:
      return null;
  }
}

/** Where a held trigger lets go, in percent: the hysteresis under the threshold, never
 *  below the heel. */
export function releaseAt(th: number): number {
  return Math.max(0, th - TRIGGER.hysteresis);
}

export const MODE_LABEL: Record<TriggerMode, string> = {
  off: "Off",
  engage: "Auto-engage",
  toe: "Toe click",
};

/** One plain line on what the mode does with these settings. */
export function explainTrigger(t: ExpTrigger): string {
  switch (t.mode) {
    case "engage":
      return `Switches on as soon as you rock off the heel (past ${t.threshold}%), and off again when you rest it back down. Like an auto-engage wah.`;
    case "toe":
      return `Push past ${t.threshold}% to click, like the switch under a wah's toe. Back off below ${releaseAt(t.threshold)}% to let go.`;
    default:
      return "Only the CC. The jack can't read a toe switch, so pick a mode to fake one from the position.";
  }
}

/** What a trigger's action sends, in its own words: it engages and lets go rather
 *  than being pressed and released. */
export function explainTriggerAction(a: Action): string {
  switch (a.kind) {
    case "cc":
      return a.mode === "toggle"
        ? `Each time it engages, alternates ${a.value} and 0.`
        : `Sends ${a.value} when it engages, 0 when it lets go.`;
    case "note":
      return `Note on (${noteName(a.number)}, velocity ${a.value}) when it engages, note off when it lets go.`;
    case "pc":
      return `Program change ${a.number} when it engages. Programs count from 0.`;
    default:
      return "";
  }
}

/** What the off-delay slider says. */
export function offDelayText(ms: number): string {
  return ms === 0
    ? "Switches off the moment you return to the heel"
    : `Stays on for ${ms} ms after you return to the heel`;
}

// ---- simulation ---------------------------------------------------------------

/** One input's trigger, as mapping.Engine keeps it. */
export interface TriggerState {
  held: boolean;
  due: number | null; // engage: let go at this time (ms)
  on: boolean; // a CC toggle's state
}

export const idleTrigger = (): TriggerState => ({ held: false, due: null, on: false });

/** mapping.Engine's trigger step without the MIDI, for the browser mock: the state
 *  after the travel reads `pct` (0..100) at time `now`, and whether that pressed or
 *  let go. Feed it with pct = null to only run the off-delay timer. */
export function stepTrigger(
  s: TriggerState,
  t: ExpTrigger,
  pct: number | null,
  now: number,
): { state: TriggerState; press: boolean; release: boolean } {
  let st = { ...s };
  let release = false;
  if (st.held && st.due !== null && now >= st.due) {
    st = { ...st, held: false, due: null };
    release = true;
  }
  if (t.mode === "off" || pct === null) return { state: st, press: false, release };
  const offAt = Math.max(t.threshold - TRIGGER.hysteresis, 0);
  const lets = pct < offAt || (offAt <= 0 && pct <= 0);
  if (!st.held && pct >= t.threshold) {
    const toggle = t.action.kind === "cc" && t.action.mode === "toggle";
    return { state: { held: true, due: null, on: toggle ? !st.on : st.on }, press: true, release };
  }
  if (st.held && t.mode === "engage" && pct >= t.threshold) st.due = null;
  else if (st.held && lets) {
    if (t.mode === "engage" && t.offDelayMs > 0) {
      st.due ??= now + t.offDelayMs;
    } else {
      st = { ...st, held: false, due: null };
      release = true;
    }
  }
  return { state: st, press: false, release };
}

/** Whether the lamp shows the trigger engaged: held, or on for a CC toggle. */
export function triggerLit(s: TriggerState, t: ExpTrigger): boolean {
  if (t.mode === "off") return false;
  return t.action.kind === "cc" && t.action.mode === "toggle" ? s.on : s.held;
}
