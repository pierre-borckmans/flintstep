import type {
  Action,
  Combo,
  Config,
  ExpConfig,
  ExpTrigger,
  Indicator,
  TriggerMode,
} from "../types";
import { INDICATOR_NAMES, SWITCH_NAMES } from "../types";
import { comboName } from "./caption";
import { defaultConfig, mappingOf, sameConfig } from "./config";
import { curveWords } from "./curve";
import { modeLabel } from "./indicators";
import { noteName } from "./notes";

// HISTORY LABELS. What changed between two configs, in a few words for the undo menu:
// "Switch II · CC 81 → Note C4", "Exp 1 · heel set", "Long press · 650 ms". The
// remembered pedal is not part of the mapping the user edits, so it never shows up.

/** An action by what it sends, without the details: "CC 81", "Note C4", "PC 5", "Off". */
function head(a: Action): string {
  switch (a.kind) {
    case "cc":
      return `CC ${a.number}`;
    case "note":
      return `Note ${noteName(a.number)}`;
    case "pc":
      return `PC ${a.number}`;
    default:
      return "Off";
  }
}

/** The changes to one action, each as "<where> · <what>". */
function actionChanges(where: string, a: Action, b: Action, hold = false): string[] {
  if (hold && a.kind === "off" && b.kind !== "off") return [`${where} · long press ${head(b)}`];
  if (hold && a.kind !== "off" && b.kind === "off") return [`${where} · long press off`];
  if (b.kind === "off" && a.kind === "off") return [];
  const at = hold ? `${where} hold` : where;
  if (a.kind !== b.kind || a.number !== b.number) return [`${at} · ${head(a)} → ${head(b)}`];
  const out: string[] = [];
  if (a.channel !== b.channel) out.push(`${at} · channel ${a.channel} → ${b.channel}`);
  if (a.value !== b.value && b.kind !== "pc") {
    out.push(`${at} · ${b.kind === "note" ? "velocity" : "value"} ${a.value} → ${b.value}`);
  }
  if (a.mode !== b.mode && b.kind === "cc") out.push(`${at} · ${b.mode}`);
  return out;
}

function comboChanges(a: Combo[], b: Combo[]): string[] {
  if (b.length === a.length + 1 && a.every((k, i) => sameCombo(k, b[i]))) {
    return [`Combo ${comboName(b[b.length - 1])} added`];
  }
  if (a.length === b.length + 1) {
    const gone = a.findIndex((k, i) => !b[i] || !sameCombo(k, b[i]));
    if (a.filter((_, i) => i !== gone).every((k, i) => sameCombo(k, b[i]))) {
      return [`Combo ${comboName(a[gone])} removed`];
    }
  }
  if (a.length !== b.length) {
    const n = b.length - a.length;
    return [n > 0 ? `${n} combos added` : `${-n} combos removed`];
  }
  return a.flatMap((k, i) => {
    const m = b[i];
    const pair =
      k.a !== m.a || k.b !== m.b ? [`Combo ${comboName(k)} → ${comboName(m)}`] : ([] as string[]);
    return [...pair, ...actionChanges(`Combo ${comboName(m)}`, k.action, m.action)];
  });
}

const sameCombo = (a: Combo, b: Combo) => JSON.stringify(a) === JSON.stringify(b);

function expChanges(n: number, a: ExpConfig, b: ExpConfig): string[] {
  const at = `Exp ${n + 1}`;
  const out: string[] = [];
  if (a.enabled !== b.enabled) out.push(`${at} · ${b.enabled ? "on" : "off"}`);
  if (a.channel !== b.channel) out.push(`${at} · channel ${a.channel} → ${b.channel}`);
  if (a.cc !== b.cc) out.push(`${at} · CC ${a.cc} → ${b.cc}`);
  const heel = a.min !== b.min;
  const toe = a.max !== b.max;
  if (heel && toe) out.push(`${at} · heel and toe set`);
  else if (heel) out.push(`${at} · heel set`);
  else if (toe) out.push(`${at} · toe set`);
  if (a.invert !== b.invert) out.push(`${at} · ${b.invert ? "inverted" : "not inverted"}`);
  if (a.curve && b.curve && (a.curve.kind !== b.curve.kind || a.curve.amount !== b.curve.amount)) {
    out.push(`${at} · curve ${curveWords(b.curve)}`);
  }
  if (a.trigger && b.trigger) out.push(...triggerChanges(at, a.trigger, b.trigger));
  return out;
}

