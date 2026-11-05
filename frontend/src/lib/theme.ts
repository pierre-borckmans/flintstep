// THE THEME: follow macOS, or force dark or light. Like the nuts it is this Mac's
// preference, in localStorage, never in a preset. The page shows it through
// <html data-theme>: "light" or "dark" when forced, absent for system, where style.css
// follows prefers-color-scheme itself. The store is in useTheme.ts; this is pure.

import { STORAGE_PREFIX } from "../product";

export type ThemeMode = "system" | "dark" | "light";
export type Resolved = "dark" | "light";

/** Also read by the inline script in index.html, before the first paint. */
export const THEME_KEY = `${STORAGE_PREFIX}theme`;

const MODES: readonly ThemeMode[] = ["system", "dark", "light"];

/** A stored or queried value; anything else is "system". */
export function parseTheme(raw: string | null | undefined): ThemeMode {
  return MODES.includes(raw as ThemeMode) ? (raw as ThemeMode) : "system";
}

/** The data-theme attribute for a mode: none for system. */
export function themeAttr(mode: ThemeMode): Resolved | undefined {
  return mode === "system" ? undefined : mode;
}

/** What the page actually shows. */
export function resolveTheme(mode: ThemeMode, systemDark: boolean): Resolved {
  if (mode !== "system") return mode;
  return systemDark ? "dark" : "light";
}

/** How the theme starts: `mode` to show, whether to tell Go (`push`) and whether to keep
 *  it in localStorage (`save`). A stored theme wins and is pushed, so the native window
 *  matches it. With none stored (first launch, or a new bundle id and so an empty
 *  WebKit storage) Go's prefs.json is the truth: adopt it and keep it, never push the
 *  "system" default over it. If Go can't say, show system and leave prefs.json alone. */
export async function startupTheme(
  stored: string | null,
  askGo: () => Promise<string>,
): Promise<{ mode: ThemeMode; push: boolean; save: boolean }> {
  if (MODES.includes(stored as ThemeMode)) {
    return { mode: stored as ThemeMode, push: true, save: false };
  }
  try {
    return { mode: parseTheme(await askGo()), push: false, save: true };
  } catch {
    return { mode: "system", push: false, save: false };
  }
}
