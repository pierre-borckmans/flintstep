import { useMemo, useSyncExternalStore } from "react";
import {
  NUT_KEY,
  type NutMode,
  type NutState,
  nextSeed,
  nutsFromQuery,
  parseNuts,
  serialiseNuts,
  shownAngles,
  withAngle,
  withMode,
} from "./lib/nuts";

// The nuts' store (the canvas turns them: canvas/SparkView, canvas/usePedalPointer): one per window, outside React, saved to localStorage on every change.
// Storage may be missing or refuse writes (private windows, previews); the toy still works,
// it just forgets.

let state: NutState | null = null;
/** Browser dev only (?nutpeek): every readout showing, for screenshots. */
let peek = false;
const subs = new Set<() => void>();

function get(): NutState {
  if (state) return state;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(NUT_KEY);
  } catch {}
  state = parseNuts(raw, nextSeed(0));
  if (document.documentElement.dataset.mock) {
    const q = new URLSearchParams(window.location.search);
    state = nutsFromQuery(q, state) ?? state;
    peek = q.has("nutpeek");
  }
  return state;
}

function set(next: NutState) {
  if (next === state) return;
  state = next;
  try {
    localStorage.setItem(NUT_KEY, serialiseNuts(next));
  } catch {}
  for (const cb of subs) cb();
}

const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => subs.delete(cb);
};

export const nuts = {
  setMode: (mode: NutMode) => set(withMode(get(), mode)),
  shuffle: () => {
    const s = get();
    set({ ...s, mode: "shuffled", seed: nextSeed(s.seed) });
  },
  setAngle: (i: number, deg: number) => set(withAngle(get(), i, deg)),
  resetAll: () => set({ ...get(), custom: Array(6).fill(0) }),
};

/** The nuts' settings, and the angle each one shows. */
export function useNuts() {
  const s = useSyncExternalStore(subscribe, get);
  const angles = useMemo(() => shownAngles(s), [s]);
  return { ...s, angles, peek };
}
