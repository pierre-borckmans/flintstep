import type { Action, Colour, Combo, Config, ExpConfig, LEDMode, SwitchConfig } from "../types";
import { SWITCH_NAMES, SWITCHES } from "../types";
import { comboName } from "./caption";
import { RAW_MAX } from "./exp";

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

const DEFAULT_COLOURS: Colour[] = [
  { r: 255, g: 0, b: 0 },
  { r: 0, g: 255, b: 0 },
  { r: 0, g: 40, b: 255 },
  { r: 255, g: 190, b: 0 },
  { r: 150, g: 0, b: 255 },
  { r: 0, g: 220, b: 255 },
];

/** mapping.Default(): switch n = CC 80+n momentary on channel 1, exp 1 = CC 11,
 *  exp 2 = CC 7, local LEDs. The colours are this file's guess; Go's ResetConfig wins. */
export function defaultConfig(): Config {
  const exp = (ccn: number): ExpConfig => ({
    enabled: true,
    channel: 1,
    cc: ccn,
    min: 0,
    max: RAW_MAX,
    invert: false,
  });
  return {
    version: 1,
    pedal: { address: "", name: "" },
    switches: Array.from({ length: SWITCHES }, (_, n) => ({
      tap: cc(80 + n),
      long: { ...OFF },
      colour: { ...DEFAULT_COLOURS[n] },
    })),
    combos: [],
    exp: [exp(11), exp(7)],
    ledMode: "local",
    longPressMs: 500,
    brightness: 100,
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

/** The first problem with a config, in words for the UI, or null. Mirrors
 *  mapping.Config.Validate. */
export function validate(c: Config): string | null {
  if (c.switches.length !== SWITCHES) return "the pedal has six switches";
  for (let n = 0; n < SWITCHES; n++) {
    const s = c.switches[n];
    const name = `Switch ${SWITCH_NAMES[n]}`;
    const e = actionError(s.tap, name) ?? actionError(s.long, `${name} hold`);
    if (e) return e;
  }
  const seen = new Set<string>();
  for (const k of c.combos) {
    if (!inRange(k.a, 0, SWITCHES - 1) || !inRange(k.b, 0, SWITCHES - 1)) {
      return "combo uses a switch that does not exist";
    }
    if (k.a === k.b) return "combo uses the same switch twice";
    const key = `${Math.min(k.a, k.b)}-${Math.max(k.a, k.b)}`;
    if (seen.has(key)) return `two combos use ${comboName(k)}`;
    seen.add(key);
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
    // min is the heel and max the toe, in either order. 0/0 is "not calibrated", which
    // Go's Normalize turns into the whole jack.
    if (x.enabled && x.min === x.max && x.min !== 0) {
      return `expression ${n + 1}: heel and toe were calibrated at the same point`;
    }
  }
  if (c.ledMode !== "local" && c.ledMode !== "feedback") return "unknown LED mode";
  if (!inRange(c.longPressMs, LONG_PRESS.min, LONG_PRESS.max)) {
    return `long-press time must be ${LONG_PRESS.min} to ${LONG_PRESS.max} ms`;
  }
  if (!inRange(c.brightness, 0, 100)) return "brightness must be 0 to 100";
  return null;
}

// ---- editing ------------------------------------------------------------------

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
  | { type: "exp"; n: number; patch: Partial<ExpConfig> }
  | { type: "ledMode"; mode: LEDMode }
  | { type: "brightness"; value: number }
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
    case "ledMode":
      return { ...c, ledMode: op.mode };
    case "brightness":
      return { ...c, brightness: Math.round(Math.min(100, Math.max(0, op.value))) };
    case "longPressMs":
      return { ...c, longPressMs: Math.round(op.value) };
  }
}

/** Whether the draft differs from what the Go side last reported. */
export function sameConfig(a: Config, b: Config): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A calibration came back from Go while the user had unsaved edits: take the new
 *  heel/toe for that input and keep everything else of the draft. */
export function mergeCalibration(draft: Config, fresh: Config, n: number): Config {
  return edit(draft, { type: "exp", n, patch: { min: fresh.exp[n].min, max: fresh.exp[n].max } });
}
