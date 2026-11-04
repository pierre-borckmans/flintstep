// The undo keys, as pure functions of the event and the focused element.

export type HistoryKey = "undo" | "redo";

/** ⌘Z undoes; ⇧⌘Z and ⌘Y redo. Ctrl stands in for ⌘ off the Mac. */
export function historyKey(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): HistoryKey | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (k === "z") return e.shiftKey ? "redo" : "undo";
  if (k === "y" && !e.shiftKey) return "redo";
  return null;
}

/** Inputs that don't take text: the app's undo applies even with one focused. */
const NOT_TEXT = new Set(["range", "checkbox", "radio", "button", "submit", "reset", "color"]);

/** Whether the focused element has an undo of its own (text being typed), which the
 *  app's undo must leave alone. */
export function hasOwnUndo(
  el: { tagName: string; type?: string; isContentEditable?: boolean } | null,
): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toUpperCase();
  if (tag === "TEXTAREA") return true;
  return tag === "INPUT" && !NOT_TEXT.has((el.type || "text").toLowerCase());
}
