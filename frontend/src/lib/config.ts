import type {
  Action,
  Colour,
  Combo,
  Config,
  ExpConfig,
  ExpTrigger,
  Indicator,
  LEDMode,
  SwitchConfig,
  TriggerMode,
} from "../types";
import { INDICATOR_NAMES, SWITCH_NAMES, SWITCHES } from "../types";
import { comboName } from "./caption";
import { RAW_MAX } from "./exp";
import { copyIndicators, DEFAULT_INDICATORS, isIndicatorMode } from "./indicators";
import type { Gesture } from "./scrub";
import { defaultTrigger, pickMode, TRIGGER } from "./trigger";

// CONFIG EDITING. The Go side owns the config (mapping.Normalize/Validate); this file is
// the UI's copy of the same rules so a bad edit is caught before Save, and the reducer the
// editor goes through so every change is a plain function of (config, op).

/** mapping.MinLongPressMS / MaxLongPressMS: the slider and validate both use these. */
export const LONG_PRESS = { min: 150, max: 3000, step: 50 } as const;

const OFF: Action = { kind: "off", channel: 1, number: 0, value: 127, mode: "momentary" };

export const cc = (number: number, channel = 1, mode: Action["mode"] = "momentary"): Action => ({
  kind: "cc",
  channel,
  number,
  value: 127,
  mode,
});

/** mapping.defaultColours: saturated, since the pedal's LEDs wash pastels out to white. */
const DEFAULT_COLOURS: Colour[] = [
  { r: 255, g: 150, b: 0 }, // I: amber
  { r: 255, g: 80, b: 0 }, // II: orange
  { r: 255, g: 0, b: 170 }, // A: magenta
  { r: 0, g: 220, b: 255 }, // III: cyan
  { r: 0, g: 120, b: 255 }, // IV: azure
  { r: 150, g: 0, b: 255 }, // B: violet
];

/** mapping.Default(), field for field: switch n = CC 80+n momentary on channel 1,
 *  exp 1 = CC 11, exp 2 = CC 7, local LEDs, Amp flashing with MIDI out, App lit while
 *  connected. */
export function defaultConfig(): Config {
  const exp = (ccn: number, n: number): ExpConfig => ({
    enabled: true,
    channel: 1,
    cc: ccn,
    min: 0,
    max: RAW_MAX,
    invert: false,
    trigger: defaultTrigger(n),
  });
  return {
    version: 3,
    pedal: { address: "", name: "" },
    switches: Array.from({ length: SWITCHES }, (_, n) => ({
      tap: cc(80 + n),
      long: { ...OFF },
      colour: { ...DEFAULT_COLOURS[n] },
    })),
    combos: [],
    exp: [exp(11, 0), exp(7, 1)],
    ledMode: "local",
    longPressMs: 500,
    brightness: 100,
    indicators: copyIndicators(DEFAULT_INDICATORS),
  };
}

// ---- validation ---------------------------------------------------------------

const inRange = (v: number, lo: number, hi: number) => Number.isInteger(v) && v >= lo && v <= hi;

function actionError(a: Action, where: string): string | null {
  if (a.kind === "off") return null;
  if (!["cc", "note", "pc"].includes(a.kind)) return `${where}: unknown action "${a.kind}"`;
  if (!inRange(a.channel, 1, 16)) return `${where}: channel must be 1 to 16`;
  const what = a.kind === "cc" ? "CC number" : a.kind === "note" ? "note" : "program";
  if (!inRange(a.number, 0, 127)) return `${where}: ${what} must be 0 to 127`;
  if (a.kind !== "pc" && !inRange(a.value, 1, 127)) {
    return `${where}: ${a.kind === "note" ? "velocity" : "value"} must be 1 to 127`;
  }
  if (a.kind === "cc" && a.mode !== "momentary" && a.mode !== "toggle") {
    return `${where}: mode must be momentary or toggle`;
  }
  return null;
}

/** mapping.Config.Validate, rule for rule, in the same order and the same words. */
function goValidate(c: Config): string | null {
  const seen = new Set<string>();
  for (const [i, k] of c.combos.entries()) {
    if (!inRange(k.a, 0, SWITCHES - 1) || !inRange(k.b, 0, SWITCHES - 1)) {
      return `combo ${i + 1} uses a switch that does not exist`;
    }
    if (k.a === k.b) return `combo ${comboName(k)} uses the same switch twice`;
    if (k.action.kind === "off") return `combo ${comboName(k)} does nothing: pick what it sends`;
    const key = `${Math.min(k.a, k.b)}-${Math.max(k.a, k.b)}`;
    if (seen.has(key)) return `two combos use ${comboName(k)}`;
    seen.add(key);
  }
  for (const [n, x] of c.exp.entries()) {
    // min is the heel and max the toe, in either order. 0/0 is "not calibrated", which
    // Go's Normalize turns into the whole jack.
    if (x.enabled && x.min === x.max && x.min !== 0) {
      return `expression ${n + 1}: heel and toe were calibrated at the same point`;
    }
    const t = x.trigger;
    if (t && (t.mode === "engage" || t.mode === "toe") && t.action.kind === "off") {
      return `expression ${n + 1}: the trigger does nothing: pick what it sends`;
    }
  }
  return null;
}

