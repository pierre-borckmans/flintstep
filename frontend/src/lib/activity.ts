import type { Activity, ActivitySource, Config } from "../types";
import { SWITCH_NAMES } from "../types";
import { comboName } from "./caption";
import { noteName } from "./notes";

// THE ACTIVITY LOG'S ROWS: what each message was, in the config's own words.
//
// The bridge tags every message with what produced it (Activity.source/index/pair).
// Here that becomes a chip pointing back at the switch or pedal, and the bytes become
// a type badge, a number and a value. A pedal sweep sends a CC every few milliseconds;
// consecutive ones from the same input and controller fold into one row that keeps the
// latest value and counts, so a sweep does not push everything else out of the log.

/** Consecutive messages this close together (and alike, see canCoalesce) share a row. */
export const COALESCE_MS = 400;

/** One row of the log: the latest message of a run, how many there were, and the
 *  message id (seq) of the latest so the lamps blink for each. */
export interface LogEntry extends Activity {
  id: number;
  seq: number;
  count: number;
  firstAt: number;
}

/** Sources whose CCs are a stream of values rather than separate events. */
const STREAMS: ReadonlySet<ActivitySource> = new Set(["exp", "feedback"]);

/** Whether next continues prev's run: the same input (or feedback) moving the same
 *  controller on the same channel, within COALESCE_MS. Switch messages never merge:
 *  a press and its release are two events. */
export function canCoalesce(prev: Activity, next: Activity, windowMs = COALESCE_MS): boolean {
  if (prev.dir !== next.dir || prev.source !== next.source || prev.index !== next.index) {
    return false;
  }
  if (!STREAMS.has(next.source)) return false;
  if ((next.bytes[0] & 0xf0) !== 0xb0 || prev.bytes[0] !== next.bytes[0]) return false;
  if (prev.bytes[1] !== next.bytes[1]) return false;
  const gap = next.at - prev.at;
  return gap >= 0 && gap <= windowMs;
}

/** The log with a adds at the top, newest first, at most max rows. */
export function pushActivity(log: LogEntry[], a: Activity, seq: number, max: number): LogEntry[] {
  const top = log[0];
  if (top && canCoalesce(top, a)) {
    return [{ ...a, id: top.id, seq, count: top.count + 1, firstAt: top.firstAt }, ...log.slice(1)];
  }
  return [{ ...a, id: seq, seq, count: 1, firstAt: a.at }, ...log].slice(0, max);
}

/** What clicking a chip selects in the editor. */
export type Target =
  | { kind: "switch"; n: number }
  | { kind: "exp"; n: 0 | 1 }
  | { kind: "indicator"; n: 0 | 1 };

export type ChipTone = "switch" | "exp" | "feedback" | "release" | "none";

export interface Chip {
  text: string;
  title: string;
  tone: ChipTone;
  target: Target | null;
}

const swName = (n: number) => SWITCH_NAMES[n] ?? "?";
const expN = (n: number): 0 | 1 => (n === 1 ? 1 : 0);

function triggerWords(cfg: Config | null, n: number): [string, string] {
  const mode = cfg?.exp[n]?.trigger.mode;
  if (mode === "toe") return ["toe", "toe click"];
  if (mode === "engage") return ["auto", "auto-engage"];
  return ["trig", "trigger"];
}

/** The chip for what a source/index/pair names, before "release" is considered. */
function chipFor(
  src: ActivitySource | undefined,
  index: number,
  pair: [number, number] | undefined,
  cfg: Config | null,
): Chip | null {
  switch (src) {
    case "switch":
      return {
        text: swName(index),
        title: `Switch ${swName(index)} · tap`,
        tone: "switch",
        target: { kind: "switch", n: index },
      };
    case "long":
      return {
        text: `${swName(index)} hold`,
        title: `Switch ${swName(index)} · long press`,
        tone: "switch",
        target: { kind: "switch", n: index },
      };
    case "combo": {
      const [a, b] = pair ?? [0, 0];
      return {
        text: `${swName(a)}+${swName(b)}`,
        title: `Combo ${comboName({ a, b })}`,
        tone: "switch",
        target: { kind: "switch", n: a },
      };
    }
    case "exp":
      return {
        text: `EXP ${index + 1}`,
        title: `Expression pedal ${index + 1}`,
        tone: "exp",
        target: { kind: "exp", n: expN(index) },
      };
    case "trigger": {
      const [short, long] = triggerWords(cfg, index);
      return {
        text: `EXP ${index + 1} ${short}`,
        title: `Expression pedal ${index + 1} · ${long} trigger`,
        tone: "exp",
        target: { kind: "exp", n: expN(index) },
      };
    }
  }
  return null;
}

