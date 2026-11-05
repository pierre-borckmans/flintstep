import type { SaveStatus } from "./autosave";

// THE HEADER'S SAVE WORD, CALMED.
//
// Autosave flips between saved, pending and saving several times a second while the
// user drags a slider. Shown as is, the word would flicker. So: a save that finishes
// within SHOW_AFTER_MS never shows "Saving…" at all; once "Saving…" shows, it stays at
// least HOLD_MS. A fault shows at once.

export const SHOW_AFTER_MS = 150;
export const HOLD_MS = 250;

export type Shown = "saved" | "saving" | "fault";

export interface Calm {
  shown: Shown;
  /** When shown last changed. */
  since: number;
  /** When the current busy spell began, while it has not shown yet. */
  busySince: number | null;
}

export const calmStart: Calm = { shown: "saved", since: 0, busySince: null };

export function shownOf(st: SaveStatus): Shown {
  if (st.kind === "invalid" || st.kind === "failed") return "fault";
  if (st.kind === "pending" || st.kind === "saving") return "saving";
  return "saved";
}

/** The next calm state for the actual one at now, and when to look again (ms), or null
 *  when nothing is waiting. */
export function settle(c: Calm, actual: Shown, now: number): { calm: Calm; wakeIn: number | null } {
  const to = (shown: Shown): Calm =>
    shown === c.shown ? { ...c, busySince: null } : { shown, since: now, busySince: null };
  if (actual === "fault") return { calm: to("fault"), wakeIn: null };
  if (actual === "saving") {
    if (c.shown === "saving") return { calm: { ...c, busySince: null }, wakeIn: null };
    const from = c.busySince ?? now;
    const left = SHOW_AFTER_MS - (now - from);
    if (left <= 0) return { calm: to("saving"), wakeIn: null };
    return { calm: { ...c, busySince: from }, wakeIn: left };
  }
  if (c.shown === "saving") {
    const left = HOLD_MS - (now - c.since);
    if (left > 0) return { calm: c, wakeIn: left };
  }
  return { calm: to("saved"), wakeIn: null };
}
