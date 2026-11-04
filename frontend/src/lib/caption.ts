import type { Action, Combo } from "../types";
import { SWITCH_NAMES } from "../types";
import { noteName } from "./notes";

/** The short line under a switch: "CC 80 · momentary", "Note C4", "PC 5", "Off".
 *  The channel is only spelt out when it is not 1, since almost everything is on 1. */
export function actionCaption(a: Action, short = false): string {
  const ch = a.channel !== 1 ? ` · ch ${a.channel}` : "";
  switch (a.kind) {
    case "cc":
      // Short form: momentary is the default, so only a toggle is worth the room.
      if (short) return `CC ${a.number}${a.mode === "toggle" ? " · toggle" : ""}${ch}`;
      return `CC ${a.number} · ${a.mode === "toggle" ? "toggle" : "momentary"}${ch}`;
    case "note":
      return `Note ${noteName(a.number)}${ch}`;
    case "pc":
      return `PC ${a.number}${ch}`;
    default:
      return "Off";
  }
}

/** The hold line, or "" when there is no long press. */
export function longCaption(a: Action, short = false): string {
  return a.kind === "off" ? "" : `hold: ${actionCaption(a, short)}`;
}

export function comboName(c: Pick<Combo, "a" | "b">): string {
  return `${SWITCH_NAMES[c.a] ?? "?"} + ${SWITCH_NAMES[c.b] ?? "?"}`;
}