const TRIGGER_MODES: TriggerMode[] = ["off", "engage", "toe"];

/** The first problem with a config, in words for the UI, or null.
 *
 *  First exactly what mapping.Config.Validate rejects. Then the ranges Go's Normalize
 *  would clamp to without a word (channel 1..16, long press MinLongPressMS..
 *  MaxLongPressMS and so on): the UI says so instead, so what is saved is what the user
 *  sees. */
export function validate(c: Config): string | null {
  const g = goValidate(c);
  if (g) return g;

  if (c.switches.length !== SWITCHES) return "the pedal has six switches";
  for (let n = 0; n < SWITCHES; n++) {
    const s = c.switches[n];
    const name = `Switch ${SWITCH_NAMES[n]}`;
    const e = actionError(s.tap, name) ?? actionError(s.long, `${name} hold`);
    if (e) return e;
  }
  for (const k of c.combos) {
    const e = actionError(k.action, `Combo ${comboName(k)}`);
    if (e) return e;
  }
  if (c.exp.length !== 2) return "the pedal has two expression inputs";
  for (let n = 0; n < 2; n++) {
    const x = c.exp[n];
    const where = `EXP ${n + 1}`;
    if (!inRange(x.channel, 1, 16)) return `${where}: channel must be 1 to 16`;
    if (!inRange(x.cc, 0, 127)) return `${where}: CC number must be 0 to 127`;
    if (!inRange(x.min, 0, RAW_MAX) || !inRange(x.max, 0, RAW_MAX)) {
      return `${where}: calibration out of range`;
    }
    const t = x.trigger;
    if (!t || !TRIGGER_MODES.includes(t.mode)) return `${where}: unknown trigger mode`;
    const e = actionError(t.action, `${where} trigger`);
    if (e) return e;
    if (!inRange(t.threshold, TRIGGER.min, TRIGGER.max)) {
      return `${where}: trigger threshold must be ${TRIGGER.min} to ${TRIGGER.max}%`;
    }
    if (!inRange(t.offDelayMs, TRIGGER.offDelay.min, TRIGGER.offDelay.max)) {
      return `${where}: off delay must be ${TRIGGER.offDelay.min} to ${TRIGGER.offDelay.max} ms`;
    }
  }
  if (c.ledMode !== "local" && c.ledMode !== "feedback") return "unknown LED mode";
  if (!inRange(c.longPressMs, LONG_PRESS.min, LONG_PRESS.max)) {
    return `long-press time must be ${LONG_PRESS.min} to ${LONG_PRESS.max} ms`;
  }
  if (!inRange(c.brightness, 0, 100)) return "brightness must be 0 to 100";
  // Go's Normalize would turn an unknown mode into the default without a word.
  if (c.indicators?.length !== 2) return "the pedal has two indicator lamps";
  for (const [n, x] of c.indicators.entries()) {
    if (!isIndicatorMode(x.mode)) return `${INDICATOR_NAMES[n]} lamp: unknown mode`;
  }
  return null;
}

// ---- editing ------------------------------------------------------------------

/** Makes an edit; a scrubbed number passes its drag (see useBridge). */
export type Apply = (op: Op, gesture?: Gesture) => void;

export type Op =
  | { type: "tap" | "long"; sw: number; patch: Partial<Action> }
  | { type: "colour"; sw: number; colour: Colour }
  | { type: "addCombo" }
  | {
      type: "combo";
      index: number;
      patch: Partial<Omit<Combo, "action">>;
      action?: Partial<Action>;
    }
  | { type: "removeCombo"; index: number }
  | { type: "exp"; n: number; patch: Partial<Omit<ExpConfig, "trigger">> }
  | { type: "triggerMode"; n: number; mode: TriggerMode }
  | {
      type: "trigger";
      n: number;
      patch: Partial<Pick<ExpTrigger, "threshold" | "offDelayMs">>;
      action?: Partial<Action>;
    }
  | { type: "ledMode"; mode: LEDMode }
  | { type: "brightness"; value: number }
  | { type: "indicator"; n: number; patch: Partial<Indicator> }
  | { type: "longPressMs"; value: number };

/** Applies a patch to an action. Turning an "off" action on fills in a usable one
 *  rather than leaving CC 0 at value 0. */
export function patchAction(a: Action, patch: Partial<Action>): Action {
  const next = { ...a, ...patch };
  if (patch.kind && patch.kind !== "off" && a.kind === "off") {
    next.channel ||= 1;
    if (patch.value === undefined && next.value < 1) next.value = 127;
    next.mode ||= "momentary";
  }
  return next;
}

