import type { Colour, Indicator, IndicatorMode } from "../types";

// THE AMP AND APP LAMPS: mapping.Indicator's modes, in words for the editor, and the
// rule that lights them (mapping.IndicatorLamps), for the browser mock.

export const INDICATOR_MODES: { value: IndicatorMode; label: string; hint: string }[] = [
  { value: "off", label: "Off", hint: "Never lit." },
  { value: "connected", label: "Connected", hint: "Lit while SparkX MIDI holds the pedal." },
  {
    value: "midiOut",
    label: "MIDI out",
    hint: "Flashes each time the pedal sends MIDI to your apps.",
  },
  {
    value: "midiIn",
    label: "MIDI in",
    hint: "Flashes each time MIDI arrives on the LED feedback port.",
  },
  { value: "usb", label: "USB power", hint: "Lit while a USB cable powers the pedal." },
  { value: "on", label: "Always on", hint: "Always lit." },
];

export const modeLabel = (m: IndicatorMode): string =>
  INDICATOR_MODES.find((x) => x.value === m)?.label ?? m;

/** mapping.defaultIndicators: Amp flashes green with MIDI out, App is indigo while
 *  connected. */
export const DEFAULT_INDICATORS: Indicator[] = [
  { mode: "midiOut", colour: { r: 0x00, g: 0xb0, b: 0x50 } },
  { mode: "connected", colour: { r: 0x40, g: 0x20, b: 0xff } },
];

/** What the stock pedal uses each lamp for, for the editor's note. */
export const STOCK_USE = [
  "On the stock pedal, AMP shows the link to a Spark amp.",
  "On the stock pedal, APP shows the link to the Spark app.",
];

/** bridge.flashFor: a MIDI flash stays lit this long after the last message. */
export const FLASH_MS = 120;

export interface IndicatorInputs {
  connected: boolean;
  powered: boolean;
  now: number; // ms
  lastOut: number; // ms of the last MIDI out
  lastIn: number; // ms of the last MIDI in
}

export function indicatorLit(mode: IndicatorMode, s: IndicatorInputs): boolean {
  switch (mode) {
    case "connected":
      return s.connected;
    case "midiOut":
      return s.now - s.lastOut < FLASH_MS;
    case "midiIn":
      return s.now - s.lastIn < FLASH_MS;
    case "usb":
      return s.powered;
    case "on":
      return true;
    default:
      return false;
  }
}

export const isIndicatorMode = (m: string): m is IndicatorMode =>
  INDICATOR_MODES.some((x) => x.value === m);

export const copyIndicators = (xs: Indicator[]): Indicator[] =>
  xs.map((x) => ({ mode: x.mode, colour: { ...x.colour } as Colour }));
