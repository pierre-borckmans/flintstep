import { describe, expect, it } from "vitest";
import { describeMidi, relTime } from "./midi";

describe("describeMidi", () => {
  it("reads CC", () => expect(describeMidi([0xb0, 80, 127])).toBe("CC 80 = 127 · ch 1"));
  it("reads notes, velocity 0 as off", () => {
    expect(describeMidi([0x91, 60, 100])).toBe("Note on C4 v100 · ch 2");
    expect(describeMidi([0x90, 60, 0])).toBe("Note off C4 · ch 1");
    expect(describeMidi([0x80, 61, 0])).toBe("Note off C#4 · ch 1");
  });
  it("reads program change", () => expect(describeMidi([0xcf, 5])).toBe("PC 5 · ch 16"));
  it("falls back to hex", () => expect(describeMidi([0xf8])).toBe("f8"));
});

describe("relTime", () => {
  it("buckets", () => {
    expect(relTime(1000, 1500)).toBe("now");
    expect(relTime(0, 4200)).toBe("4s");
    expect(relTime(0, 185_000)).toBe("3m");
    expect(relTime(0, 7_300_000)).toBe("2h");
  });
});
