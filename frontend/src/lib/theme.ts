// THE THEME: follow macOS, or force dark or light. Like the nuts it is this Mac's
// preference, in localStorage, never in a preset. The page shows it through
// <html data-theme>: "light" or "dark" when forced, absent for system, where style.css
// follows prefers-color-scheme itself. The store is in useTheme.ts; this is pure.

export type ThemeMode = "system" | "dark" | "light";
export type Resolved = "dark" | "light";

/** Also read by the inline script in index.html, before the first paint. */
export const THEME_KEY = "sparkx.theme";

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
