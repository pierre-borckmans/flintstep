import { History as HistoryIcon, Redo2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SaveStatus } from "../lib/autosave";
import * as H from "../lib/history";
import { relTime } from "../lib/midi";
import { calmStart, type Shown, settle, shownOf } from "../lib/savestatus";
import { hasOwnUndo, historyKey } from "../lib/shortcuts";
import type { Config } from "../types";
import { Button } from "../ui/Button";
import { cx } from "../ui/cx";
import { Kicker } from "../ui/Kicker";
import { Lamp } from "../ui/Lamp";
import { Popover } from "../ui/Popover";
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

/** What the save word shows: the status, calmed (lib/savestatus) so quick saves do not
 *  flicker "Saving…" and a shown "Saving…" does not vanish at once. */
function useCalmStatus(st: SaveStatus): Shown {
  const actual = shownOf(st);
  const calm = useRef(calmStart);
  const [shown, setShown] = useState<Shown>(calmStart.shown);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = () => {
      const r = settle(calm.current, actual, Date.now());
      calm.current = r.calm;
      setShown(r.calm.shown);
      if (r.wakeIn !== null) timer = setTimeout(look, r.wakeIn);
    };
    look();
    return () => clearTimeout(timer);
  }, [actual]);
  return shown;
}

const WORDS: { id: Shown; text: string; className: string }[] = [
  { id: "saved", text: "Saved", className: "text-faint" },
  { id: "saving", text: "Saving…", className: "text-muted" },
  { id: "fault", text: "Not saved", className: "text-hot" },
];

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

/** One preset's changes this session, newest first. The lit row is what the pedal has
 *  now; rows above it were undone and are still there to redo. Clicking a row goes to
 *  it, the same as undoing or redoing that far. Each preset has its own; switching
 *  presets is not a change. */
function HistoryList({
  history,
  preset,
  onJump,
}: {
  history: H.History<Config>;
  preset: string;
  onJump: (i: number) => void;
}) {
  const now = useNow(true);
  const rows = history.entries.map((e, i) => ({ ...e, i })).reverse();
  const title = preset ? `History · ${preset}` : "History";

  return (
    <>
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-edge px-3">
        <h2 className="flex min-w-0 flex-1 items-baseline gap-1.5" title={title}>
          <Kicker className="shrink-0">History</Kicker>
          {preset && (
            <span className="truncate text-ui-xs text-text/90">
              <span className="text-faint">· </span>
              {preset}
            </span>
          )}
        </h2>
        <span className="shrink-0 text-ui-2xs text-faint">this session</span>
      </div>
      {history.entries.length === 1 ? (
        <p className="px-3 py-4 text-ui-sm text-muted">
          No changes to {preset ? <span className="text-text">{preset}</span> : "this preset"} yet.
        </p>
      ) : (
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
                  title={`${e.label}\n${
                    here
                      ? "Where the preset is now"
                      : undone
                        ? "Undone. Click to redo up to here"
                        : "Click to go back to here"
                  }`}
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
      )}
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
  const preset = bridge.presets.list.find((p) => p.id === bridge.presets.active)?.name ?? "";
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
  // The three words share one slot as wide as the widest, so nothing moves when it
  // changes: they cross-fade in place.
  const shown = useCalmStatus(st);
  let lamp = <Lamp on={justSaved} colour="live" size={6} />;
  let tip = savedAt
    ? `Saved at ${new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}\nEvery change saves itself`
    : "Every change saves itself";
  if (shown === "fault") {
    lamp = <Lamp on colour="hot" size={6} />;
    tip = st.kind === "invalid" || st.kind === "failed" ? `Not saved\n${st.error}` : "Not saved";
  } else if (shown === "saving") {
    lamp = <Lamp on colour="beam" size={6} />;
    tip = "Saving the latest change";
  }

  const undoLabel = history && H.undoLabel(history);
  const redoLabel = history && H.redoLabel(history);
  const changes = history ? history.entries.length - 1 : 0;

  return (
    <div className="history-controls relative flex shrink-0 items-center gap-0.5">
      <span
        className="history-status flex items-center gap-1.5 pr-1.5 pl-1 text-ui-sm leading-none"
        role="status"
        title={tip}
      >
        {lamp}
        <span className="history-word" data-shown={shown}>
          {WORDS.map((w) => (
            <span
              key={w.id}
              data-word={w.id}
              className={w.className}
              aria-hidden={w.id !== shown || undefined}
            >
              {w.text}
            </span>
          ))}
        </span>
      </span>
      <Button
        size="sm"
        kind="ghost"
        aria-label="Undo"
        title={undoLabel ? `Undo ${undoLabel}` : "Nothing to undo"}
        data-kbd={undoLabel ? "⌘Z" : undefined}
        disabled={!undoLabel}
        onClick={undo}
        icon={<Undo2 size={13} />}
      />
      <Button
        size="sm"
        kind="ghost"
        aria-label="Redo"
        title={redoLabel ? `Redo ${redoLabel}` : "Nothing to redo"}
        data-kbd={redoLabel ? "⇧⌘Z" : undefined}
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
        title={
          changes > 0
            ? `History\n${changes} change${changes === 1 ? "" : "s"} to ${preset || "this preset"} this session`
            : "History\nNo changes this session yet"
        }
        disabled={!history}
        onClick={() => setOpen((o) => !o)}
        icon={<HistoryIcon size={13} />}
      >
        {/* Always there and two digits wide, so the first change does not widen it. */}
        <span className="min-w-[2ch] text-left font-mono tabular-nums">
          {changes > 0 ? changes : ""}
        </span>
      </Button>
      <Popover
        open={open && !!history}
        onClose={close}
        ignore="[data-history-toggle]"
        label="History"
        className="absolute top-[calc(100%+10px)] right-0 z-30 flex max-h-[min(360px,calc(100vh-80px))] w-[300px] flex-col overflow-hidden rounded-ui-lg border border-edge-strong bg-panel shadow-pop"
      >
        {history && <HistoryList history={history} preset={preset} onJump={jump} />}
      </Popover>
    </div>
  );
}
