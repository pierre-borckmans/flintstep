import { useSyncExternalStore } from "react";
import { EXPPOS_KEY, type PlacementPref, parsePlacement } from "./lib/exppedal";

// Where the expression pedals go on the canvas: a per-viewer look, kept in localStorage
// (which may be missing or refuse writes; then it just forgets). Browser dev: ?exppos=.

let pref: PlacementPref | null = null;
const subs = new Set<() => void>();

function get(): PlacementPref {
  if (pref) return pref;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(EXPPOS_KEY);
  } catch {}
  pref = parsePlacement(raw);
  if (document.documentElement.dataset.mock) {
    const q = new URLSearchParams(window.location.search).get("exppos");
    if (q) pref = parsePlacement(q);
  }
  return pref;
}

export function setExpPlacement(next: PlacementPref) {
  pref = next;
  try {
    localStorage.setItem(EXPPOS_KEY, next);
  } catch {}
  for (const cb of subs) cb();
}

const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => subs.delete(cb);
};

export function useExpPlacement(): PlacementPref {
  return useSyncExternalStore(subscribe, get, () => "auto");
}
