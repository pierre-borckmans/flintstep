import type { Backend } from "./api";
import { cc, defaultConfig, mappingOf, type Op, validate } from "./lib/config";
import { expFraction, expValue, RAW_MAX } from "./lib/exp";
import { fractionRaw, sweepFraction, sweepOffset } from "./lib/expsim";
import { indicatorLit } from "./lib/indicators";
import { describeMidi } from "./lib/midi";
import { pedalLabel } from "./lib/pedalname";
import {
  checkName,
  copyName,
  decodePreset,
  encodePreset,
  exportFileName,
  uniqueName,
} from "./lib/presets";
import { idleTrigger, pickMode, stepTrigger, type TriggerState, triggerLit } from "./lib/trigger";
import { MIDI_LED_PORT_NAME, MIDI_PORT_NAME } from "./product";
import type {
  Action,
  Activity,
  BleState,
  Colour,
  Config,
  Device,
  PedalModel,
  PresetInfo,
  PresetSource,
  State,
  Status,
  TriggerMode,
} from "./types";
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
  /** Walk searching -> connecting -> connected -> (lost) searching for ever, every few
   *  seconds, so the link's transitions can be watched. */
  cycle?: boolean;
  /** Which jacks have a cable. */
  cables?: [boolean, boolean];
  /** Switches held for good (bit mask), for screenshots. */
  holdMask?: number;
  /** Whether to press switches by itself. */
  autoPress?: boolean;
  /** Pin USB power on or off; unset, the cable goes in at 10 s and out at 30 s of
   *  every 40 s. */
  powered?: boolean;
  epoch?: number;
  /** The expression triggers' modes; unset, input 1 auto-engages and input 2 is off. */
  triggers?: [TriggerMode, TriggerMode];
  /** Pin each pedal at a travel percent instead of sweeping it (null: sweep). */
  expAt?: [number | null, number | null];
  /** Start each input's simulated pedal (bridge/sim.go) at a travel percent of the jack,
   *  or sweeping; null leaves it off. */
  simAt?: [SimStart, SimStart];
}

/** How a simulated pedal starts: at a percent of the jack's range, or sweeping. */
export type SimStart = number | "sweep" | null;

/** ?cycle: one round of searching, connecting and connected (ms). */
const CYCLE_MS = 11600;

const DARK: Colour = { r: 0, g: 0, b: 0 };
const scale = (c: Colour, pct: number): Colour => ({
  r: Math.round((c.r * pct) / 100),
  g: Math.round((c.g * pct) / 100),
  b: Math.round((c.b * pct) / 100),
});

/** A foot on the pedal, as [ms, travel 0..1] keyframes over a 9 s loop: rest on the
 *  heel, rock in the middle, push to the toe stop and hold, a quick heel touch (shorter
 *  than the off delay, so auto-engage stays on), then back to rest. */
const SWEEP: [number, number][] = [
  [0, 0],
  [1500, 0],
  [2300, 0.55],
  [3000, 0.42],
  [3800, 0.7],
  [4500, 0.5],
  [5200, 1],
  [6200, 1],
  [6900, 0.3],
  [7150, 0],
  [7300, 0],
  [7800, 0.5],
  [8500, 0.15],
  [8800, 0],
  [9000, 0],
];

