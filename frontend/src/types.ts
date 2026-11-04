// The JSON shapes from docs/CONTRACTS.md. Field names are the Go json tags.

export type ActionKind = "off" | "cc" | "note" | "pc";
export type CCMode = "momentary" | "toggle";

export interface Action {
  kind: ActionKind;
  channel: number; // 1..16
  number: number; // CC number, note number or program 0..127
  value: number; // CC "on" value / note velocity 1..127
  mode: CCMode; // cc only
}

export interface Colour {
  r: number;
  g: number;
  b: number;
}

export interface SwitchConfig {
  tap: Action;
  long: Action; // kind "off" = no long press
  colour: Colour;
}

export interface Combo {
  a: number; // switch index 0..5
  b: number;
  action: Action;
}

export interface ExpConfig {
  enabled: boolean;
  channel: number;
  cc: number;
  min: number; // raw 0..65535 at the heel
  max: number; // raw 0..65535 at the toe; may be below min (toe reads lower), never equal
  invert: boolean; // the user's own flip, on top of heel=0 toe=127
}

export type LEDMode = "local" | "feedback";

/** What lights the Amp or App lamp (mapping.IndicatorMode). */
export type IndicatorMode = "off" | "connected" | "midiOut" | "midiIn" | "usb" | "on";

export interface Indicator {
  mode: IndicatorMode;
  colour: Colour; // the colour when lit
}

export interface PedalRef {
  address: string;
  name: string;
}

export interface Config {
  version: number;
  pedal: PedalRef;
  switches: SwitchConfig[]; // 6
  combos: Combo[];
  exp: ExpConfig[]; // 2
  ledMode: LEDMode;
  longPressMs: number;
  brightness: number; // 0..100
  indicators: Indicator[]; // 2: Amp, App
}

export type BleState = "off" | "idle" | "searching" | "connecting" | "connected";

/** ble.Status, with sparkx.Status embedded (flattened in JSON). */
export interface Status {
  state: BleState;
  detail: string;
  name: string;
  address: string;
  firmware: string;
  profile: number; // -1 until read
  profileName: string;
  battery: number; // 0..100, -1 until read
  powered: boolean; // on USB power; charging = powered && battery < 100
  cables: boolean[]; // 2
  exp: number[]; // 0..127 per input, -1 = none
  held: number; // switch bitmask
  lamps: Colour[]; // 8: six switches, then Amp (6), App (7)
  expRaw: number[]; // 2, -1 = none
}

export interface Midi {
  source: string;
  dest: string;
  ok: boolean;
  error: string;
}

export interface State {
  pedal: Status;
  config: Config;
  midi: Midi;
  launchAtLogin: boolean;
  version: string;
  presets: PresetInfo[];
  activePreset: string; // the id of the preset that runs
  libraryError: string; // what went wrong opening the preset library, "" = nothing
}

/** presets.Info: a preset as the picker lists it. */
export interface PresetInfo {
  id: string;
  name: string;
  updatedAt: number; // unix milliseconds
  active: boolean;
}

/** What a new preset starts from: a copy of the active one, or the default mapping. */
export type PresetSource = "current" | "default";

export interface Device {
  name: string;
  address: string;
  rssi: number;
  system: boolean;
}

export interface Activity {
  dir: "out" | "in";
  bytes: number[];
  label: string;
  at: number; // unix milliseconds
}

export type ExpEdge = "min" | "max";

export const SWITCH_NAMES = ["I", "II", "A", "III", "IV", "B"] as const;
export const SWITCHES = 6;
export const LAMP_AMP = 6;
export const LAMP_APP = 7;
/** Config.indicators[0] is the Amp lamp, [1] the App lamp. */
export const INDICATOR_NAMES = ["AMP", "APP"] as const;
export type IndicatorIndex = 0 | 1;
