// PRESETS: the pure rules behind the preset picker, mirroring internal/presets.
//
// A preset is a name and a whole Config. Nothing here looks inside a Config except to
// drop the pedal, which belongs to the Mac rather than to any one mapping.

import type { Config, PresetInfo } from "../types";
import { defaultConfig } from "./config";

export const MAX_NAME = 40;
export const EXPORT_FORMAT = "sparkx-midi-preset";
export const EXPORT_VERSION = 1;
const SUFFIX = ".sparkx.json";

/** Characters, not UTF-16 units: "é" is one. */
const len = (s: string) => [...s].length;
const cut = (s: string, n: number) => [...s].slice(0, n).join("").trimEnd();
const taken = (names: string[], name: string) =>
  names.some((n) => n.toLowerCase() === name.toLowerCase());

/** The name to store, or why not: trimmed, 1..40 characters, no other preset's (any
 *  case). `self` is the preset being renamed, which may keep its own name. */
export function checkName(
  raw: string,
  presets: PresetInfo[],
  self?: string,
): { name: string } | { error: string } {
  const name = raw.trim();
  if (!name) return { error: "A preset needs a name" };
  if (len(name) > MAX_NAME) return { error: `At most ${MAX_NAME} characters` };
  const clash = presets.find((p) => p.id !== self && p.name.toLowerCase() === name.toLowerCase());
  if (clash) return { error: `“${clash.name}” already exists` };
  return { name };
}

/** base, or "base (2)", "base (3)"… whichever no name in `names` has. */
export function uniqueName(base: string, names: string[]): string {
  if (!taken(names, base)) return base;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const name = cut(base, MAX_NAME - suffix.length) + suffix;
    if (!taken(names, name)) return name;
  }
}

/** What Duplicate names the copy. */
export const copyName = (name: string, names: string[]) =>
  uniqueName(`${cut(name, MAX_NAME - 5)} copy`, names);

/** The undo history's label for switching to a preset. */
export const presetLabel = (name: string) => `Preset · ${name}`;

export function exportFileName(name: string): string {
  const n =
    name
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
      .replace(/[\u0000-\u001f]/g, "")
      .replace(/[/:\\]/g, "-")
      .trim()
      .replace(/^\.+/, "") || "preset";
  return n + SUFFIX;
}

const noPedal = (c: Config): Config => ({ ...c, pedal: { address: "", name: "" } });

/** The export file for a preset, pedal left out (Go's ExportPreset writes the same). */
export function encodePreset(name: string, config: Config): string {
  const { pedal: _, ...rest } = config;
  return `${JSON.stringify(
    { format: EXPORT_FORMAT, version: EXPORT_VERSION, name, config: rest },
    null,
    2,
  )}\n`;
}

function nameFromFile(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? "";
  const lower = base.toLowerCase();
  if (lower.endsWith(SUFFIX)) return base.slice(0, -SUFFIX.length).trim();
  if (lower.endsWith(".json")) return base.slice(0, -5).trim();
  return base.trim();
}

const NOT_A_PRESET = "This file is not a SparkX MIDI preset";

/** An exported preset, or a bare Config (an old config.json) named after its file.
 *  Throws with words for the UI. The mock's import; Go has its own. */
export function decodePreset(text: string, filename: string): { name: string; config: Config } {
  let top: unknown;
  try {
    top = JSON.parse(text);
  } catch {
    throw new Error(NOT_A_PRESET);
  }
  if (!top || typeof top !== "object" || Array.isArray(top) || !Object.keys(top).length) {
    throw new Error(NOT_A_PRESET);
  }
  const o = top as Record<string, unknown>;
  const base = defaultConfig();
  let name = "";
  let cfg: Record<string, unknown>;
  if ("format" in o) {
    if (o.format !== EXPORT_FORMAT) throw new Error(NOT_A_PRESET);
    if (typeof o.version !== "number" || o.version > EXPORT_VERSION) {
      throw new Error("This preset was made by a newer SparkX MIDI");
    }
    if (!o.config || typeof o.config !== "object") {
      throw new Error("This preset file has no mapping in it");
    }
    name = typeof o.name === "string" ? o.name : "";
    cfg = o.config as Record<string, unknown>;
  } else {
    // A bare Config has only Config's keys.
    if (Object.keys(o).some((k) => !(k in base))) throw new Error(NOT_A_PRESET);
    cfg = o;
  }
  name = cut(name.trim(), MAX_NAME) || cut(nameFromFile(filename), MAX_NAME) || "Imported preset";
  return { name, config: noPedal({ ...base, ...cfg } as Config) };
}

export type ListAction =
  | { type: "move"; index: number }
  | { type: "choose"; index: number }
  | { type: "rename"; index: number }
  | { type: "close" }
  | null;

/** What a key does in the preset list, with `index` highlighted out of `count`. */
export function listKey(key: string, index: number, count: number): ListAction {
  if (key === "Escape") return { type: "close" };
  if (count === 0) return null;
  const last = count - 1;
  switch (key) {
    case "ArrowDown":
      return { type: "move", index: index < 0 ? 0 : Math.min(last, index + 1) };
    case "ArrowUp":
      return { type: "move", index: index < 0 ? last : Math.max(0, index - 1) };
    case "Home":
      return { type: "move", index: 0 };
    case "End":
      return { type: "move", index: last };
    case "Enter":
      return index < 0 ? null : { type: "choose", index };
    case "F2":
      return index < 0 ? null : { type: "rename", index };
  }
  return null;
}
