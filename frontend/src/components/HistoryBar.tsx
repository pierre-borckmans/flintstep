import { History as HistoryIcon, Redo2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import * as H from "../lib/history";
import { relTime } from "../lib/midi";
import { hasOwnUndo, historyKey } from "../lib/shortcuts";
import type { Config } from "../types";
import { Button } from "../ui/Button";
import { cx } from "../ui/cx";
import { Kicker } from "../ui/Kicker";
import { Lamp } from "../ui/Lamp";
import type { Bridge } from "../useBridge";

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
  onClose,
}: {
  history: H.History<Config>;
  onJump: (i: number) => void;
  onClose: () => void;
}) {
  const now = useNow(true);
  const rows = history.entries.map((e, i) => ({ ...e, i })).reverse();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || (t as Element).closest?.("[data-history-toggle]")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="History"
      className="fade-up absolute right-2 bottom-[calc(100%+6px)] left-2 z-10 flex max-h-[320px] flex-col overflow-hidden rounded-ui-lg border border-edge-strong bg-panel shadow-pop"
    >
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
    </div>
  );
}

/** Where the mapping stands: saved, saving, or why it is not, with undo and redo and
 *  the session's history. Edits save themselves; nothing here needs pressing. */
export function HistoryBar({
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

  let lamp = <Lamp on={justSaved} colour="live" size={6} />;
  let text = <span className="text-faint">Saved</span>;
  if (st.kind === "invalid" || st.kind === "failed") {
    lamp = <Lamp on colour="hot" size={6} />;
    text = <span className="text-hot">Not saved: {st.error}</span>;
  } else if (st.kind === "pending" || st.kind === "saving") {
    lamp = <Lamp on colour="beam" size={6} />;
    text = <span className="text-muted">Saving…</span>;
  }

  const undoLabel = history && H.undoLabel(history);
  const redoLabel = history && H.redoLabel(history);
  const changes = history ? history.entries.length - 1 : 0;

  return (
    <div className="relative flex min-h-11 shrink-0 items-center gap-2.5 border-t border-edge bg-panel py-2 pr-2 pl-4">
      {lamp}
      <span
        className="min-w-0 flex-1 text-ui-sm leading-tight"
        role="status"
        title={"error" in st ? st.error : undefined}
      >
        {text}
      </span>
      <div className="flex items-center gap-0.5">
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
          title="History"
          disabled={!history}
          onClick={() => setOpen((o) => !o)}
          icon={<HistoryIcon size={13} />}
        >
          {changes > 0 && <span className="font-mono tabular-nums">{changes}</span>}
        </Button>
      </div>
      {open && history && <HistoryList history={history} onJump={jump} onClose={close} />}
    </div>
  );
}
