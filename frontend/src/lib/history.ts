// UNDO HISTORY. A list of states and a cursor into it, as plain functions of the
// history so every rule here is tested without React.
//
// entries[0] is where the session started (or the oldest state still kept once the cap
// drops older ones); every later entry is one change, labelled for the history menu.
// The cursor is the state on screen. Undo, redo and jumping only move the cursor; a new
// change drops whatever lay past it (the redo tail) and becomes the last entry.

export interface Entry<T> {
  state: T;
  label: string;
  /** When the entry was made, or last coalesced into (ms). */
  at: number;
  /** What it changed ("tap:1:number"), so a burst of edits to one field is one entry.
   *  Null never coalesces. */
  key: string | null;
}

export interface History<T> {
  entries: Entry<T>[];
  cursor: number;
  /** Whether the last entry may still take more of the same edit. Undo, redo and jump
   *  close it, so an edit after an undo always starts a new entry. */
  open: boolean;
}

export interface HistoryRules<T> {
  same(a: T, b: T): boolean;
  describe(before: T, after: T): string;
  /** Edits to the same key less than this far apart (ms) merge. */
  coalesceMs: number;
  /** The most changes kept; older ones go. */
  cap: number;
}

export function start<T>(state: T, at: number, label = "Session start"): History<T> {
  return { entries: [{ state, label, at, key: null }], cursor: 0, open: false };
}

export const current = <T>(h: History<T>): T => h.entries[h.cursor].state;
export const canUndo = <T>(h: History<T>) => h.cursor > 0;
export const canRedo = <T>(h: History<T>) => h.cursor < h.entries.length - 1;

/** A change to `state`. `label` overrides the described one (for things like a reset,
 *  where the cause is clearer than the diff). */
export function push<T>(
  h: History<T>,
  rules: HistoryRules<T>,
  state: T,
  meta: { at: number; key?: string | null; label?: string },
): History<T> {
  const now = h.entries[h.cursor];
  if (rules.same(now.state, state)) return h;
  const key = meta.key ?? null;
  const kept = h.entries.slice(0, h.cursor + 1);

  const merge =
    h.open &&
    key !== null &&
    h.cursor > 0 &&
    h.cursor === h.entries.length - 1 &&
    now.key === key &&
    meta.at - now.at < rules.coalesceMs;
  if (merge) {
    const before = kept[h.cursor - 1].state;
    // Dragged back to where it started: the burst undid itself, so drop the entry.
    if (rules.same(before, state)) {
      return { entries: kept.slice(0, -1), cursor: h.cursor - 1, open: false };
    }
    const entry = { state, label: meta.label ?? rules.describe(before, state), at: meta.at, key };
    return { entries: [...kept.slice(0, -1), entry], cursor: h.cursor, open: true };
  }

  const entry = { state, label: meta.label ?? rules.describe(now.state, state), at: meta.at, key };
  let entries = [...kept, entry];
  // entries[0] is the base state, so the cap counts the changes after it.
  if (entries.length > rules.cap + 1) entries = entries.slice(entries.length - rules.cap - 1);
  return { entries, cursor: entries.length - 1, open: true };
}

export function undo<T>(h: History<T>): History<T> {
  return canUndo(h) ? { ...h, cursor: h.cursor - 1, open: false } : h;
}

export function redo<T>(h: History<T>): History<T> {
  return canRedo(h) ? { ...h, cursor: h.cursor + 1, open: false } : h;
}

/** Moves the cursor to entry `i`: the state after that change. */
export function jump<T>(h: History<T>, i: number): History<T> {
  if (i < 0 || i >= h.entries.length || i === h.cursor) return { ...h, open: false };
  return { ...h, cursor: i, open: false };
}

/** The label undo would take back, or null. */
export const undoLabel = <T>(h: History<T>) => (canUndo(h) ? h.entries[h.cursor].label : null);
/** The label redo would apply, or null. */
export const redoLabel = <T>(h: History<T>) => (canRedo(h) ? h.entries[h.cursor + 1].label : null);

/** The history without the entries `gone` picks (a deleted preset's), runs of equal
 *  states that leaves merged into their first. The cursor goes to the last kept entry
 *  at or before it. Null when nothing is left. */
export function drop<T>(
  h: History<T>,
  gone: (state: T) => boolean,
  same: (a: T, b: T) => boolean,
): History<T> | null {
  const entries: Entry<T>[] = [];
  let cursor = 0;
  h.entries.forEach((e, i) => {
    if (gone(e.state)) return;
    const prev = entries[entries.length - 1];
    if (!prev || !same(prev.state, e.state)) entries.push(e);
    if (i <= h.cursor) cursor = entries.length - 1;
  });
  if (!entries.length) return null;
  if (entries.length === h.entries.length) return h;
  return { entries, cursor, open: false };
}
