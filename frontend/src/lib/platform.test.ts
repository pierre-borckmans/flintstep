import { describe, expect, it } from "vitest";
import { keys, os, revealLabel, systemLookName, thisComputer } from "./platform";

describe("os", () => {
  it("reads navigator.platform", () => {
    expect(os("MacIntel")).toBe("mac");
    expect(os("Linux x86_64")).toBe("linux");
    expect(os("Linux aarch64")).toBe("linux");
    expect(os("Win32")).toBe("other");
  });
  it("falls back to the user agent", () => {
    expect(os("", "Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/605.1.15")).toBe("linux");
    expect(os("", "Mozilla/5.0 (Linux; Android 14)")).toBe("other");
    expect(os("", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("mac");
  });
});

describe("words", () => {
  it("keeps the macOS wording on a Mac", () => {
    expect(thisComputer("mac")).toBe("this Mac");
    expect(systemLookName("mac")).toBe("macOS");
    expect(revealLabel("mac")).toBe("Reveal in Finder");
  });
  it("is generic elsewhere", () => {
    expect(thisComputer("linux")).toBe("this computer");
    expect(systemLookName("linux")).toBe("the desktop");
    expect(revealLabel("linux")).toBe("Open the folder");
  });
});

describe("keys", () => {
  it("keeps the Mac symbols on a Mac and spells them out elsewhere", () => {
    expect(keys("⇧⌘Z", "mac")).toBe("⇧⌘Z");
    expect(keys("⌘Z", "linux")).toBe("Ctrl Z");
    expect(keys("⇧⌘Z", "linux")).toBe("Ctrl Shift Z");
    expect(keys("F2", "linux")).toBe("F2");
  });
});
