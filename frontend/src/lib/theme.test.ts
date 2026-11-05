import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTheme, resolveTheme, startupTheme, themeAttr } from "./theme";

describe("parseTheme", () => {
  it("keeps the three modes", () => {
    expect(parseTheme("system")).toBe("system");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
  });
  it("reads anything else as system", () => {
    expect(parseTheme(null)).toBe("system");
    expect(parseTheme(undefined)).toBe("system");
    expect(parseTheme("Light")).toBe("system");
    expect(parseTheme("sepia")).toBe("system");
  });
});

describe("themeAttr", () => {
  it("forces only dark and light", () => {
    expect(themeAttr("system")).toBeUndefined();
    expect(themeAttr("dark")).toBe("dark");
    expect(themeAttr("light")).toBe("light");
  });
});

describe("resolveTheme", () => {
  it("follows macOS only in system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });
});

describe("startupTheme", () => {
  const never = () => Promise.reject(new Error("Go should not be asked"));

  it("keeps a stored theme and tells Go", async () => {
    expect(await startupTheme("light", never)).toEqual({ mode: "light", push: true, save: false });
    expect(await startupTheme("system", never)).toEqual({
      mode: "system",
      push: true,
      save: false,
    });
  });
  it("with nothing stored, adopts Go's theme and never pushes over it", async () => {
    // First launch under the new bundle id: WebKit storage is empty, prefs.json says dark.
    expect(await startupTheme(null, async () => "dark")).toEqual({
      mode: "dark",
      push: false,
      save: true,
    });
  });
  it("reads a damaged stored value as nothing stored", async () => {
    expect(await startupTheme("sepia", async () => "light")).toEqual({
      mode: "light",
      push: false,
      save: true,
    });
  });
  it("reads an unknown answer from Go as system", async () => {
    expect(await startupTheme(null, async () => "")).toEqual({
      mode: "system",
      push: false,
      save: true,
    });
  });
  it("shows system without saving or pushing when Go can't answer", async () => {
    expect(await startupTheme(null, never)).toEqual({ mode: "system", push: false, save: false });
  });
});

// The light palette is written twice in style.css: once for data-theme="light", once for
// system under prefers-color-scheme: light. They must not drift apart.
describe("style.css light palette", () => {
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const block = (start: string) => {
    const i = css.indexOf(start);
    expect(i, start).toBeGreaterThanOrEqual(0);
    const open = css.indexOf("{", i + start.length - 1);
    const close = css.indexOf("}", open);
    return css
      .slice(open + 1, close)
      .split(";")
      .map((d) => d.replace(/\/\*[\s\S]*?\*\//g, "").trim())
      .filter(Boolean);
  };
  it("is the same for forced light and system light", () => {
    const forced = block(':root[data-theme="light"] {');
    const system = block(':root:not([data-theme="dark"]) {');
    expect(forced.length).toBeGreaterThan(20);
    expect(system).toEqual(forced);
  });
});
