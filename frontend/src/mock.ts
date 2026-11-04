import type { Backend } from "./api";
import { defaultConfig, type Op, validate } from "./lib/config";
import { expValue, RAW_MAX } from "./lib/exp";
import { describeMidi } from "./lib/midi";
import type { Action, Activity, BleState, Colour, Config, Device, State, Status } from "./types";
import { LAMP_AMP, LAMP_APP, SWITCHES } from "./types";

// A SIMULATED SPARK CONTROL X, for developing the UI in a plain browser.
//
// The simulator is a pure function of (seed, elapsed time): `step(dt)` advances it and
// returns the MIDI it "sent", so two sims with the same seed behave identically (there
// is a test). The backend below drives it from a timer and speaks the Backend interface.

/** mulberry32: small, fast, good enough to look random. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimOptions {
  seed?: number;
  /** Pin the connection state instead of walking searching -> connecting -> connected. */
  fixedState?: BleState;
  /** Which jacks have a cable. */
  cables?: [boolean, boolean];
  /** Switches held for good (bit mask), for screenshots. */
  holdMask?: number;
  /** Whether to press switches by itself. */
  autoPress?: boolean;
  epoch?: number;
}

const DARK: Colour = { r: 0, g: 0, b: 0 };
const scale = (c: Colour, pct: number): Colour => ({
  r: Math.round((c.r * pct) / 100),
  g: Math.round((c.g * pct) / 100),
  b: Math.round((c.b * pct) / 100),
});