const PAIRS: [number, number][] = [
  [0, 1],
  [1, 2],
  [3, 4],
  [4, 5],
  [0, 3],
  [1, 4],
  [2, 5],
];

/** The next combo to offer: the first natural neighbour pair not already used. */
export function nextCombo(c: Config): Combo {
  const used = new Set(c.combos.map((k) => `${Math.min(k.a, k.b)}-${Math.max(k.a, k.b)}`));
  const all: [number, number][] = [...PAIRS];
  for (let a = 0; a < SWITCHES; a++) for (let b = a + 1; b < SWITCHES; b++) all.push([a, b]);
  const pair = all.find(([a, b]) => !used.has(`${a}-${b}`)) ?? [0, 1];
  return { a: pair[0], b: pair[1], action: cc(100 + c.combos.length) };
}

const setAt = <T>(xs: T[], i: number, f: (x: T) => T): T[] =>
  xs.map((x, j) => (j === i ? f(x) : x));

export function edit(c: Config, op: Op): Config {
  switch (op.type) {
    case "tap":
    case "long": {
      const key = op.type;
      return {
        ...c,
        switches: setAt(c.switches, op.sw, (s: SwitchConfig) => ({
          ...s,
          [key]: patchAction(s[key], op.patch),
        })),
      };
    }
    case "colour":
      return {
        ...c,
        switches: setAt(c.switches, op.sw, (s) => ({ ...s, colour: { ...op.colour } })),
      };
    case "addCombo":
      return { ...c, combos: [...c.combos, nextCombo(c)] };
    case "combo":
      return {
        ...c,
        combos: setAt(c.combos, op.index, (k) => ({
          ...k,
          ...op.patch,
          action: op.action ? patchAction(k.action, op.action) : k.action,
        })),
      };
    case "removeCombo":
      return { ...c, combos: c.combos.filter((_, i) => i !== op.index) };
    case "exp":
      return { ...c, exp: setAt(c.exp, op.n, (x) => ({ ...x, ...op.patch })) };
    case "triggerMode":
      return {
        ...c,
        exp: setAt(c.exp, op.n, (x) => ({ ...x, trigger: pickMode(x.trigger, op.mode, op.n) })),
      };
    case "trigger":
      return {
        ...c,
        exp: setAt(c.exp, op.n, (x) => ({
          ...x,
          trigger: {
            ...x.trigger,
            ...op.patch,
            action: op.action ? patchAction(x.trigger.action, op.action) : x.trigger.action,
          },
        })),
      };
    case "indicator":
      return {
        ...c,
        indicators: setAt(c.indicators, op.n, (x) => ({
          ...x,
          ...op.patch,
          colour: { ...(op.patch.colour ?? x.colour) },
        })),
      };
    case "ledMode":
      return { ...c, ledMode: op.mode };
    case "brightness":
      return { ...c, brightness: Math.round(Math.min(100, Math.max(0, op.value))) };
    case "longPressMs":
      return { ...c, longPressMs: Math.round(op.value) };
  }
}

/** What an op changes, as a key: edits with the same key in quick succession (a
 *  slider drag, typing "127") are one step in the undo history. Null for ops that are
 *  a step on their own, like adding a combo. */
export function opKey(op: Op): string | null {
  const keys = (p: object | undefined) =>
    Object.keys(p ?? {})
      .sort()
      .join(",");
  switch (op.type) {
    case "tap":
    case "long":
      return `${op.type}:${op.sw}:${keys(op.patch)}`;
    case "colour":
      return `colour:${op.sw}`;
    case "combo":
      return `combo:${op.index}:${keys(op.patch)}:${keys(op.action)}`;
    case "exp":
      return `exp:${op.n}:${keys(op.patch)}`;
    case "trigger":
      return `trigger:${op.n}:${keys(op.patch)}:${keys(op.action)}`;
    case "indicator":
      return `indicator:${op.n}:${keys(op.patch)}`;
    case "ledMode":
    case "brightness":
    case "longPressMs":
      return op.type;
    default:
      return null;
  }
}

/** Whether two configs are the same, field for field. */
export function sameConfig(a: Config, b: Config): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The config without the remembered pedal: what the user edits, undoes and redoes.
 *  The pedal is Go's (Choose / Forget) and goes back in at save time. */
export function mappingOf(c: Config): Config {
  return { ...c, pedal: { address: "", name: "" } };
}

/** Whether two configs map the pedal the same way, whichever pedal each remembers. */
export function sameMapping(a: Config, b: Config): boolean {
  return sameConfig(mappingOf(a), mappingOf(b));
}

/** A calibration came back from Go while the user had unsaved edits: take the new
 *  heel/toe for that input and keep everything else of the draft. */
export function mergeCalibration(draft: Config, fresh: Config, n: number): Config {
  return edit(draft, { type: "exp", n, patch: { min: fresh.exp[n].min, max: fresh.exp[n].max } });
}
