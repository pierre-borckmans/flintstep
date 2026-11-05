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
  curve: ExpCurve; // how the travel bends on its way out
  trigger: ExpTrigger;
}

/** mapping.CurveKind. */
export type CurveKind = "linear" | "gentle" | "fast" | "s" | "custom";

/** mapping.CurvePoint: a point a Custom curve passes through (travel x, output y, 0..1). */
export interface CurvePoint {
  x: number;
  y: number;
}

/** mapping.ExpCurve. amount shapes "custom" without points, -1..1 (0 linear, >0 gentle,
 *  <0 fast). strength (0..1) and centre (0.1..0.9) shape "s"; both absent or 0 is the
 *  default S (0.6, 0.5). points shape "custom" when present. */
export interface ExpCurve {
  kind: CurveKind;
  amount: number;
  strength?: number;
  centre?: number;
  points?: CurvePoint[];
}

/** mapping.TriggerMode: "engage" is auto-engage (leave the heel), "toe" a toe click. */
export type TriggerMode = "off" | "engage" | "toe";

/** mapping.ExpTrigger: a switch faked from the pedal's position. */
export interface ExpTrigger {
  mode: TriggerMode;
  action: Action; // press half on engaging, release half on letting go
  threshold: number; // percent of the calibrated travel, 1..99
  offDelayMs: number; // engage only, 0..2000
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

/** sparkx.ModelInfo: "spark-control-x", "reactor-control" or "compatible" (an AirTurn-based
 *  pedal recognised by its services). id "" = not known. */
export interface PedalModel {
  id: string;
  name: string;
}

/** ble.Status, with sparkx.Status embedded (flattened in JSON). */
export interface Status {
  state: BleState;
  detail: string;
  name: string;
  address: string;
  /** The model of the pedal connected, being connected to, or remembered. */
  model: PedalModel;
  firmware: string;
  profile: number; // -1 until read
  profileName: string;
  battery: number; // 0..100, -1 until read
  powered: boolean; // the pedal's "charging now" flag (not "USB connected")
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
  expTrigger: boolean[]; // 2: each input's trigger engaged now
  /** 2: each input's simulated pedal is on; pedal.cables/expRaw then report it. */
  expSim: boolean[];
  /** 2: each simulated pedal is sweeping heel to toe on its own. */
  expSweep: boolean[];
  /** 2: each input's calibration sweep (bridge.Capture). */
  expCapture: Capture[];
}

/** bridge.Capture: a calibration sweep as it stands. Times are unix ms. */
export interface Capture {
  on: boolean;
  /** The lowest and highest values seen, -1 before any value. */
  low: number;
  high: number;
  /** The plain extremes, -1 before any value. */
  rawLow: number;
  rawHigh: number;
  samples: number;
  /** Turns back once the span is wide enough to count. */
  reversals: number;
  /** Wide enough and turned back: at rest it can end. */
  ready: boolean;
  startedAt: number;
  movedAt: number;
  extremeAt: number;
}

/** bridge.SweepResult: a finished sweep, extremes as kept and heel/toe inset. */
export interface SweepResult {
  low: number;
  high: number;
  heel: number;
  toe: number;
}

/** One raw value and when it came (unix ms). */
export interface RawSample {
  t: number;
  v: number;
}

/** The "expraw" event: each input's raw values since the last one, oldest first. */
export interface ExpRawEvent {
  samples: RawSample[][];
}

/** The "expwiden" event: Go proposes widening input n's range to low..high. */
export interface ExpWiden {
  n: number;
  low: number;
  high: number;
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
  model: PedalModel;
  /** false: listed because it advertises the switch or BLE-MIDI service under an unknown
   *  name. Connecting tells whether it is a pedal. */
  verified: boolean;
}

/** mapping.Source: what produced a message. "release" is a release forced by a
 *  disconnect or a cable coming out; "feedback" is MIDI in from the LED port. */
export type ActivitySource =
  | "switch"
  | "long"
  | "combo"
  | "exp"
  | "trigger"
  | "feedback"
  | "release";

export interface Activity {
  dir: "out" | "in";
  bytes: number[];
  label: string;
  at: number; // unix milliseconds
  source: ActivitySource;
  /** The switch 0..5, expression input 0..1 or combo index; -1 for none. */
  index: number;
  /** A combo's two switches. */
  pair: [number, number];
  /** For "release": what it lets go of ("switch" | "long" | "combo" | "trigger"). */
  of?: ActivitySource;
}

export type ExpEdge = "min" | "max";

export const SWITCH_NAMES = ["I", "II", "A", "III", "IV", "B"] as const;
export const SWITCHES = 6;
export const LAMP_AMP = 6;
export const LAMP_APP = 7;
/** Config.indicators[0] is the Amp lamp, [1] the App lamp. */
export const INDICATOR_NAMES = ["AMP", "APP"] as const;
export type IndicatorIndex = 0 | 1;