/** Where the foot has the pedal at time t (ms), 0 heel to 1 toe. */
export function sweep(t: number): number {
  const p = ((t % 9000) + 9000) % 9000;
  for (let i = 1; i < SWEEP.length; i++) {
    const [t1, f1] = SWEEP[i];
    const [t0, f0] = SWEEP[i - 1];
    if (p <= t1) return f0 + ((f1 - f0) * (p - t0)) / (t1 - t0);
  }
  return 0;
}

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
  const modes = opts.triggers ?? ["engage", "off"];
  config.exp.forEach((x, n) => {
    x.trigger = pickMode(x.trigger, modes[n], n);
  });

  const cables = opts.cables ?? [true, false];
  const raw = [21000, -1];
  const lastExpSent = [-1, -1];
  let lastExpAt = [0, 0];
  let trig: TriggerState[] = [idleTrigger(), idleTrigger()];
  // The simulated pedals, like the bridge's: on, where they are (0..1 of the jack), and
  // when a sweep was at the heel going up (null: not sweeping).
  const simOn = [false, false];
  const simFrac = [0, 0];
  const simFrom: (number | null)[] = [null, null];
  const simPos = (n: number) => {
    const from = simFrom[n];
    return from === null ? simFrac[n] : sweepFraction(t - from);
  };
  opts.simAt?.forEach((s, n) => {
    if (s === null) return;
    simOn[n] = true;
    if (s === "sweep") simFrom[n] = 0;
    else simFrac[n] = Math.min(1, Math.max(0, s / 100));
  });

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
  /** When the current searching spell began, and whether a lost link started it. */
  let searchFrom = 0;
  let lost = false;
  let powered = opts.powered ?? false;
  let battery = 76; // percent, fractional while it moves
  let lastOut = Number.NEGATIVE_INFINITY;
  let lastIn = Number.NEGATIVE_INFINITY;

  const out: Activity[] = [];
  /** What produced a message, as the bridge tags it (Activity.source...). */
  type Src = Pick<Activity, "source" | "index"> & Partial<Pick<Activity, "pair" | "of">>;
  const emit = (dir: Activity["dir"], bytes: number[], src: Src) => {
    out.push({ dir, bytes, label: describeMidi(bytes), at: epoch + t, pair: [0, 0], ...src });
    if (dir === "out") lastOut = t;
    else lastIn = t;
    // The DAW echoes what the switches send (a real one may, whatever the LED mode;
    // the bridge records it either way). Not the pedals' sweeps.
    const fromSwitch = src.source !== "exp" && src.source !== "trigger";
    if (dir === "out" && fromSwitch && bytes[0] >> 4 !== 0xc) {
      echoes.push({ at: t + 25, bytes });
    }
  };

  function down(sw: number, a: Action, src: Src) {
    const ch = (a.channel - 1) & 15;
    if (a.kind === "cc") {
      if (a.mode === "toggle") {
        toggled[sw] = !toggled[sw];
        emit("out", [0xb0 | ch, a.number, toggled[sw] ? a.value : 0], src);
      } else emit("out", [0xb0 | ch, a.number, a.value], src);
    } else if (a.kind === "note") emit("out", [0x90 | ch, a.number, a.value], src);
    else if (a.kind === "pc") emit("out", [0xc0 | ch, a.number], src);
  }
  function up(a: Action, src: Src) {
    const ch = (a.channel - 1) & 15;
    if (a.kind === "cc" && a.mode === "momentary") emit("out", [0xb0 | ch, a.number, 0], src);
    else if (a.kind === "note") emit("out", [0x80 | ch, a.number, 0], src);
  }

  // Expression triggers, sent like mapping.Engine sends them.
  function triggerDown(a: Action, on: boolean, n: number) {
    const ch = (a.channel - 1) & 15;
    const src: Src = { source: "trigger", index: n };
    if (a.kind === "cc")
      emit("out", [0xb0 | ch, a.number, a.mode === "toggle" && !on ? 0 : a.value], src);
    else if (a.kind === "note") emit("out", [0x90 | ch, a.number, a.value], src);
    else if (a.kind === "pc") emit("out", [0xc0 | ch, a.number], src);
  }
  /** Input n's trigger lets go: the cable came out or the link dropped (forced), or the
   *  config changed. */
  function letGo(n: number, forced = true) {
    if (!trig[n].held) return;
    trig[n] = { ...trig[n], held: false, due: null };
    up(
      config.exp[n].trigger.action,
      forced ? { source: "release", of: "trigger", index: n } : { source: "trigger", index: n },
    );
  }

  const tapSrc = (sw: number): Src => ({ source: "switch", index: sw });
  function press(sw: number) {
    held |= 1 << sw;
    pressedAt[sw] = t;
    longFired[sw] = false;
    const s = config.switches[sw];
    if (s.long.kind === "off") down(sw, s.tap, tapSrc(sw));
  }
  function unpress(sw: number) {
    held &= ~(1 << sw);
    const s = config.switches[sw];
    if (s.long.kind === "off") up(s.tap, tapSrc(sw));
    else if (longFired[sw]) up(s.long, { source: "long", index: sw });
    else {
      down(sw, s.tap, tapSrc(sw));
      up(s.tap, tapSrc(sw));
    }
  }
  /** The first combo pressed and let go, as the engine sends it. */
  /** The link dropped: like Engine.Reset, what a held switch sounds is let go. */
  function dropHeld() {
    for (let sw = 0; sw < SWITCHES; sw++) {
      if (!(held & (1 << sw))) continue;
      const s = config.switches[sw];
      const long = s.long.kind !== "off";
      if (!long || longFired[sw]) {
        up(long ? s.long : s.tap, { source: "release", of: long ? "long" : "switch", index: sw });
      }
    }
    held = 0;
    release = null;
  }
  const comboSrc = (): Src => {
    const k = config.combos[0];
    return { source: "combo", index: 0, pair: [k.a, k.b] };
  };

  function step(dt: number): Activity[] {
    out.length = 0;
    t += dt;
    if (opts.cycle && !opts.fixedState) {
      // 5 s searching, 1.6 s connecting, 5 s connected, then the link drops.
      const p = t % CYCLE_MS;
      const next: BleState = p < 5000 ? "searching" : p < 6600 ? "connecting" : "connected";
      if (next === "searching" && connState !== "searching") {
        searchFrom = t - p;
        lost = connState === "connected";
        dropHeld();
      }
      connState = next;
    } else if (!opts.fixedState) {
      if (connState === "searching" && t > 1100) connState = "connecting";
      if (connState === "connecting" && t > connectedAt) connState = "connected";
    }
    const live = connState === "connected";
    // USB power: charging a percent every 1.5 s, draining one a minute on battery.
    if (opts.powered === undefined) powered = t % 40000 >= 10000 && t % 40000 < 30000;
    battery = powered ? Math.min(100, battery + dt / 1500) : Math.max(0, battery - dt / 60000);
    if (live && opts.autoPress !== false) {
      if (!release && t >= nextPress) {
        const sw = Math.floor(rand() * SWITCHES);
        if (config.combos.length > 0 && rand() < 0.15) {
          // Now and then, both switches of the first combo at once.
          down(0, config.combos[0].action, comboSrc());
          release = { sw: -1, at: t + 200 };
        } else {
          const long = config.switches[sw].long.kind !== "off" && rand() < 0.5;
          press(sw);
          const dur = long ? config.longPressMs + 300 : 140 + rand() * 520;
          release = { sw, at: t + dur };
        }
      }
      if (release && t >= release.at) {
        if (release.sw < 0) up(config.combos[0].action, comboSrc());
        else unpress(release.sw);
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
        down(sw, s.long, { source: "long", index: sw });
      }
    }
    while (echoes.length && echoes[0].at <= t) {
      const e = echoes.shift()!;
      emit("in", e.bytes, { source: "feedback", index: -1 });
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
    // Expression: a foot rocking the pedal. It rests on the heel now and then, sweeps
    // to somewhere in the middle, or pushes to the toe stop, with a little jitter, so
    // the triggers visibly engage and let go.
    for (let n = 0; n < 2; n++) {
      const x = config.exp[n];
      const pin = opts.expAt?.[n];
      if (simOn[n]) {
        // Simulated: the jack's raw value is the simulated one, whatever the link does,
        // and it goes the same way as a real pedal's.
        raw[n] = fractionRaw(simPos(n));
      } else if (!live || !cables[n]) {
        raw[n] = -1;
        letGo(n);
        continue;
      } else if (pin !== undefined && pin !== null) {
        raw[n] = Math.round(x.min + ((x.max - x.min) * pin) / 100);
      } else {
        const f = sweep(t + n * 4000);
        raw[n] = x.min + (x.max - x.min) * f + (f > 0 && f < 1 ? (rand() - 0.5) * 120 : 0);
        raw[n] = Math.round(Math.min(RAW_MAX, Math.max(0, raw[n])));
      }
      const f = x.enabled ? expFraction(raw[n], x) : null;
      const r = stepTrigger(trig[n], x.trigger, f === null ? null : f * 100, t);
      trig[n] = r.state;
      if (r.release) up(x.trigger.action, { source: "trigger", index: n });
      if (r.press) triggerDown(x.trigger.action, r.state.on, n);
      if (x.enabled && t - lastExpAt[n] >= 90) {
        const v = expValue(raw[n], x) ?? 0;
        if (Math.abs(v - lastExpSent[n]) >= 2) {
          lastExpSent[n] = v;
          lastExpAt = lastExpAt.map((a, i) => (i === n ? t : a));
          emit("out", [0xb0 | ((x.channel - 1) & 15), x.cc, v], { source: "exp", index: n });
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
      const inputs = { connected: true, powered, now: t, lastOut, lastIn };
      [LAMP_AMP, LAMP_APP].forEach((lamp, n) => {
        const ind = config.indicators[n];
        lamps[lamp] =
          ind && indicatorLit(ind.mode, inputs) ? scale(ind.colour, config.brightness) : DARK;
      });
    }
    // Go's words: a scan, then a countdown to the next one (ble/loop.go).
    const model = mockModel(
      config.pedal.name || (live || connState === "connecting" ? MOCK_PEDAL : ""),
    );
    const label = pedalLabel(config.pedal.name, model);
    const since = t - searchFrom;
    const searching =
      lost && since < 1500
        ? "Connection lost, reconnecting"
        : since % 6000 < 2000
          ? `Looking for ${config.pedal.address ? label : "your pedal"}`
          : `Not found, trying again in ${Math.ceil((6000 - (since % 6000)) / 1000)} s`;
    const detail: Record<BleState, string> = {
      off: "Bluetooth is off",
      idle: "",
      searching,
      connecting: `Connecting to ${pedalLabel(config.pedal.name || MOCK_PEDAL, model)}`,
      connected: `Connected to ${pedalLabel(config.pedal.name || MOCK_PEDAL, model)}`,
    };
    return {
      state: connState,
      detail: detail[connState],
      name:
        live || connState === "connecting" ? config.pedal.name || MOCK_PEDAL : config.pedal.name,
      address: live ? config.pedal.address : "",
      model,
      firmware: live ? "4.1.23" : "",
      profile: live ? 2 : -1,
      profileName: live ? "Live Set" : "",
      battery: live ? Math.floor(battery) : -1,
      powered: live && powered,
      cables: cables.map((c, n) => simOn[n] || (live && c)),
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
    /** Press and release a switch by hand (tests, screenshots). */
    press,
    release: unpress,
    /** Which inputs' triggers are engaged now (State.expTrigger). */
    triggers(): boolean[] {
      const live = connState === "connected";
      return trig.map(
        (s, n) => (simOn[n] || (live && cables[n])) && triggerLit(s, config.exp[n].trigger),
      );
    },
    /** Which inputs are simulated, and which of those sweep (State.expSim, expSweep). */
    simState() {
      return { on: [...simOn], sweep: simOn.map((o, n) => o && simFrom[n] !== null) };
    },
    /** App.SimulateExp: on at the heel, refused with a real cable; off lets go. */
    simulate(n: number, on: boolean) {
      if (on === simOn[n]) return;
      if (on && connState === "connected" && cables[n]) {
        throw new Error(`a real pedal is plugged into jack ${n + 1}`);
      }
      simOn[n] = on;
      simFrac[n] = 0;
      simFrom[n] = null;
      if (!on) {
        letGo(n);
        lastExpSent[n] = -1;
        raw[n] = -1;
      }
    },
    /** App.SetSimExp: on if needed, a sweep stops. */
    simPosition(n: number, f: number) {
      if (!simOn[n]) this.simulate(n, true);
      simFrom[n] = null;
      simFrac[n] = Math.min(1, Math.max(0, f));
      raw[n] = fractionRaw(simFrac[n]);
    },
    /** App.SimSweep: from where the pedal is; off leaves it where the sweep got to. */
    simSweep(n: number, on: boolean) {
      if (on && !simOn[n]) this.simulate(n, true);
      if (!simOn[n] || on === (simFrom[n] !== null)) return;
      if (on) simFrom[n] = t - sweepOffset(simFrac[n]);
      else {
        simFrac[n] = simPos(n);
        simFrom[n] = null;
      }
    },
    setConfig(c: Config) {
      // Like Engine.SetConfig: a trigger whose input, mode or action changed lets go.
      c.exp.forEach((x, n) => {
        const was = config.exp[n];
        const sameAction = JSON.stringify(x.trigger.action) === JSON.stringify(was.trigger.action);
        if (x.enabled !== was.enabled || x.trigger.mode !== was.trigger.mode || !sameAction) {
          letGo(n, false);
          const keep =
            sameAction && x.trigger.action.kind === "cc" && x.trigger.action.mode === "toggle";
          trig = trig.map((s, i) => (i === n ? { ...s, on: s.on && keep } : s));
        }
      });
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

interface MockPreset {
  id: string;
  name: string;
  config: Config; // pedal always empty: the pedal is global, like in Go
  updatedAt: number;
}

/** internal/presets in memory: the same rules (unique names, the last preset stays,
 *  deleting the active one activates its neighbour), no file. */
export function createMockLibrary(first: Config, extra: { name: string; config: Config }[] = []) {
  let n = 0;
  const id = () => `p${++n}`;
  const now = () => Date.now();
  const mk = (name: string, config: Config): MockPreset => ({
    id: id(),
    name,
    config: mappingOf(structuredClone(config)),
    updatedAt: now(),
  });
  let presets: MockPreset[] = [mk("My mapping", first), ...extra.map((e) => mk(e.name, e.config))];
  let active = presets[0].id;

  const find = (pid: string) => {
    const p = presets.find((x) => x.id === pid);
    if (!p) throw new Error("that preset no longer exists");
    return p;
  };
  const info = (p: MockPreset): PresetInfo => ({
    id: p.id,
    name: p.name,
    updatedAt: p.updatedAt,
    active: p.id === active,
  });
  const names = () => presets.map((p) => p.name);
  const add = (name: string, config: Config) => {
    const p = mk(name, config);
    presets = [...presets, p];
    return info(p);
  };
  const checked = (raw: string, self?: string) => {
    const r = checkName(raw, presets.map(info), self);
    if ("error" in r) throw new Error(r.error);
    return r.name;
  };

  return {
    list: () => presets.map(info),
    activeId: () => active,
    active: () => structuredClone(find(active).config),
    saveActive(c: Config) {
      this.saveInto(active, c);
    },
    saveInto(pid: string, c: Config) {
      const p = find(pid);
      p.config = mappingOf(structuredClone(c));
      p.updatedAt = now();
    },
    select(pid: string) {
      find(pid);
      active = pid;
      return structuredClone(find(pid).config);
    },
    create(name: string, from: PresetSource) {
      const config = from === "current" ? find(active).config : defaultConfig();
      return add(name.trim() ? checked(name) : uniqueName("New preset", names()), config);
    },
    rename(pid: string, name: string) {
      const p = find(pid);
      p.name = checked(name, pid);
      p.updatedAt = now();
    },
    duplicate(pid: string) {
      const p = find(pid);
      return add(copyName(p.name, names()), p.config);
    },
    remove(pid: string) {
      const i = presets.findIndex((p) => p.id === pid);
      if (i < 0) throw new Error("that preset no longer exists");
      if (presets.length === 1) throw new Error("the last preset cannot be deleted");
      presets = presets.filter((p) => p.id !== pid);
      if (pid === active) active = presets[Math.min(i, presets.length - 1)].id;
    },
    exported(pid: string) {
      const p = find(pid);
      return { text: encodePreset(p.name, p.config), file: exportFileName(p.name) };
    },
    import(text: string, filename: string) {
      const { name, config } = decodePreset(text, filename);
      const err = validate(config);
      if (err) throw new Error(`the preset cannot be used: ${err}`);
      return add(uniqueName(name, names()), config);
    },
  };
}

/** A few presets that look like someone's, so the picker has something to show. */
function samplePresets(): { name: string; config: Config }[] {
  const live = defaultConfig();
  live.ledMode = "feedback";
  live.switches.forEach((s, i) => {
    s.tap = { kind: "note", channel: 1, number: 36 + i, value: 127, mode: "momentary" };
  });
  const logic = defaultConfig();
  logic.switches[0].tap = cc(64, 1, "toggle");
  logic.switches[1].tap = { kind: "pc", channel: 1, number: 1, value: 127, mode: "momentary" };
  logic.longPressMs = 700;
  const gig = defaultConfig();
  gig.brightness = 40;
  gig.switches.forEach((s, i) => {
    s.tap = { kind: "pc", channel: 2, number: i, value: 127, mode: "momentary" };
  });
  return [
    { name: "Ableton live", config: live },
    { name: "Logic · tracking", config: logic },
    { name: "MainStage gig", config: gig },
  ];
}

/** Browser only: hands the text to the user as a download. */
function download(text: string, file: string) {
  if (typeof document === "undefined") return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = file;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Browser only: a file picker standing in for the native open panel; null = cancelled. */
function pickFile(): Promise<{ text: string; name: string } | null> {
  if (typeof document === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("cancel", () => resolve(null));
    input.addEventListener("change", async () => {
      const f = input.files?.[0];
      resolve(f ? { text: await f.text(), name: f.name } : null);
    });
    input.click();
  });
}

/** A demo step: an edit, an undo or redo, or switching to the preset of that name. */
export type DemoStep = Op | "undo" | "redo" | { preset: string };

/** Edits to replay on load (?demo=...), so the history and the save status can be
 *  screenshotted without clicking: "history" makes a few changes and undoes the last
 *  two; "invalid" ends on a config that does not validate. The preset ones show that
 *  each preset has its own history: "presets-b" makes two edits in My mapping, switches
 *  to Ableton live, makes two there and undoes one (only Ableton live's); "presets" then
 *  goes back to My mapping, whose two edits are still there, and undoes both and redoes
 *  one. */
export function demoScript(name: string): DemoStep[] {
  const edits: Op[] = [
    { type: "tap", sw: 1, patch: { kind: "note", number: 60 } },
    { type: "colour", sw: 0, colour: { r: 0, g: 255, b: 0 } },
    { type: "tap", sw: 3, patch: { mode: "toggle" } },
    { type: "addCombo" },
    { type: "longPressMs", value: 650 },
    { type: "ledMode", mode: "feedback" },
  ];
  if (name === "history") return [...edits, "undo", "undo"];
  const inB: DemoStep[] = [
    edits[0],
    edits[4],
    { preset: "Ableton live" },
    edits[1],
    { type: "brightness", value: 60 },
    "undo",
  ];
  if (name === "presets-b") return inB;
  if (name === "presets") return [...inB, { preset: "My mapping" }, "undo", "undo", "redo"];
  if (name === "invalid")
    return [...edits.slice(0, 2), { type: "combo", index: 0, patch: { b: 0 } }];
  return [];
}

/** The Backend over a running simulator. URL parameters shape it for screenshots:
 *  ?state=off|idle|searching|connecting|connected, ?cycle (walk through them for ever:
 *  searching, connecting, connected, link lost), ?freeze=N (LinkOverlay), ?seed=N, ?hold=I,A (switch names),
 *  ?cables=11 (exp1, exp2), ?midi=error, ?still (no automatic presses), ?save=error
 *  (every save is refused), ?save=slow (every save takes a minute), ?power=usb|battery (pin USB power; unset, it comes and goes),
 *  ?lamp=amp|app (open on an indicator lamp), ?trigger=engage,toe (the two inputs'
 *  trigger modes; unset, engage,off), ?exp=60,98 (pin each pedal at a travel percent;
 *  "-" or unset sweeps it), ?sim=40,sweep (start each input's simulated
 *  pedal at a percent of the jack, or sweeping; "-" or unset leaves it off), ?presets=one (a single preset; otherwise four samples),
 *  ?library=corrupt (the library error Go shows after a damaged file),
 *  ?picker=open|rename|delete (App opens the preset picker). See also demoScript (?demo=). */
export function createMockBackend(q: URLSearchParams): Backend {
  const names = ["I", "II", "A", "III", "IV", "B"];
  const holdMask = (q.get("hold") ?? "")
    .split(",")
    .map((s) => names.indexOf(s.trim()))
    .filter((i) => i >= 0)
    .reduce((m, i) => m | (1 << i), 0);
  const cablesQ = q.get("cables");
  const modeQ = (s: string | undefined): TriggerMode => (s === "engage" || s === "toe" ? s : "off");
  const trigQ = q.get("trigger")?.split(",");
  const expQ = q.get("exp")?.split(",");
  const pinQ = (s: string | undefined) => (s && /^\d+(\.\d+)?$/.test(s) ? Number(s) : null);
  const simQ = q.get("sim")?.split(",");
  const simStart = (s: string | undefined): SimStart => (s === "sweep" ? "sweep" : pinQ(s));
  const sim = createSim({
    triggers: trigQ ? [modeQ(trigQ[0]), modeQ(trigQ[1])] : undefined,
    expAt: expQ ? [pinQ(expQ[0]), pinQ(expQ[1])] : undefined,
    simAt: simQ ? [simStart(simQ[0]), simStart(simQ[1])] : undefined,
    seed: Number(q.get("seed") ?? 7),
    fixedState: (q.get("state") as BleState | null) ?? undefined,
    cycle: q.has("cycle"),
    cables: cablesQ ? [cablesQ[0] === "1", cablesQ[1] === "1"] : undefined,
    holdMask,
    autoPress: !q.has("still"),
    powered: q.has("power") ? q.get("power") === "usb" : undefined,
    epoch: Date.now(),
  });
  let launchAtLogin = false;
  const lib = createMockLibrary(sim.config, q.get("presets") === "one" ? [] : samplePresets());
  const libraryError =
    q.get("library") === "corrupt"
      ? "preset library was damaged, using defaults; the old file is library.json.corrupt-20261104-214502: invalid character 'o'"
      : "";
  /** Runs the active preset's mapping, with the global pedal. */
  const run = (c: Config) => sim.setConfig({ ...c, pedal: sim.config.pedal });
  const midiError = q.get("midi") === "error";
  const saveError = q.get("save") === "error";
  const saveSlow = q.get("save") === "slow";
  /** Go's SaveConfigInto: stores into preset `id`, runs it only if `id` is active now. */
  const saveInto = async (id: string, cfg: Config) => {
    // Counted for browser checks (a scrub must save once).
    const w = window as unknown as { __mockSaves?: number };
    w.__mockSaves = (w.__mockSaves ?? 0) + 1;
    await sleep(saveSlow ? 60_000 : 120);
    if (saveError) throw new Error("could not write config.json: read-only file system");
    const err = validate(cfg);
    if (err) throw new Error(err);
    lib.saveInto(id, cfg);
    if (id === lib.activeId()) run(cfg);
  };
  const stateCbs = new Set<(s: State) => void>();
  const actCbs = new Set<(a: Activity) => void>();

  const state = (): State => ({
    pedal: sim.status(),
    config: structuredClone(sim.config),
    midi: midiError
      ? {
          source: MIDI_PORT_NAME,
          dest: MIDI_LED_PORT_NAME,
          ok: false,
          error: "MIDIClientCreate failed (-10830)",
        }
      : { source: MIDI_PORT_NAME, dest: MIDI_LED_PORT_NAME, ok: true, error: "" },
    launchAtLogin,
    version: "0.1.0-dev",
    presets: lib.list(),
    activePreset: lib.activeId(),
    libraryError,
    expTrigger: sim.triggers(),
    expSim: sim.simState().on,
    expSweep: sim.simState().sweep,
  });

  // For browser checks: window.__mockMenu("Ableton live") switches the way Go's menu-bar
  // menu does, without asking the UI (the next state tick tells it), and
  // window.__mockPreset(name) is what the library holds for a preset.
  if (typeof window !== "undefined") {
    const byName = (name: string) => lib.list().find((x) => x.name === name);
    Object.assign(window, {
      __mockMenu: (name: string) => {
        const p = byName(name);
        if (p) run(lib.select(p.id));
      },
      __mockPreset: (name: string) => {
        const p = byName(name);
        if (!p) return null;
        const was = lib.activeId();
        const c = lib.select(p.id);
        lib.select(was);
        return c;
      },
    });
  }

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
    SaveConfig: (cfg) => saveInto(lib.activeId(), cfg),
    SaveConfigInto: (id, cfg) => saveInto(id, cfg),
    ResetConfig: async () => {
      const c = defaultConfig();
      c.pedal = sim.config.pedal;
      sim.setConfig(c);
      lib.saveActive(c);
      return structuredClone(c);
    },
    Scan: async (): Promise<Device[]> => {
      await sleep(1500);
      const found = (name: string, address: string, rssi: number, system: boolean): Device => {
        const model = mockModel(name);
        return { name, address, rssi, system, model, verified: model.id !== "" };
      };
      return [
        found(MOCK_PEDAL, "4F1A-SPARKX-MOCK", -48, true),
        found("REACTOR Control 3c9e", "7B10-REACTOR-MOCK", -61, false),
        found("SparkX v4.1.20 a01e", "9C02-SPARKX-MOCK", -77, false),
        found("BT500S-2", "D7E4-AIRTURN-MOCK", -70, false), // unverified: only the switch service
      ];
    },
    ChoosePedal: async (address, name) => {
      sim.setConfig({ ...sim.config, pedal: { address, name } });
      sim.reconnect();
    },
    ForgetPedal: async () => sim.forget(),
    CalibrateExp: async (n, edge) => {
      sim.calibrate(n, edge);
      lib.saveActive(sim.config);
      return structuredClone(sim.config);
    },
    SimulateExp: async (n, on) => sim.simulate(n, on),
    SetSimExp: async (n, f) => sim.simPosition(n, f),
    SimSweep: async (n, on) => sim.simSweep(n, on),
    SetLaunchAtLogin: async (on) => {
      launchAtLogin = on;
    },
    RevealLogs: async () => {
      console.info("[mock] RevealLogs");
    },
    GetTheme: async () => "system",
    ThirdPartyNotices: async () =>
      [
        "# Third-party notices",
        "",
        "Browser preview: the desktop app shows THIRD_PARTY_NOTICES.md here.",
        "",
        "## MIT",
        "",
        "- [react](https://github.com/react/react) 19 (npm)",
        "",
        "```text",
        "Permission is hereby granted, free of charge, to any person obtaining a copy…",
        "```",
      ].join("\n"),
    SetTheme: async () => {},
    ListPresets: async () => lib.list(),
    SelectPreset: async (id) => {
      await sleep(60);
      run(lib.select(id));
      return structuredClone(sim.config);
    },
    CreatePreset: async (name, from) => lib.create(name, from),
    RenamePreset: async (id, name) => lib.rename(id, name),
    DuplicatePreset: async (id) => lib.duplicate(id),
    DeletePreset: async (id) => {
      const was = lib.activeId();
      lib.remove(id);
      if (lib.activeId() !== was) run(lib.active());
    },
    ExportPreset: async (id) => {
      const { text, file } = lib.exported(id);
      download(text, file);
    },
    ImportPreset: async () => {
      const f = await pickFile();
      if (!f) return { id: "", name: "", updatedAt: 0, active: false };
      return lib.import(f.text, f.name);
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

/** The mock's pedal, as a Spark Control X advertises itself. */
const MOCK_PEDAL = "SparkX v4.1.23 fbfc";

/** sparkx.ModelForName for the mock: the two known models' prefixes. */
function mockModel(name: string): PedalModel {
  const n = name.trim().toLowerCase();
  if (n.startsWith("sparkx")) return { id: "spark-control-x", name: "Spark Control X" };
  if (n.startsWith("reactor control")) return { id: "reactor-control", name: "REACTOR Control" };
  return { id: "", name: "" };
}