export function createSim(opts: SimOptions = {}) {
  const rand = rng(opts.seed ?? 7);
  const epoch = opts.epoch ?? 0;
  let t = 0;
  let config: Config = defaultConfig();
  config.pedal = { address: "4F1A-SPARKX-MOCK", name: "SparkX v4.1.23 fbfc" };
  config.switches[2].tap.mode = "toggle";
  config.switches[5].long = { kind: "pc", channel: 1, number: 4, value: 127, mode: "momentary" };
  config.combos = [
    { a: 0, b: 1, action: { kind: "cc", channel: 1, number: 100, value: 127, mode: "momentary" } },
  ];

  const cables = opts.cables ?? [true, false];
  const raw = [21000, -1];
  const rawTarget = [40000, 30000];
  const lastExpSent = [-1, -1];
  let lastExpAt = [0, 0];

  let held = opts.holdMask ?? 0;
  const pressedAt: number[] = Array(SWITCHES).fill(0);
  const longFired: boolean[] = Array(SWITCHES).fill(false);
  const toggled: boolean[] = Array(SWITCHES).fill(false);
  const feedbackOn: boolean[] = Array(SWITCHES).fill(false);
  let nextPress = 1800;
  let release: { sw: number; at: number } | null = null;
  const echoes: { at: number; bytes: number[] }[] = [];
  let connectedAt = opts.fixedState ? 0 : 2000;
  let connState: BleState = opts.fixedState ?? "searching";

  const out: Activity[] = [];
  const emit = (dir: Activity["dir"], bytes: number[]) => {
    out.push({ dir, bytes, label: describeMidi(bytes), at: epoch + t });
    if (dir === "out" && config.ledMode === "feedback" && bytes[0] >> 4 !== 0xc) {
      echoes.push({ at: t + 25, bytes });
    }
  };

  function down(sw: number, a: Action) {
    const ch = (a.channel - 1) & 15;
    if (a.kind === "cc") {
      if (a.mode === "toggle") {
        toggled[sw] = !toggled[sw];
        emit("out", [0xb0 | ch, a.number, toggled[sw] ? a.value : 0]);
      } else emit("out", [0xb0 | ch, a.number, a.value]);
    } else if (a.kind === "note") emit("out", [0x90 | ch, a.number, a.value]);
    else if (a.kind === "pc") emit("out", [0xc0 | ch, a.number]);
  }
  function up(a: Action) {
    const ch = (a.channel - 1) & 15;
    if (a.kind === "cc" && a.mode === "momentary") emit("out", [0xb0 | ch, a.number, 0]);
    else if (a.kind === "note") emit("out", [0x80 | ch, a.number, 0]);
  }

  function press(sw: number) {
    held |= 1 << sw;
    pressedAt[sw] = t;
    longFired[sw] = false;
    const s = config.switches[sw];
    if (s.long.kind === "off") down(sw, s.tap);
  }
  function unpress(sw: number) {
    held &= ~(1 << sw);
    const s = config.switches[sw];
    if (s.long.kind === "off") up(s.tap);
    else if (longFired[sw]) up(s.long);
    else {
      down(sw, s.tap);
      up(s.tap);
    }
  }

  function step(dt: number): Activity[] {
    out.length = 0;
    t += dt;
    if (!opts.fixedState) {
      if (connState === "searching" && t > 1100) connState = "connecting";
      if (connState === "connecting" && t > connectedAt) connState = "connected";
    }
    const live = connState === "connected";
    if (live && opts.autoPress !== false) {
      if (!release && t >= nextPress) {
        const sw = Math.floor(rand() * SWITCHES);
        const long = config.switches[sw].long.kind !== "off" && rand() < 0.5;
        press(sw);
        const dur = long ? config.longPressMs + 300 : 140 + rand() * 520;
        release = { sw, at: t + dur };
      }
      if (release && t >= release.at) {
        unpress(release.sw);
        release = null;
        nextPress = t + 900 + rand() * 2600;
      }
    }
    for (let sw = 0; sw < SWITCHES; sw++) {
      const s = config.switches[sw];
      if (
        held & (1 << sw) &&
        s.long.kind !== "off" &&
        !longFired[sw] &&
        t - pressedAt[sw] >= config.longPressMs
      ) {
        longFired[sw] = true;
        down(sw, s.long);
      }
    }
    while (echoes.length && echoes[0].at <= t) {
      const e = echoes.shift()!;
      emit("in", e.bytes);
      const st = e.bytes[0] >> 4;
      config.switches.forEach((s, sw) => {
        const want = s.tap.kind === "cc" ? 0xb : s.tap.kind === "note" ? 0x9 : -1;
        const isNoteOff = st === 0x8 && s.tap.kind === "note";
        if (
          (st === want || isNoteOff) &&
          (e.bytes[0] & 15) === s.tap.channel - 1 &&
          e.bytes[1] === s.tap.number
        ) {
          feedbackOn[sw] = !isNoteOff && (e.bytes[2] ?? 0) > 0;
        }
      });
    }
    // Expression: a slow walk toward a target that moves now and then, plus jitter.
    for (let n = 0; n < 2; n++) {
      if (!live || !cables[n]) {
        raw[n] = -1;
        continue;
      }
      if (raw[n] < 0) raw[n] = rawTarget[n];
      if (rand() < dt / 9000) rawTarget[n] = Math.floor(rand() * RAW_MAX);
      raw[n] += (rawTarget[n] - raw[n]) * Math.min(1, dt / 500) + (rand() - 0.5) * 120;
      raw[n] = Math.round(Math.min(RAW_MAX, Math.max(0, raw[n])));
      const x = config.exp[n];
      if (x.enabled && t - lastExpAt[n] >= 90) {
        const v = expValue(raw[n], x) ?? 0;
        if (Math.abs(v - lastExpSent[n]) >= 2) {
          lastExpSent[n] = v;
          lastExpAt = lastExpAt.map((a, i) => (i === n ? t : a));
          emit("out", [0xb0 | ((x.channel - 1) & 15), x.cc, v]);
        }
      }
    }
    return [...out];
  }

  function status(): Status {
    const live = connState === "connected";
    const lamps: Colour[] = Array.from({ length: 8 }, () => DARK);
    if (live) {
      for (let sw = 0; sw < SWITCHES; sw++) {
        const s = config.switches[sw];
        const on =
          config.ledMode === "feedback"
            ? feedbackOn[sw]
            : (held & (1 << sw)) !== 0 ||
              (s.tap.kind === "cc" && s.tap.mode === "toggle" && toggled[sw]);
        lamps[sw] = on ? scale(s.colour, config.brightness) : DARK;
      }
      lamps[LAMP_AMP] = scale({ r: 0, g: 255, b: 0 }, config.brightness);
      lamps[LAMP_APP] = scale({ r: 0, g: 40, b: 255 }, config.brightness);
    }
    const detail: Record<BleState, string> = {
      off: "Bluetooth is off",
      idle: "Not looking for a pedal",
      searching: "Looking for a Spark Control X",
      connecting: "Connecting to SparkX v4.1.23 fbfc",
      connected: "Connected",
    };
    return {
      state: connState,
      detail: detail[connState],
      name: live || connState === "connecting" ? config.pedal.name || "SparkX v4.1.23 fbfc" : "",
      address: live ? config.pedal.address : "",
      firmware: live ? "4.1.23" : "",
      profile: live ? 2 : -1,
      profileName: live ? "Live Set" : "",
      battery: live ? 76 : -1,
      cables: live ? [...cables] : [false, false],
      exp: raw.map((r, n) => (r < 0 ? -1 : lastExpSent[n])),
      held: live ? held : 0,
      lamps,
      expRaw: [...raw],
    };
  }

  return {
    step,
    status,
    get config() {
      return config;
    },
    setConfig(c: Config) {
      config = structuredClone(c);
    },
    reconnect() {
      if (opts.fixedState) return;
      connState = "connecting";
      connectedAt = t + 900;
      held = 0;
    },
    forget() {
      config = { ...config, pedal: { address: "", name: "" } };
    },
    calibrate(n: number, edge: "min" | "max") {
      const r = raw[n];
      if (r < 0) throw new Error(`EXP ${n + 1} has no cable`);
      const next = structuredClone(config);
      next.exp[n][edge] = r;
      // Like App.CalibrateExp: heel and toe stay as set, in either order, but not equal.
      if (next.exp[n].min === next.exp[n].max) {
        throw new Error("heel and toe read the same value; move the pedal and try again");
      }
      config = next;
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Edits to replay on load (?demo=...), so the history and the save status can be
 *  screenshotted without clicking: "history" makes a few changes and undoes the last
 *  two; "invalid" ends on a config that does not validate. */
export function demoScript(name: string): (Op | "undo")[] {
  const edits: Op[] = [
    { type: "tap", sw: 1, patch: { kind: "note", number: 60 } },
    { type: "colour", sw: 0, colour: { r: 0, g: 255, b: 0 } },
    { type: "tap", sw: 3, patch: { mode: "toggle" } },
    { type: "addCombo" },
    { type: "longPressMs", value: 650 },
    { type: "ledMode", mode: "feedback" },
  ];
  if (name === "history") return [...edits, "undo", "undo"];
  if (name === "invalid")
    return [...edits.slice(0, 2), { type: "combo", index: 0, patch: { b: 0 } }];
  return [];
}

/** The Backend over a running simulator. URL parameters shape it for screenshots:
 *  ?state=off|searching|connecting|connected, ?seed=N, ?hold=I,A (switch names),
 *  ?cables=11 (exp1, exp2), ?midi=error, ?still (no automatic presses), ?save=error
 *  (every save is refused). See also demoScript (?demo=). */
export function createMockBackend(q: URLSearchParams): Backend {
  const names = ["I", "II", "A", "III", "IV", "B"];
  const holdMask = (q.get("hold") ?? "")
    .split(",")
    .map((s) => names.indexOf(s.trim()))
    .filter((i) => i >= 0)
    .reduce((m, i) => m | (1 << i), 0);
  const cablesQ = q.get("cables");
  const sim = createSim({
    seed: Number(q.get("seed") ?? 7),
    fixedState: (q.get("state") as BleState | null) ?? undefined,
    cables: cablesQ ? [cablesQ[0] === "1", cablesQ[1] === "1"] : undefined,
    holdMask,
    autoPress: !q.has("still"),
    epoch: Date.now(),
  });
  let launchAtLogin = false;
  const midiError = q.get("midi") === "error";
  const saveError = q.get("save") === "error";
  const stateCbs = new Set<(s: State) => void>();
  const actCbs = new Set<(a: Activity) => void>();

  const state = (): State => ({
    pedal: sim.status(),
    config: structuredClone(sim.config),
    midi: midiError
      ? {
          source: "Spark Control X",
          dest: "Spark Control X LEDs",
          ok: false,
          error: "MIDIClientCreate failed (-10830)",
        }
      : { source: "Spark Control X", dest: "Spark Control X LEDs", ok: true, error: "" },
    launchAtLogin,
    version: "0.1.0-dev",
  });

  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const acts = sim.step(now - last);
    last = now;
    for (const a of acts) for (const cb of actCbs) cb(a);
    const s = state();
    for (const cb of stateCbs) cb(s);
  }, 50);

  return {
    GetState: async () => state(),
    SaveConfig: async (cfg) => {
      await sleep(120);
      if (saveError) throw new Error("could not write config.json: read-only file system");
      const err = validate(cfg);
      if (err) throw new Error(err);
      sim.setConfig(cfg);
    },
    ResetConfig: async () => {
      const c = defaultConfig();
      c.pedal = sim.config.pedal;
      sim.setConfig(c);
      return structuredClone(c);
    },
    Scan: async (): Promise<Device[]> => {
      await sleep(1600);
      return [
        { name: "SparkX v4.1.23 fbfc", address: "4F1A-SPARKX-MOCK", rssi: -48, system: true },
        { name: "SparkX v4.1.20 a01e", address: "9C02-SPARKX-MOCK", rssi: -77, system: false },
      ];
    },
    ChoosePedal: async (address, name) => {
      sim.setConfig({ ...sim.config, pedal: { address, name } });
      sim.reconnect();
    },
    ForgetPedal: async () => sim.forget(),
    CalibrateExp: async (n, edge) => {
      sim.calibrate(n, edge);
      return structuredClone(sim.config);
    },
    SetLaunchAtLogin: async (on) => {
      launchAtLogin = on;
    },
    RevealLogs: async () => {
      console.info("[mock] RevealLogs");
    },
    onState: (cb) => {
      stateCbs.add(cb);
      return () => stateCbs.delete(cb);
    },
    onActivity: (cb) => {
      actCbs.add(cb);
      return () => actCbs.delete(cb);
    },
  };
}