const TRIGGER_WORD: Record<TriggerMode, string> = {
  off: "trigger off",
  engage: "auto-engage",
  toe: "toe click",
};

/** "Exp 1 · auto-engage", "Exp 1 · toe threshold 92%", "Exp 1 · off delay 600 ms". The
 *  defaults a mode fills in are part of picking it, so they do not show separately. */
function triggerChanges(at: string, a: ExpTrigger, b: ExpTrigger): string[] {
  if (a.mode !== b.mode) return [`${at} · ${TRIGGER_WORD[b.mode]}`];
  const out: string[] = [];
  if (a.threshold !== b.threshold) {
    const which = b.mode === "toe" ? "toe" : b.mode === "engage" ? "engage" : "trigger";
    out.push(`${at} · ${which} threshold ${b.threshold}%`);
  }
  if (a.offDelayMs !== b.offDelayMs) out.push(`${at} · off delay ${b.offDelayMs} ms`);
  out.push(...actionChanges(`${at} trigger`, a.action, b.action));
  return out;
}

function indicatorChanges(n: number, a: Indicator, b: Indicator): string[] {
  const at = `${INDICATOR_NAMES[n] ?? n + 1} lamp`;
  const out: string[] = [];
  if (a.mode !== b.mode) out.push(`${at} · ${modeLabel(b.mode)}`);
  if (a.colour.r !== b.colour.r || a.colour.g !== b.colour.g || a.colour.b !== b.colour.b) {
    out.push(`${at} · colour`);
  }
  return out;
}

/** Every change from `before` to `after`, one phrase each, in the order the editor
 *  shows them: switches, combos, expression, then the settings. */
export function configChanges(before: Config, after: Config): string[] {
  const out: string[] = [];
  const n = Math.max(before.switches.length, after.switches.length);
  for (let i = 0; i < n; i++) {
    const a = before.switches[i];
    const b = after.switches[i];
    if (!a || !b) continue;
    const name = `Switch ${SWITCH_NAMES[i] ?? i + 1}`;
    out.push(...actionChanges(name, a.tap, b.tap));
    out.push(...actionChanges(name, a.long, b.long, true));
    if (a.colour.r !== b.colour.r || a.colour.g !== b.colour.g || a.colour.b !== b.colour.b) {
      out.push(`${name} · LED colour`);
    }
  }
  out.push(...comboChanges(before.combos, after.combos));
  for (let i = 0; i < Math.min(before.exp.length, after.exp.length); i++) {
    out.push(...expChanges(i, before.exp[i], after.exp[i]));
  }
  const ind = Math.min(before.indicators?.length ?? 0, after.indicators?.length ?? 0);
  for (let i = 0; i < ind; i++) {
    out.push(...indicatorChanges(i, before.indicators[i], after.indicators[i]));
  }
  if (before.ledMode !== after.ledMode) {
    out.push(`LED mode · ${after.ledMode === "feedback" ? "MIDI feedback" : "local"}`);
  }
  if (before.brightness !== after.brightness) out.push(`Brightness · ${after.brightness}%`);
  if (before.longPressMs !== after.longPressMs) out.push(`Long press · ${after.longPressMs} ms`);
  return out;
}

/** One label for the change from `before` to `after`. Several changes at once read as
 *  "Mapping reset" when they land on the defaults, otherwise as the first one and a
 *  count: "Switch I · LED colour + 2 more". */
export function diffConfigs(before: Config, after: Config): string {
  const changes = configChanges(before, after);
  if (changes.length === 0) return "No change";
  if (changes.length === 1) return changes[0];
  if (sameConfig(mappingOf(after), defaultConfig())) return "Mapping reset";
  return `${changes[0]} + ${changes.length - 1} more`;
}
