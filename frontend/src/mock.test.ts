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
    expect(status.battery).toBe(76);
    expect(log.some((l) => l.includes(" out 176,8"))).toBe(true); // a CC 80..85
  });
  it("lights a held switch in its colour (local mode)", () => {
    const sim = createSim({ seed: 1, fixedState: "connected", holdMask: 1, autoPress: false });
    sim.step(50);
    expect(sim.status().lamps[0]).toEqual({ r: 255, g: 0, b: 0 });
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
});
