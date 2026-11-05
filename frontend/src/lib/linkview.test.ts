import { describe, expect, it } from "vitest";
import type { BleState, PedalRef, Status } from "../types";
import { LAMP_AMP, LAMP_APP } from "../types";
import { defaultConfig } from "./config";
import { linkView, SWEEP_MS, sweepLamps } from "./linkview";

const status = (state: BleState, detail = "", name = ""): Status => ({
  state,
  detail,
  name,
  address: "",
  firmware: "",
  profile: -1,
  profileName: "",
  battery: -1,
  powered: false,
  cables: [false, false],
  exp: [-1, -1],
  held: 0,
  lamps: [],
  expRaw: [-1, -1],
});
const none: PedalRef = { address: "", name: "" };
const mine: PedalRef = { address: "4F1A", name: "SparkX v4.1.23 fbfc" };
const ids = (v: ReturnType<typeof linkView>) => v.actions.map((a) => a.id);

describe("linkView", () => {
  it("is hidden when connected or before any status", () => {
    expect(linkView(status("connected"), mine).visible).toBe(false);
    expect(linkView(null, mine).visible).toBe(false);
  });

  it("searching: rings out, Go's countdown, the remembered pedal, scan and forget", () => {
    const v = linkView(status("searching", "Not found, trying again in 4 s"), mine);
    expect(v).toMatchObject({
      visible: true,
      tone: "searching",
      rings: "expand",
      title: "Looking for your Spark Control X…",
      detail: "Not found, trying again in 4 s",
      pedal: "SparkX v4.1.23 fbfc",
    });
    expect(v.hint).toMatch(/Turn the pedal on/);
    expect(ids(v)).toEqual(["scan", "forget"]);
  });

  it("searching with no remembered pedal has nothing to forget", () => {
    const v = linkView(status("searching", "Connection lost, reconnecting"), none);
    expect(v.detail).toBe("Connection lost, reconnecting");
    expect(v.pedal).toBe("");
    expect(ids(v)).toEqual(["scan"]);
  });

  it("drops a detail that only repeats the title", () => {
    expect(linkView(status("searching", "Looking for SparkX"), mine).detail).toBe("");
    expect(linkView(status("connecting", "Connecting to SparkX", "SparkX"), mine).detail).toBe("");
  });

  it("connecting: rings in, named after the pedal being dialled", () => {
    const v = linkView(status("connecting", "", "SparkX v4.1.20 a01e"), mine);
    expect(v).toMatchObject({ tone: "connecting", rings: "converge" });
    expect(v.title).toBe("Connecting to SparkX v4.1.20 a01e…");
    expect(v.actions).toEqual([]);
    expect(linkView(status("connecting"), none).title).toBe("Connecting to your Spark Control X…");
  });

  it("off: no rings, Go's words as the title, a way to System Settings", () => {
    const v = linkView(status("off", "Bluetooth is not available"), mine);
    expect(v).toMatchObject({ tone: "off", rings: "none", title: "Bluetooth is not available" });
    expect(ids(v)).toEqual(["bluetooth"]);
    expect(linkView(status("off"), mine).title).toBe("Bluetooth is off");
  });

  it("idle: connect to the remembered pedal, or scan", () => {
    const v = linkView(status("idle"), mine);
    expect(v).toMatchObject({ tone: "idle", rings: "none", title: "Not connected" });
    expect(ids(v)).toEqual(["connect", "scan"]);
    const fresh = linkView(status("idle"), none);
    expect(ids(fresh)).toEqual(["scan"]);
    expect(fresh.actions[0].kind).toBe("primary");
  });
});

describe("sweepLamps", () => {
  const cfg = defaultConfig();
  const dark = Array.from({ length: 8 }, () => ({ r: 0, g: 0, b: 0 }));
  const lit = (t: number) =>
    sweepLamps(t, dark, cfg)
      .map((c, i) => (c.r + c.g + c.b > 0 ? i : -1))
      .filter((i) => i >= 0);

  it("lights the left column first and the right column last", () => {
    expect(lit(10)).toEqual([0, 3]);
    expect(lit(SWEEP_MS - 10)).toEqual([2, 5]);
  });

  it("passes AMP and APP between the middle and right columns", () => {
    const seen = new Set<number>();
    for (let t = 0; t < SWEEP_MS; t += 10) for (const i of lit(t)) seen.add(i);
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5, LAMP_AMP, LAMP_APP]);
  });

  it("uses each switch's colour", () => {
    expect(sweepLamps(10, dark, cfg)[0]).toEqual(cfg.switches[0].colour);
  });

  it("leaves the lamps alone outside the sweep", () => {
    expect(sweepLamps(SWEEP_MS, dark, cfg)).toBe(dark);
    expect(sweepLamps(-1, dark, cfg)).toBe(dark);
  });
});
