import { describe, expect, it } from "vitest";
import { defaultConfig } from "./lib/config";
import { createMockLibrary, createSim, rng } from "./mock";

const run = (seed: number, steps = 400) => {
  const sim = createSim({ seed });
  const log: string[] = [];
  for (let i = 0; i < steps; i++) {
    for (const a of sim.step(50)) log.push(`${a.at} ${a.dir} ${a.bytes.join(",")}`);
  }
  return { log, status: sim.status() };
};

describe("mock pedal", () => {
  it("rng is deterministic", () => {
    const a = rng(3);
    const b = rng(3);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it("same seed, same session", () => {
    expect(run(11).log).toEqual(run(11).log);
    expect(run(11).log).not.toEqual(run(12).log);
  });
  it("connects, reports the battery and presses switches", () => {
    const { log, status } = run(5);
    expect(status.state).toBe("connected");
    expect(status.battery).toBeGreaterThan(0);
    expect(status.battery).toBeLessThanOrEqual(100);
    expect(log.some((l) => l.includes(" out 176,8"))).toBe(true); // a CC 80..85
  });
  it("lights a held switch in its colour (local mode)", () => {
    const sim = createSim({ seed: 1, fixedState: "connected", holdMask: 1, autoPress: false });
    sim.step(50);
    expect(sim.status().lamps[0]).toEqual(sim.config.switches[0].colour);
    expect(sim.status().lamps[1]).toEqual({ r: 0, g: 0, b: 0 });
  });
  it("calibrates from the live raw value", () => {
    const sim = createSim({ seed: 1, fixedState: "connected", autoPress: false });
    sim.step(50);
    const raw = sim.status().expRaw[0];
    sim.calibrate(0, "max");
    expect(sim.config.exp[0].max).toBe(raw);
    expect(() => sim.calibrate(1, "min")).toThrow(/no cable/);
  });

  it("charges while plugged in, and the plug comes and goes", () => {
    const sim = createSim({ seed: 1, fixedState: "connected", autoPress: false });
    const seen = new Set<boolean>();
    let charged = false;
    let prev = sim.status().battery;
    for (let i = 0; i < 1600; i++) {
      sim.step(50);
      const st = sim.status();
      seen.add(st.powered);
      if (st.powered && st.battery > prev) charged = true;
      prev = st.battery;
    }
    expect([...seen].sort()).toEqual([false, true]);
    expect(charged).toBe(true);
  });
  it("lights the indicator lamps by their modes", () => {
    const sim = createSim({ seed: 1, fixedState: "connected", autoPress: false, powered: false });
    const c = structuredClone(sim.config);
    c.indicators = [
      { mode: "on", colour: { r: 200, g: 0, b: 0 } },
      { mode: "usb", colour: { r: 0, g: 0, b: 200 } },
    ];
    c.brightness = 50;
    sim.setConfig(c);
    sim.step(50);
    expect(sim.status().lamps[6]).toEqual({ r: 100, g: 0, b: 0 });
    expect(sim.status().lamps[7]).toEqual({ r: 0, g: 0, b: 0 });
  });
  it("flashes AMP with MIDI out by default", () => {
    const sim = createSim({
      seed: 1,
      fixedState: "connected",
      autoPress: false,
      cables: [false, false],
    });
    sim.step(50);
    expect(sim.status().lamps[6]).toEqual({ r: 0, g: 0, b: 0 });
    expect(sim.status().lamps[7]).toEqual(sim.config.indicators[1].colour);
    sim.press(0);
    sim.step(50);
    expect(sim.status().lamps[6]).toEqual(sim.config.indicators[0].colour);
    sim.step(200);
    expect(sim.status().lamps[6]).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe("mock preset library", () => {
  const first = () => {
    const c = defaultConfig();
    c.pedal = { address: "4F1A", name: "SparkX" };
    c.longPressMs = 800;
    return c;
  };

  it("keeps the pedal out of presets and saves into the active one", () => {
    const lib = createMockLibrary(first());
    expect(lib.active().pedal.address).toBe("");
    const b = lib.create("", "default");
    expect(b.name).toBe("New preset");
    lib.select(b.id);
    const c = lib.active();
    c.brightness = 10;
    lib.saveActive(c);
    expect(lib.select(lib.list()[0].id).longPressMs).toBe(800);
    expect(lib.select(b.id).brightness).toBe(10);
  });

  it("follows Go's rules for names, duplicates and deletes", () => {
    const lib = createMockLibrary(first(), [{ name: "Live", config: defaultConfig() }]);
    const [a, live] = lib.list();
    expect(() => lib.create("live", "current")).toThrow("already exists");
    expect(lib.duplicate(live.id).name).toBe("Live copy");
    lib.select(live.id);
    lib.remove(live.id);
    expect(lib.activeId()).not.toBe(live.id);
    lib.remove(lib.list()[1].id);
    expect(() => lib.remove(a.id)).toThrow("last preset");
  });

  it("imports what it exports", () => {
    const lib = createMockLibrary(first());
    const { text, file } = lib.exported(lib.activeId());
    expect(file).toBe("My mapping.sparkx.json");
    const got = lib.import(text, file);
    expect(got.name).toBe("My mapping (2)");
    expect(lib.select(got.id).longPressMs).toBe(800);
  });
});