/** The switch whose lamp a feedback message drives: its Tap sends that CC or note. */
function feedbackSwitch(bytes: number[], cfg: Config | null): number {
  if (!cfg) return -1;
  const st = bytes[0] & 0xf0;
  const kind = st === 0xb0 ? "cc" : st === 0x90 || st === 0x80 ? "note" : null;
  if (!kind) return -1;
  const ch = (bytes[0] & 0x0f) + 1;
  return cfg.switches.findIndex(
    (s) => s.tap.kind === kind && s.tap.channel === ch && s.tap.number === bytes[1],
  );
}

/** The chip naming what produced a, pointing at it in the config. */
export function originChip(a: Activity, cfg: Config | null): Chip {
  if (a.source === "feedback") {
    const sw = feedbackSwitch(a.bytes, cfg);
    if (sw >= 0) {
      return {
        text: `${swName(sw)} ← DAW`,
        title: `From the DAW: lights switch ${swName(sw)} in feedback mode`,
        tone: "feedback",
        target: { kind: "switch", n: sw },
      };
    }
    const ind = cfg?.indicators.findIndex((i) => i.mode === "midiIn") ?? -1;
    return {
      text: "LED ← DAW",
      title: "From the DAW, on the LED port",
      tone: "feedback",
      target: ind === 0 || ind === 1 ? { kind: "indicator", n: ind } : null,
    };
  }
  if (a.source === "release") {
    const of = a.of === "trigger" ? "exp" : a.of;
    const base = chipFor(of, a.index, a.pair, cfg);
    return {
      text: `${base ? base.text : "—"} drop`,
      title: `${base ? base.title : "Released"}: let go because the pedal dropped or a cable came out`,
      tone: "release",
      target: base?.target ?? null,
    };
  }
  return (
    chipFor(a.source, a.index, a.pair, cfg) ?? {
      text: a.dir === "in" ? "DAW" : "—",
      title: a.dir === "in" ? "From the DAW" : "",
      tone: "none",
      target: null,
    }
  );
}

export type MsgType = "cc" | "note" | "pc" | "other";

/** A message's parts, in columns. */
export interface RowModel {
  chip: Chip;
  type: MsgType;
  typeText: string;
  /** The controller, note name or program. */
  number: string;
  /** The note number beside its name, "" otherwise. */
  numberSub: string;
  value: string;
  /** A CC value or velocity as 0..1 for the inline bar; null for none. */
  bar: number | null;
  valueTone: "on" | "off" | "plain";
  /** "ch 2", or "" on channel 1. */
  channel: string;
  hex: string;
}

/** Sources whose 0 and 127 are an off and an on rather than a position. */
const SWITCHED: ReadonlySet<ActivitySource> = new Set([
  "switch",
  "long",
  "combo",
  "trigger",
  "release",
]);

export function describeRow(a: Activity, cfg: Config | null): RowModel {
  const b = a.bytes;
  const st = (b[0] ?? 0) & 0xf0;
  const ch = ((b[0] ?? 0) & 0x0f) + 1;
  const d1 = b[1] ?? 0;
  const d2 = b[2] ?? 0;
  const row: RowModel = {
    chip: originChip(a, cfg),
    type: "other",
    typeText: (b[0] ?? 0).toString(16).toUpperCase().padStart(2, "0"),
    number: "",
    numberSub: "",
    value: "",
    bar: null,
    valueTone: "plain",
    channel: ch === 1 ? "" : `ch ${ch}`,
    hex: b.map((x) => x.toString(16).padStart(2, "0")).join(" "),
  };
  switch (st) {
    case 0xb0: {
      row.type = "cc";
      row.typeText = "CC";
      row.number = String(d1);
      // A switch's CC, or the DAW echoing one back, is on or off; a pedal's is a position.
      const switched =
        SWITCHED.has(a.source) ||
        (row.chip.tone === "feedback" && row.chip.target?.kind === "switch");
      if (switched && (d2 === 0 || d2 === 127)) {
        row.value = d2 === 0 ? "off" : "on";
        row.valueTone = d2 === 0 ? "off" : "on";
      } else {
        row.value = String(d2);
        row.bar = d2 / 127;
      }
      break;
    }
    case 0x90:
    case 0x80:
      row.type = "note";
      row.typeText = "Note";
      row.number = noteName(d1);
      row.numberSub = String(d1);
      if (st === 0x90 && d2 > 0) {
        row.value = `v${d2}`;
        row.bar = d2 / 127;
        row.valueTone = "on";
      } else {
        row.value = "off";
        row.valueTone = "off";
      }
      break;
    case 0xc0:
      row.type = "pc";
      row.typeText = "PC";
      row.number = String(d1);
      break;
    default:
      row.channel = "";
  }
  return row;
}
