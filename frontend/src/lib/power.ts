// THE POWER LED. The pedal's own POWER lamp takes its colour from the charge level and
// blinks while charging. The drawn pedal and the header battery mirror it.

import type { Colour } from "../types";

/** Below LOW the lamp is red, from LOW to HIGH yellow, from HIGH green. Seen on the
 *  pedal: yellow at ~30 %, green at 61 % (charging and not). So HIGH is somewhere in
 *  31..61; 50 is the round guess. LOW is still a guess: red has not been seen yet. */
export const LOW = 20;
export const HIGH = 50;

export type PowerColour = "off" | "red" | "yellow" | "green";

export function levelColour(level: number): Exclude<PowerColour, "off"> {
  return level < LOW ? "red" : level < HIGH ? "yellow" : "green";
}

/** What the POWER lamp shows: off while disconnected (or before the first reading),
 *  otherwise the level's colour, blinking while charging. `powered` is the pedal's own
 *  "charging now" flag (0x11 / 90D9A098), which drops to 0 when charging stops even with
 *  the cable still in, exactly when the pedal's LED stops blinking. */
export function powerLamp(s: { connected: boolean; level: number; powered: boolean }): {
  colour: PowerColour;
  blink: boolean;
} {
  if (!s.connected || s.level < 0) return { colour: "off", blink: false };
  return { colour: levelColour(s.level), blink: s.powered };
}

/** The colours the drawn lamp uses. */
export const POWER_RGB: Record<PowerColour, Colour> = {
  off: { r: 0, g: 0, b: 0 },
  red: { r: 255, g: 30, b: 20 },
  yellow: { r: 255, g: 190, b: 0 },
  green: { r: 40, g: 255, b: 90 },
};
