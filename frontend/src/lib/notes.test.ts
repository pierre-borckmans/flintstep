import { describe, expect, it } from "vitest";
import { noteName, parseNote } from "./notes";

describe("noteName", () => {
  it("names middle C as C4", () => expect(noteName(60)).toBe("C4"));
  it("uses sharps", () => expect(noteName(61)).toBe("C#4"));
  it("covers the ends of the range", () => {
    expect(noteName(0)).toBe("C-1");
    expect(noteName(127)).toBe("G9");
  });
  it("is empty out of range", () => expect(noteName(128)).toBe(""));
});

describe("parseNote", () => {
  it("reads numbers", () => expect(parseNote(" 64 ")).toBe(64));
  it("reads names, sharps and flats", () => {
    expect(parseNote("C4")).toBe(60);
    expect(parseNote("c#4")).toBe(61);
    expect(parseNote("Db4")).toBe(61);
    expect(parseNote("C-1")).toBe(0);
    expect(parseNote("G9")).toBe(127);
  });
  it("round-trips every note", () => {
    for (let n = 0; n <= 127; n++) expect(parseNote(noteName(n))).toBe(n);
  });
  it("rejects nonsense and out-of-range", () => {
    expect(parseNote("H2")).toBeNull();
    expect(parseNote("128")).toBeNull();
    expect(parseNote("A9")).toBeNull();
    expect(parseNote("")).toBeNull();
  });
});
