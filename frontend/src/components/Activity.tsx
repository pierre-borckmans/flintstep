import { useEffect, useState } from "react";
import { describeMidi, relTime } from "../lib/midi";
import type { Midi } from "../types";
import { cx } from "../ui/cx";
import { Kicker } from "../ui/Kicker";
import { Lamp } from "../ui/Lamp";
import type { LoggedActivity } from "../useBridge";

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

export function ActivityLog({ log, midi }: { log: LoggedActivity[]; midi: Midi | null }) {
  const lastOut = log.find((a) => a.dir === "out");
  const lastIn = log.find((a) => a.dir === "in");
  const outOn = useBlink(lastOut?.id);
  const inOn = useBlink(lastIn?.id);
  const now = useNow();

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-ui-lg border border-edge bg-panel shadow-card">
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-edge px-3">
        <Kicker>MIDI activity</Kicker>
        <div className="flex-1" />
        <span className="flex items-center gap-1.5 text-ui-xs text-muted" title={midi?.source}>
          <Lamp on={outOn} colour="live" size={6} />
          out
        </span>
        <span className="flex items-center gap-1.5 text-ui-xs text-muted" title={midi?.dest}>
          <Lamp on={inOn} colour="cold" size={6} />
          in
        </span>
      </div>
      {log.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
          <span className="text-ui-md text-muted">Nothing yet</span>
          <span className="text-ui-sm text-faint">
            Press a switch. Each message sent to “{midi?.source || "Spark Control X"}” shows up
            here.
          </span>
        </div>
      ) : (
        <ol className="scroll-y min-h-0 flex-1 py-1 font-mono text-ui-sm">
          {log.map((a) => (
            <li
              key={a.id}
              className="row-in grid grid-cols-[30px_1fr_auto] items-center gap-2 px-3 py-[3px]"
              title={a.bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ")}
            >
              <span
                className={cx(
                  "text-ui-2xs font-semibold tracking-kicker uppercase",
                  a.dir === "out" ? "text-muted" : "text-cold",
                )}
              >
                {a.dir === "out" ? "OUT" : "IN"}
              </span>
              <span className="truncate text-text/90">{a.label || describeMidi(a.bytes)}</span>
              <span className="text-ui-xs text-faint tabular-nums">{relTime(a.at, now)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
