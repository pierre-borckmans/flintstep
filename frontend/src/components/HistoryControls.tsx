import { History as HistoryIcon, Redo2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import * as H from "../lib/history";
import { relTime } from "../lib/midi";
import { hasOwnUndo, historyKey } from "../lib/shortcuts";

import { Button } from "../ui/Button";
import { cx } from "../ui/cx";
import { Kicker } from "../ui/Kicker";
import { Lamp } from "../ui/Lamp";
import { Popover } from "../ui/Popover";
import type { Bridge, Snap } from "../useBridge";

/** ⌘Z, ⇧⌘Z and ⌘Y anywhere but a text field, which keeps its own undo. */
function useHistoryKeys(undo: () => void, redo: () => void, flush: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘S out of habit: there is nothing to save by hand, but send what is waiting.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        flush();
        return;
      }
      const k = historyKey(e);
      if (!k || hasOwnUndo(document.activeElement as HTMLElement | null)) return;
      e.preventDefault();
      if (k === "undo") undo();
      else redo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, flush]);
}

function useNow(on: boolean, every = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [on, every]);
  return now;
}

/** The session's changes, newest first. The lit row is what the pedal has now; rows
 *  above it were undone and are still there to redo. Clicking a row goes to it, the same
 *  as undoing or redoing that far. */
function HistoryList({
  history,
  onJump,
}: {
  history: H.History<Snap>;
  onJump: (i: number) => void;
}) {
  const now = useNow(true);
  const rows = history.entries.map((e, i) => ({ ...e, i })).reverse();

  return (
    <>
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-edge px-3">
        <Kicker>History</Kicker>
        <div className="flex-1" />
        <span className="text-ui-2xs text-faint">this session</span>
      </div>
      <ol className="scroll-y min-h-0 flex-1 py-1">
        {rows.map((e) => {
          const here = e.i === history.cursor;
          const undone = e.i > history.cursor;
          return (
            <li key={`${e.i}-${e.at}`}>
              <button
                type="button"
                onClick={() => onJump(e.i)}
                aria-current={here ? "step" : undefined}
                className={cx(
                  "grid w-full grid-cols-[6px_1fr_auto] items-center gap-2.5 px-3 py-[5px] text-left transition-[color,background-color] duration-(--dur) ease-(--ease)",
                  here ? "bg-panel2" : "hover:warm",
                )}
              >
                <Lamp on={here} colour="beam" size={5} />
                <span
                  className={cx(
                    "truncate text-ui-sm",
                    here ? "text-bone" : undone ? "text-faint" : "text-text/90",
                    e.i === 0 && !here && "text-muted",
                  )}
                  title={e.label}
                >
                  {e.label}
                </span>
                <span className="font-mono text-ui-2xs text-faint tabular-nums">
                  {relTime(e.at, now)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** Where the mapping stands (saved, saving, or not, and why in the tooltip), with undo,
 *  redo and the session's history: a compact group in the window header. Edits save
 *  themselves; nothing here needs pressing. */
export function HistoryControls({
  bridge,
  initialOpen = false,
}: {
  bridge: Bridge;
  initialOpen?: boolean;
}) {
  const { saveStatus: st, savedAt, history, undo, redo, jump, flush } = bridge;
  const [open, setOpen] = useState(initialOpen);
  const [justSaved, setJustSaved] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useHistoryKeys(undo, redo, flush);

  useEffect(() => {
    if (!savedAt) return;
    setJustSaved(true);
    const t = setTimeout(() => setJustSaved(false), 1600);
    return () => clearTimeout(t);
  }, [savedAt]);

  // A small lamp and one short word; the whole story (the error) is in the tooltip.
  let lamp = <Lamp on={justSaved} colour="live" size={6} />;
  let word = <span className="text-faint">Saved</span>;
  let tip = savedAt ? "Saved. Every change saves itself." : "Every change saves itself.";
  if (st.kind === "invalid" || st.kind === "failed") {
    lamp = <Lamp on colour="hot" size={6} />;
    word = <span className="text-hot">Not saved</span>;
    tip = `Not saved: ${st.error}`;
  } else if (st.kind === "pending" || st.kind === "saving") {
    lamp = <Lamp on colour="beam" size={6} />;
    word = <span className="text-muted">Saving…</span>;
    tip = "Saving…";
  }

  const undoLabel = history && H.undoLabel(history);
  const redoLabel = history && H.redoLabel(history);
  const changes = history ? history.entries.length - 1 : 0;
  const fault = st.kind === "invalid" || st.kind === "failed";

  return (
    <div className="history-controls relative flex shrink-0 items-center gap-0.5">
      <span
        className="history-status flex items-center gap-1.5 pr-1.5 pl-1 text-ui-sm leading-none"
        role="status"
        title={tip}
      >
        {lamp}
        <span className="history-word whitespace-nowrap" data-fault={fault || undefined}>
          {word}
        </span>
      </span>
      <Button
        size="sm"
        kind="ghost"
        aria-label="Undo"
        title={undoLabel ? `Undo ${undoLabel} (⌘Z)` : "Nothing to undo"}
        disabled={!undoLabel}
        onClick={undo}
        icon={<Undo2 size={13} />}
      />
      <Button
        size="sm"
        kind="ghost"
        aria-label="Redo"
        title={redoLabel ? `Redo ${redoLabel} (⇧⌘Z)` : "Nothing to redo"}
        disabled={!redoLabel}
        onClick={redo}
        icon={<Redo2 size={13} />}
      />
      <Button
        size="sm"
        kind={open ? "primary" : "ghost"}
        data-history-toggle
        aria-label="History"
        aria-expanded={open}
        title={changes > 0 ? `History: ${changes} change${changes === 1 ? "" : "s"}` : "History"}
        disabled={!history}
        onClick={() => setOpen((o) => !o)}
        icon={<HistoryIcon size={13} />}
      >
        {changes > 0 && <span className="font-mono tabular-nums">{changes}</span>}
      </Button>
      <Popover
        open={open && !!history}
        onClose={close}
        ignore="[data-history-toggle]"
        label="History"
        className="absolute top-[calc(100%+10px)] right-0 z-30 flex max-h-[min(360px,calc(100vh-80px))] w-[300px] flex-col overflow-hidden rounded-ui-lg border border-edge-strong bg-panel shadow-pop"
      >
        {history && <HistoryList history={history} onJump={jump} />}
      </Popover>
    </div>
  );
}
