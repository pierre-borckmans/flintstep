import { ArrowDownLeft, ArrowUpRight, Eraser } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { describeRow, type LogEntry, type RowModel, type Target } from "../lib/activity";
import { relTime } from "../lib/midi";
import { MIDI_PORT_NAME } from "../product";
import type { Config, Midi } from "../types";
import { Button } from "../ui/Button";
import { cx } from "../ui/cx";
import { Kicker } from "../ui/Kicker";
import { Lamp } from "../ui/Lamp";

/** One lamp per direction that flashes on each message: an LED, so it is on for a
 *  moment and then off, with no fade. */
function useBlink(id: number | undefined, ms = 70) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (id === undefined) return;
    setOn(true);
    const t = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(t);
  }, [id]);
  return on;
}

function useNow(every = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}

function Row({
  a,
  m,
  cont,
  fresh,
  now,
  onSelect,
}: {
  a: LogEntry;
  m: RowModel;
  /** The row below came from the same place: the chip steps back. */
  cont: boolean;
  fresh: boolean;
  now: number;
  onSelect: (t: Target) => void;
}) {
  const out = a.dir === "out";
  const target = m.chip.target;
  return (
    <li
      className={cx("activity-row", fresh ? "log-open" : "row-in")}
      title={`${a.label || m.hex}\n${m.hex}`}
    >
      <span className="act-time">{relTime(a.at, now)}</span>
      <span className={cx("act-dir", out ? "text-faint" : "text-cold")}>
        {out ? (
          <ArrowUpRight size={11} aria-label="out" />
        ) : (
          <ArrowDownLeft size={11} aria-label="in" />
        )}
      </span>
      <span className="min-w-0">
        <button
          type="button"
          className="act-chip"
          data-tone={m.chip.tone}
          data-cont={cont || undefined}
          title={target ? `${m.chip.title}\nClick to show it` : m.chip.title}
          disabled={!target}
          onClick={() => target && onSelect(target)}
        >
          {m.chip.text}
        </button>
      </span>
      <span className="act-type" data-type={m.type}>
        {m.typeText}
      </span>
      <span className="act-num">
        {m.number}
        {m.numberSub && <span className="text-faint"> {m.numberSub}</span>}
      </span>
      <span className="act-value">
        {m.bar !== null && (
          <span className="act-bar" aria-hidden>
            <span style={{ width: `${Math.round(m.bar * 100)}%` }} />
          </span>
        )}
        <span data-tone={m.valueTone}>{m.value}</span>
        {a.count > 1 && (
          <span className="act-count" title={`${a.count} messages in a row`}>
            ×{a.count}
          </span>
        )}
      </span>
      <span className="act-ch">{m.channel}</span>
    </li>
  );
}

export function ActivityLog({
  log,
  total,
  midi,
  config,
  onClear,
  onSelect,
}: {
  log: LogEntry[];
  /** Messages since the last clear, the folded ones included. */
  total: number;
  midi: Midi | null;
  config: Config | null;
  onClear: () => void;
  onSelect: (t: Target) => void;
}) {
  const lastOut = log.find((a) => a.dir === "out");
  const lastIn = log.find((a) => a.dir === "in");
  const outOn = useBlink(lastOut?.seq);
  const inOn = useBlink(lastIn?.seq);
  const now = useNow();
  // Rows already there when the panel mounts just show; later ones open in at the top.
  const first = useRef<number | null>(null);
  if (first.current === null) first.current = log[0]?.id ?? -1;
  const rows = log.map((a) => ({ a, m: describeRow(a, config) }));

  // ⌘K clears, while the log has the focus: a click anywhere on it gives it the focus
  // (programmatic only, so it is no extra tab stop; its chips and Clear are).
  const panel = useRef<HTMLElement>(null);
  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      onClear();
    }
  };

  return (
    <section
      ref={panel}
      className="activity-panel"
      aria-label="MIDI activity"
      tabIndex={-1}
      onKeyDown={onKey}
      onPointerDown={(e) => {
        if (!(e.target as HTMLElement).closest("button")) panel.current?.focus();
      }}
    >
      <div className="activity-heading">
        <Kicker>MIDI activity</Kicker>
        <span className="activity-count" title="Since the log was last cleared">
          {total} {total === 1 ? "message" : "messages"}
        </span>
        <div className="flex-1" />
        <span className="flex items-center gap-1.5 text-ui-xs text-muted" title={midi?.source}>
          <Lamp on={outOn} colour="live" size={6} />
          out
        </span>
        <span className="flex items-center gap-1.5 text-ui-xs text-muted" title={midi?.dest}>
          <Lamp on={inOn} colour="cold" size={6} />
          in
        </span>
        <Button
          size="sm"
          kind="ghost"
          className="-mr-2 w-6 px-0"
          aria-label="Clear the log"
          title="Clear the log (⌘K)"
          disabled={log.length === 0}
          onClick={onClear}
          icon={<Eraser size={13} />}
        />
      </div>
      {log.length === 0 ? (
        <div className="activity-empty">
          <span className="text-ui-md text-muted">Listening for MIDI</span>
          <span className="text-ui-sm text-faint">
            Press a switch. Messages sent to “{midi?.source || MIDI_PORT_NAME}” appear here.
          </span>
        </div>
      ) : (
        <ol className="activity-list scroll-y" aria-label="MIDI messages, newest first">
          {rows.map(({ a, m }, i) => (
            <Row
              key={a.id}
              a={a}
              m={m}
              cont={rows[i + 1]?.m.chip.text === m.chip.text}
              fresh={a.id > first.current!}
              now={now}
              onSelect={onSelect}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
