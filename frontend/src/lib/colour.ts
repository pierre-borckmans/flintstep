import type { Colour } from "../types";

const hex2 = (n: number) =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, "0");

export function toHex(c: Colour): string {
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
}

export function fromHex(h: string): Colour | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return null;
  const v = Number.parseInt(m[1], 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

export const isDark = (c: Colour | undefined) => !c || (c.r === 0 && c.g === 0 && c.b === 0);

export const sameColour = (a: Colour, b: Colour) => a.r === b.r && a.g === b.g && a.b === b.b;

export const rgb = (c: Colour, alpha = 1) => `rgb(${c.r} ${c.g} ${c.b} / ${alpha})`;

/** A lamp colour lifted for the screen. The pedal's LEDs are dimmed by scaling the
 *  colour (brightness), and a dimmed red on a monitor reads as brown rather than as a
 *  dim red light, so keep the hue at full value and return the dimming separately. */
export function lampLight(c: Colour): { colour: Colour; level: number } {
  const peak = Math.max(c.r, c.g, c.b);
  if (peak === 0) return { colour: c, level: 0 };
  const k = 255 / peak;
  return { colour: { r: c.r * k, g: c.g * k, b: c.b * k }, level: peak / 255 };
}

/** Curated LED colours: what the ring's RGB LEDs render cleanly. */
export const SWATCHES: { name: string; colour: Colour }[] = [
  { name: "Red", colour: { r: 255, g: 0, b: 0 } },
  { name: "Orange", colour: { r: 255, g: 72, b: 0 } },
  { name: "Yellow", colour: { r: 255, g: 190, b: 0 } },
  { name: "Green", colour: { r: 0, g: 255, b: 0 } },
  { name: "Cyan", colour: { r: 0, g: 220, b: 255 } },
  { name: "Blue", colour: { r: 0, g: 40, b: 255 } },
  { name: "Purple", colour: { r: 150, g: 0, b: 255 } },
  { name: "Pink", colour: { r: 255, g: 0, b: 140 } },
  { name: "White", colour: { r: 255, g: 255, b: 255 } },
];
