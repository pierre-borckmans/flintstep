import { describe, expect, it } from "vitest";
import { pedalLabel, pedalTitle } from "./pedalname";

const reactor = { id: "reactor-control", name: "REACTOR Control" };
const compatible = { id: "compatible", name: "compatible AirTurn-based pedal" };

describe("pedalLabel", () => {
  it("names a known model by the model, whatever it advertises", () => {
    expect(pedalLabel("REACTOR Control 7f", reactor)).toBe("REACTOR Control");
    expect(pedalLabel("SparkX v4", { id: "spark-control-x", name: "Spark Control X" })).toBe(
      "Spark Control X",
    );
  });

  it("names a compatible or unverified pedal by its name", () => {
    expect(pedalLabel("AT-FS6", compatible)).toBe("AT-FS6");
    expect(pedalLabel("Mystery", { id: "", name: "" })).toBe("Mystery");
    expect(pedalLabel("", compatible)).toBe("a compatible AirTurn-based pedal");
  });

  it("says your pedal when there is nothing to go on", () => {
    expect(pedalLabel("", undefined)).toBe("your pedal");
    expect(pedalTitle("", null)).toBe("Your pedal");
    expect(pedalTitle("", compatible)).toBe("Compatible AirTurn-based pedal");
  });
});
