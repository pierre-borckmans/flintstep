import { useCallback, useMemo, useRef, useState } from "react";
import { type Backend, errorText } from "../api";
import { rawFraction } from "../lib/exp";
import { pointerFraction, simKey } from "../lib/expsim";
import type { State } from "../types";
import { cx } from "../ui/cx";
import { Kicker } from "../ui/Kicker";
import { Toggle } from "../ui/Toggle";

/** The simulated expression pedals, as the Expression cards (and the drawn treadle) drive
 *  them: State.expSim / State.expSweep and the three bindings. */
export interface SimControls {
  on: boolean[];
  sweep: boolean[];
  simulate(n: number, on: boolean): Promise<void>;
  /** 0 heel .. 1 toe. Turns the simulation on and stops a sweep. */
  position(n: number, f: number): Promise<void>;
  setSweep(n: number, on: boolean): Promise<void>;
}

const NONE: boolean[] = [false, false];

/** SimControls over the backend and the latest State. The functions keep their identity
 *  across state pushes; only on/sweep change. */
export function useSimControls(backend: Backend, state: State | null): SimControls {
  const on = state?.expSim ?? NONE;
  const sweep = state?.expSweep ?? NONE;
  const [on0, on1, sw0, sw1] = [!!on[0], !!on[1], !!sweep[0], !!sweep[1]];
  const calls = useMemo(
    () => ({
      simulate: (n: number, v: boolean) => backend.SimulateExp(n, v),
      position: (n: number, f: number) => backend.SetSimExp(n, f),
      setSweep: (n: number, v: boolean) => backend.SimSweep(n, v),
    }),
    [backend],
  );
  return useMemo(
    () => ({ on: [on0, on1], sweep: [sw0, sw1], ...calls }),
    [on0, on1, sw0, sw1, calls],
  );
}

/** The small "SIMULATED" tag beside an input's title. */
export function SimTag() {
  return (
    <span className="rounded-ui-sm border border-beam/50 px-1 py-px font-mono text-[9px] leading-none font-semibold tracking-kicker text-beam">
      SIMULATED
    </span>
  );
}

/** Sends positions one at a time, always the latest: a fast drag never queues up calls
 *  behind a slow one, and the last position always lands. */
function useLatest(send: (f: number) => Promise<void>, onError: (e: unknown) => void) {
  const pending = useRef<number | null>(null);
  const busy = useRef(false);
  const pump = useCallback(() => {
    if (busy.current || pending.current === null) return;
    const f = pending.current;
    pending.current = null;
    busy.current = true;
    send(f)
      .catch(onError)
      .finally(() => {
        busy.current = false;
        pump();
      });
  }, [send, onError]);
  return useCallback(
    (f: number) => {
      pending.current = f;
      pump();
    },
    [pump],
  );
}

/** Heel ↔ toe: a groove with a metal cap. Drag anywhere on it (it jumps to the pointer
 *  first) or use the arrow keys. While idle it follows the reading, so a sweep shows. */
function PositionSlider({
  n,
  raw,
  onMove,
}: {
  n: number;
  raw: number;
  onMove: (f: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const f = drag ?? (raw >= 0 ? rawFraction(raw) : 0);

  const at = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    return r ? pointerFraction(clientX, r.left, r.width) : 0;
  };
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const move = (v: number) => {
    clearTimeout(settle.current);
    setDrag(v);
    onMove(v);
  };
  // Hold the dropped position a moment: the reading that confirms it is a state push
  // (~20/s) away, and following the old one meanwhile would flick the cap back.
  const release = () => {
    clearTimeout(settle.current);
    settle.current = setTimeout(() => setDrag(null), 250);
  };
  const dragging = drag !== null;

  return (
    <div
      ref={track}
      role="slider"
      tabIndex={0}
      aria-label={`EXP ${n + 1} simulated position`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(f * 100)}
      aria-valuetext={`${Math.round(f * 100)} % toward the toe`}
      className="group relative h-[18px] flex-1 cursor-ew-resize touch-none outline-none select-none"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        move(at(e.clientX));
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) move(at(e.clientX));
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onKeyDown={(e) => {
        const v = simKey(e.key, f, e.shiftKey);
        if (v === null) return;
        e.preventDefault();
        onMove(v);
      }}
    >
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full border border-edge bg-sunken inset-shadow-deep">
        <div
          className="absolute inset-y-0 left-0"
          style={{
            width: `${f * 100}%`,
            background:
              "linear-gradient(90deg, color-mix(in srgb, var(--color-beam) 25%, transparent), var(--color-beam))",
            transition: dragging ? "none" : "width 60ms linear",
          }}
        />
      </div>
      <span
        className="absolute top-1/2 h-[14px] w-[14px] -translate-x-1/2 -translate-y-1/2 rounded-full group-focus-visible:ring-2 group-focus-visible:ring-beam/60"
        style={{
          left: `${f * 100}%`,
          background: "var(--cap)",
          boxShadow: "var(--cap-shadow)",
          transition: dragging ? "none" : "left 60ms linear",
        }}
      />
    </div>
  );
}

/** "Simulate pedal": stands in for an expression pedal on a jack with no cable, so the
 *  whole path (calibration, CC, trigger, MIDI out) can be tried without one. */
export function SimRow({
  n,
  sim,
  realCable,
  raw,
}: {
  n: number;
  sim: SimControls;
  /** A real pedal is plugged into this jack: simulation is not available. */
  realCable: boolean;
  /** The input's raw reading (the simulated one while on), -1 for none. */
  raw: number;
}) {
  const on = !!sim.on[n];
  const sweeping = !!sim.sweep[n];
  const [err, setErr] = useState<string | null>(null);
  const fail = useCallback((e: unknown) => setErr(errorText(e)), []);
  const run = (p: Promise<void>) => p.then(() => setErr(null)).catch(fail);
  const send = useCallback((f: number) => sim.position(n, f), [sim, n]);
  const moveTo = useLatest(send, fail);

  return (
    <div className="flex flex-col gap-2 border-t border-edge pt-2.5">
      <div className="flex items-center gap-2">
        <Kicker className={cx(realCable && "!text-faint")}>Simulate pedal</Kicker>
        <div className="flex-1" />
        {realCable && <span className="text-ui-xs text-faint">a real pedal is plugged in</span>}
        <Toggle
          label={`Simulate a pedal on EXP ${n + 1}`}
          on={on && !realCable}
          disabled={realCable}
          onChange={(v) => run(sim.simulate(n, v))}
        />
      </div>
      {on && !realCable && (
        <div className="flex items-center gap-2">
          <span className="font-mono text-ui-2xs text-faint uppercase">heel</span>
          <PositionSlider n={n} raw={raw} onMove={moveTo} />
          <span className="font-mono text-ui-2xs text-faint uppercase">toe</span>
          <span className="ml-2 text-ui-xs text-muted">Sweep</span>
          <Toggle
            label={`Sweep EXP ${n + 1} heel to toe`}
            on={sweeping}
            onChange={(v) => run(sim.setSweep(n, v))}
          />
        </div>
      )}
      {err && <p className="text-ui-xs text-hot">{err}</p>}
    </div>
  );
}
