import { describe, expect, it } from "vitest";
import { createSim, rng } from "./mock";

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
    const sim = createSim({
      seed: 1,
      fixedState: "connected",
      autoPress: false,
      expAt: [50, null],
    });
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
  it("sweeps the pedal so auto-engage engages and lets go", () => {
    const sim = createSim({ seed: 3, fixedState: "connected", autoPress: false });
    const seen = new Set<boolean>();
    const log: string[] = [];
    for (let i = 0; i < 1200; i++) {
      for (const a of sim.step(50)) log.push(a.bytes.join(","));
      seen.add(sim.triggers()[0]);
    }
    expect(seen).toEqual(new Set([true, false]));
    expect(log).toContain("176,102,127");
    expect(log).toContain("176,102,0");
  });
  it("a pinned pedal at the toe clicks a toe trigger", () => {
    const sim = createSim({
      seed: 1,
      fixedState: "connected",
      autoPress: false,
      triggers: ["toe", "off"],
      expAt: [98, null],
    });
    sim.step(50);
    expect(sim.triggers()).toEqual([true, false]);
  });
  it("lets go when the trigger is turned off", () => {
    const sim = createSim({
      seed: 1,
      fixedState: "connected",
      autoPress: false,
      expAt: [60, null],
    });
    sim.step(50);
    expect(sim.triggers()[0]).toBe(true);
    const c = structuredClone(sim.config);
    c.exp[0].trigger.mode = "off";
    sim.setConfig(c);
    expect(sim.triggers()[0]).toBe(false);
  });
});
