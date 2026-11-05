// ONE UNDO HISTORY PER PRESET. Each preset keeps its own history (history.ts), keyed by
// its id, so undo, redo and the history menu only ever touch the preset on screen, and a
// rename keeps its history. Switching presets is navigation, not a change: it puts the
// other preset's history on screen, cursor and all, and makes nothing to undo.
//
// Session only. Each history is capped by HistoryRules.cap; the number of histories kept
// is capped too, the least recently used going first (never the active one's).

import * as H from "./history";

export interface StackRules<T> extends H.HistoryRules<T> {
  /** The most presets whose history is kept. */
  stacks: number;
}

export interface Stacks<T> {
  /** The preset on screen. */
  active: string;
  /** Every kept history, least recently used first (Map order). Always has `active`. */
  byId: ReadonlyMap<string, H.History<T>>;
}

export function open<T>(id: string, state: T, at: number): Stacks<T> {
  return { active: id, byId: new Map([[id, H.start(state, at)]]) };
}

export const active = <T>(s: Stacks<T>): H.History<T> => s.byId.get(s.active)!;

/** Replaces the active preset's history (after a push, undo, redo or jump). */
export function update<T>(s: Stacks<T>, h: H.History<T>): Stacks<T> {
  if (h === active(s)) return s;
  const byId = new Map(s.byId);
  byId.set(s.active, h);
  return { ...s, byId };
}

/** Puts preset `id` on screen, Go running `state` for it. Its kept history comes back
 *  as it was left; a preset without one starts a fresh history on `state`. When the kept
 *  history's state is not `state` (changed elsewhere), that change becomes an entry,
 *  unless `keep`: the caller holds the history's state as an edit still to be saved. */
export function enter<T>(
  s: Stacks<T>,
  rules: StackRules<T>,
  id: string,
  state: T,
  at: number,
  opts: { keep?: boolean } = {},
): Stacks<T> {
  if (id === s.active) return s;
  const byId = new Map(s.byId);
  // Leaving closes the last entry: an edit after coming back is a new one.
  const left = byId.get(s.active);
  if (left) byId.set(s.active, { ...left, open: false });

  let h = byId.get(id);
  if (!h) h = H.start(state, at);
  else if (!opts.keep && !rules.same(H.current(h), state)) {
    h = { ...H.push(h, rules, state, { at }), open: false };
  }
  // Most recently used last.
  byId.delete(id);
  byId.set(id, h);
  for (const k of byId.keys()) {
    if (byId.size <= rules.stacks) break;
    if (k !== id) byId.delete(k);
  }
  return { active: id, byId };
}

/** Drops preset `id`'s history: it was deleted, or the id is new (created, duplicated,
 *  imported) and starts empty. The active preset gets a fresh history on its current
 *  state instead. */
export function forget<T>(s: Stacks<T>, id: string, at = Date.now()): Stacks<T> {
  if (!s.byId.has(id)) return s;
  const byId = new Map(s.byId);
  if (id === s.active) byId.set(id, H.start(H.current(active(s)), at));
  else byId.delete(id);
  return { ...s, byId };
}

/** Keeps the histories of the presets in `ids` (the library now), and the active one. */
export function retain<T>(s: Stacks<T>, ids: ReadonlySet<string>): Stacks<T> {
  const gone = [...s.byId.keys()].filter((k) => !ids.has(k) && k !== s.active);
  if (!gone.length) return s;
  const byId = new Map(s.byId);
  for (const k of gone) byId.delete(k);
  return { ...s, byId };
}
