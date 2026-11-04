// THE POWER LED. The pedal's own POWER lamp takes its colour from the charge level and
// blinks while charging. The drawn pedal and the header battery mirror it.

import type { Colour } from "../types";

/** Below LOW the lamp is red, from LOW to HIGH yellow, from HIGH green. GUESSES: on
 *  hardware only yellow at ~30 % has been seen. Confirm both on a real pedal. */
export const LOW = 20;
export const HIGH = 80;

export type PowerColour = "off" | "red" | "yellow" | "green";

export function levelColour(level: number): Exclude<PowerColour, "off"> {
  return level < LOW ? "red" : level < HIGH ? "yellow" : "green";
}

/** What the POWER lamp shows: off while disconnected (or before the first reading),
 *  otherwise the level's colour, blinking while charging (USB power below 100 %). */
export function powerLamp(s: { connected: boolean; level: number; powered: boolean }): {
  colour: PowerColour;
  blink: boolean;
} {
  if (!s.connected || s.level < 0) return { colour: "off", blink: false };
  return { colour: levelColour(s.level), blink: s.powered && s.level < 100 };
}

/** The colours the drawn lamp uses. */
export const POWER_RGB: Record<PowerColour, Colour> = {
  off: { r: 0, g: 0, b: 0 },
  red: { r: 255, g: 30, b: 20 },
  yellow: { r: 255, g: 190, b: 0 },
  green: { r: 40, g: 255, b: 90 },
};
