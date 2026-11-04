import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import {
  parseTheme,
  type Resolved,
  resolveTheme,
  THEME_KEY,
  type ThemeMode,
  themeAttr,
} from "./lib/theme";

// The theme's store: one per window, outside React, saved to localStorage on change
// (storage may refuse; the theme still applies, it just isn't remembered). Every change is
// also told to Go, which themes the native window and keeps it for the next launch.

type Snapshot = { mode: ThemeMode; resolved: Resolved };

let snap: Snapshot | null = null;
let tell: (mode: ThemeMode) => Promise<void> = async () => {};
const subs = new Set<() => void>();

const media = (q: string) => {
  try {
    return window.matchMedia(q);
  } catch {
    return null;
  }
};
const systemDark = () => !(media("(prefers-color-scheme: light)")?.matches ?? false);
const reducedMotion = () => media("(prefers-reduced-motion: reduce)")?.matches ?? false;

function stored(): ThemeMode {
  try {
    return parseTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return "system";
  }
}

function get(): Snapshot {
  if (!snap) {
    const mode = stored();
    snap = { mode, resolved: resolveTheme(mode, systemDark()) };
  }
  return snap;
}

function publish(mode: ThemeMode) {
  snap = { mode, resolved: resolveTheme(mode, systemDark()) };
  for (const cb of subs) cb();
}

function paint(mode: ThemeMode) {
  const attr = themeAttr(mode);
  const root = document.documentElement;
  if (attr) root.dataset.theme = attr;
  else delete root.dataset.theme;
}

/** Repaint in the new theme with a short crossfade: a view transition where the webview
 *  has them (WebKit 18+), else a brief transition on colours. Instant under reduced motion. */
function crossfade(change: () => void) {
  if (reducedMotion()) {
    change();
    return;
  }
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (typeof doc.startViewTransition === "function") {
    doc.startViewTransition(() => flushSync(change));
    return;
  }
  const root = document.documentElement;
  root.dataset.themeFading = "";
  change();
  window.setTimeout(() => delete root.dataset.themeFading, 400);
}

/** Once, with the backend: shows the saved theme (or ?theme= in browser dev, unsaved) and
 *  tells Go, so the native window matches even if prefs.json and localStorage disagree. */
export function initTheme(setTheme: (mode: ThemeMode) => Promise<void>) {
  tell = setTheme;
  let mode = stored();
  if (document.documentElement.dataset.mock) {
    const q = new URLSearchParams(window.location.search).get("theme");
    if (q) mode = parseTheme(q);
  }
  paint(mode);
  publish(mode);
  tell(mode).catch(() => {});
  // System follows macOS live. CSS does the repaint; this keeps `resolved` true.
  media("(prefers-color-scheme: light)")?.addEventListener("change", () => publish(get().mode));
}

export function setTheme(mode: ThemeMode) {
  if (mode === get().mode) return;
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {}
  crossfade(() => {
    paint(mode);
    publish(mode);
  });
  tell(mode).catch(() => {});
}

const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => subs.delete(cb);
};

/** The chosen mode, and what it shows right now. */
export function useTheme() {
  return useSyncExternalStore(subscribe, get);
}
