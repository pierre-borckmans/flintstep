import type { Colour, Config, PedalRef, Status } from "../types";
import { LAMP_AMP, LAMP_APP } from "../types";

// WHAT THE PEDAL VIEWER SAYS ABOUT THE LINK. Pure: a status (and the remembered pedal) in,
// the overlay's words, rings and buttons out. LinkOverlay draws it.

/** System Settings > Bluetooth. Wails' BrowserOpenURL hands it to `open`. */
export const BLUETOOTH_SETTINGS = "x-apple.systempreferences:com.apple.Bluetooth";

export type LinkActionId = "scan" | "forget" | "bluetooth" | "connect";

export interface LinkAction {
  id: LinkActionId;
  label: string;
  /** The one to press is primary; the rest are plain or ghost. */
  kind: "primary" | "plain" | "ghost";
}

/** expand: sonar going out from the pedal (searching); converge: closing in on it
 *  (connecting); none: no rings at all. */
export type Rings = "none" | "expand" | "converge";

export type LinkTone = "searching" | "connecting" | "off" | "idle";

export interface LinkView {
  /** false when connected, or before the first status arrives. */
  visible: boolean;
  tone: LinkTone;
  rings: Rings;
  title: string;
  /** Go's own words for what is happening now ("Not found, trying again in 4 s"), or ""
   *  when they would only repeat the title. */
  detail: string;
  /** The remembered pedal's name, "" for "any Spark Control X". */
  pedal: string;
  hint: string;
  actions: LinkAction[];
}

const HIDDEN: LinkView = {
  visible: false,
  tone: "idle",
  rings: "none",
  title: "",
  detail: "",
  pedal: "",
  hint: "",
  actions: [],
};

/** Go says "Looking for X" while it scans and "Connecting to X" while it dials: the
 *  title already says both, so those lines are dropped. Anything else (a retry
 *  countdown, a lost link) is news and is shown as it is. */
function news(detail: string): string {
  const d = detail.trim();
  return /^(looking for|connecting to)\b/i.test(d) ? "" : d;
}

export function linkView(status: Status | null, remembered: PedalRef): LinkView {
  if (!status || status.state === "connected") return HIDDEN;
  const pedal = remembered.name || (remembered.address ? remembered.address : "");
  const scan: LinkAction = { id: "scan", label: "Scan for pedals", kind: "plain" };
  const forget: LinkAction = { id: "forget", label: "Forget pedal", kind: "ghost" };
  const known = remembered.address !== "" || remembered.name !== "";

  switch (status.state) {
    case "searching": {
      const title = "Looking for your Spark Control X…";
      return {
        visible: true,
        tone: "searching",
        rings: "expand",
        title,
        detail: news(status.detail),
        pedal,
        hint: "Turn the pedal on, and close the Spark app if it's connected.",
        actions: known ? [scan, forget] : [scan],
      };
    }
    case "connecting": {
      const name = status.name || remembered.name || "your Spark Control X";
      const title = `Connecting to ${name}…`;
      return {
        visible: true,
        tone: "connecting",
        rings: "converge",
        title,
        detail: news(status.detail),
        pedal: "",
        hint: "",
        actions: [],
      };
    }
    case "off": {
      const d = status.detail.trim();
      const title = d || "Bluetooth is off";
      return {
        visible: true,
        tone: "off",
        rings: "none",
        title,
        detail: "",
        pedal,
        hint: "SparkX MIDI reaches the pedal over Bluetooth. Turn it on, or allow SparkX MIDI under Privacy & Security.",
        actions: [{ id: "bluetooth", label: "Open Bluetooth settings", kind: "primary" }],
      };
    }
    default: {
      return {
        visible: true,
        tone: "idle",
        rings: "none",
        title: "Not connected",
        detail: news(status.detail),
        pedal,
        hint: "The app is not looking for the pedal right now.",
        actions: known
          ? [{ id: "connect", label: "Connect", kind: "primary" }, scan]
          : [{ ...scan, kind: "primary" }],
      };
    }
  }
}

// THE POWER-UP SWEEP. When the link comes up the LEDs light once, left to right, in their
// own colours: purely drawn, nothing goes to the pedal.

/** How long the sweep runs, first light to last dark (ms). */
export const SWEEP_MS = 760;
/** How long each lamp stays lit (ms). */
const SWEEP_LIT = 240;

/** Each lamp's place across the face, 0 left to 1 right (Pedal.tsx's REF table): the
 *  columns I/III, II/IV, A/B and, between the last two, AMP and APP. */
const SWEEP_AT: [number, number][] = [
  [0, 0],
  [3, 0],
  [1, 0.5],
  [4, 0.5],
  [LAMP_AMP, 0.747],
  [LAMP_APP, 0.811],
  [2, 0.935],
  [5, 0.935],
];

const SWEEP_LAST = SWEEP_AT[SWEEP_AT.length - 1][1];

const WHITE: Colour = { r: 230, g: 240, b: 248 };

/** The lamps t ms into the sweep: each lights in turn in its configured colour (a switch
 *  set to black lights white, or nothing would show), on top of what the pedal shows.
 *  Past SWEEP_MS, or before 0, it is `base` untouched. */
export function sweepLamps(t: number, base: Colour[], config: Config | null): Colour[] {
  if (t < 0 || t >= SWEEP_MS) return base;
  const out = Array.from({ length: 8 }, (_, i) => base[i] ?? { r: 0, g: 0, b: 0 });
  const span = SWEEP_MS - SWEEP_LIT;
  for (const [lamp, x] of SWEEP_AT) {
    const start = (x / SWEEP_LAST) * span;
    if (t < start || t >= start + SWEEP_LIT) continue;
    const c =
      lamp < 6 ? config?.switches[lamp]?.colour : config?.indicators[lamp - LAMP_AMP]?.colour;
    out[lamp] = c && c.r + c.g + c.b > 0 ? c : WHITE;
  }
  return out;
}
