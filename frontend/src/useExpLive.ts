import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Backend } from "./api";
import { errorText } from "./api";
import type { Op } from "./lib/config";
import { localStore } from "./lib/storage";
import {
  IDLE_CAPTURE,
  MIN_SWEEP_SPAN,
  type Seen,
  sweepPatch,
  sweepVerdict,
  TOO_SMALL,
  widenCalibration,
} from "./lib/sweep";
import { createRing, lastSample, pushSample, type Ring } from "./lib/trace";
import { STORAGE_PREFIX } from "./product";
import type { Capture, Config, State } from "./types";

/** Samples kept per input: 8 s at the pedal's ~60 Hz, with room to spare. */
const RING_SIZE = 1024;
/** How often a running sweep is checked for its end. */
const VERDICT_EVERY_MS = 100;
const LEARN_KEY = `${STORAGE_PREFIX}expLearn`;
/** Widenings closer together than this are one history entry. */
const BURST_MS = 5000;

/** Whether each input learns its range while played: on unless turned off here. */
function readLearn(): boolean[] {
  try {
    const v = JSON.parse(localStore()?.getItem(LEARN_KEY) ?? "null");
    if (Array.isArray(v)) return [v[0] !== false, v[1] !== false];
  } catch {
    // The default.
  }
  return [true, true];
}

function writeLearn(v: boolean[]) {
  try {
    localStore()?.setItem(LEARN_KEY, JSON.stringify(v));
  } catch {
    // Kept for this session only.
  }
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Everything live about the expression inputs beyond the State: each one's raw trace
 *  (a ring buffer fed by the "expraw" event, every value Go saw), the lowest and highest
 *  values seen this session (for the calibration hint), calibrating by sweeping, and
 *  learning the range while playing.
 *
 *  `applyAs` is useBridge's: a sweep's calibration and a learnt widening are edits with
 *  their own history label, saved by the autosave like any other. */
export function useExpLive(
  backend: Backend,
  state: State | null,
  config: Config | null,
  applyAs: (op: Op, label: string, key?: string | null, burst?: number | null) => void,
) {
  const rings = useRef<Ring[]>([createRing(RING_SIZE), createRing(RING_SIZE)]).current;
  const seenRef = useRef<Seen[]>([
    { low: -1, high: -1 },
    { low: -1, high: -1 },
  ]);
  const [seen, setSeen] = useState<Seen[]>(seenRef.current);
  const [errors, setErrors] = useState<(string | null)[]>([null, null]);
  const [learn, setLearnState] = useState<boolean[]>(readLearn);
  const learnRef = useRef(learn);
  learnRef.current = learn;
  const configRef = useRef(config);
  configRef.current = config;
  /** The sweeps already finished or given up, by start time: a state push still showing
   *  one as running must not end it twice. */
  const ended = useRef<number[]>([0, 0]);

  const note = useCallback((n: number, v: number) => {
    const s = seenRef.current[n];
    if (v < 0 || (s.low >= 0 && v >= s.low && v <= s.high)) return;
    const next = [...seenRef.current];
    next[n] = { low: s.low < 0 ? v : Math.min(s.low, v), high: Math.max(s.high, v) };
    seenRef.current = next;
    setSeen(next);
  }, []);

  // Every raw value, batched by Go while a card watches.
  useEffect(
    () =>
      backend.onExpRaw((e) => {
        e.samples.forEach((xs, n) => {
          if (!rings[n] || xs.length === 0) return;
          let lo = Number.POSITIVE_INFINITY;
          let hi = Number.NEGATIVE_INFINITY;
          for (const s of xs) {
            pushSample(rings[n], s.t, s.v);
            lo = Math.min(lo, s.v);
            hi = Math.max(hi, s.v);
          }
          note(n, lo);
          note(n, hi);
        });
      }),
    [backend, note, rings],
  );

  // The state's value starts an empty trace (a pedal at rest sends nothing) and counts
  // towards what was seen.
  const raw0 = state?.pedal.expRaw?.[0] ?? -1;
  const raw1 = state?.pedal.expRaw?.[1] ?? -1;
  useEffect(() => {
    [raw0, raw1].forEach((v, n) => {
      if (v < 0) return;
      if (!lastSample(rings[n])) pushSample(rings[n], Date.now(), v);
      note(n, v);
    });
  }, [raw0, raw1, note, rings]);

  // Learning the range: Go proposes, the screen applies, if the user lets it. A burst
  // (widenings under BURST_MS apart) is one history entry: its id is negative, so it
  // never meets a drag's.
  const bursts = useRef([
    { id: 0, at: 0 },
    { id: 0, at: 0 },
  ]);
  const burstSeq = useRef(0);
  useEffect(
    () =>
      backend.onExpWiden(({ n, low, high }) => {
        const c = configRef.current;
        if (!c || !learnRef.current[n]) return;
        const patch = widenCalibration(c.exp[n], low, high);
        if (!patch) return;
        const now = Date.now();
        const b = bursts.current[n];
        if (now - b.at > BURST_MS) b.id = -++burstSeq.current;
        b.at = now;
        applyAs({ type: "exp", n, patch }, `Exp ${n + 1} · range widened`, `widen:${n}`, b.id);
      }),
    [backend, applyAs],
  );

  // The trace's stream runs while any card is on screen.
  const watchers = useRef(0);
  const watch = useCallback(() => {
    if (watchers.current++ === 0) void backend.WatchExpRaw(true);
    return () => {
      if (--watchers.current === 0) void backend.WatchExpRaw(false);
    };
  }, [backend]);

  const setError = useCallback((n: number, e: string | null) => {
    setErrors((xs) => (xs[n] === e ? xs : xs.map((x, i) => (i === n ? e : x))));
  }, []);

  const start = useCallback(
    async (n: number) => {
      setError(n, null);
      try {
        await backend.StartExpSweep(n);
      } catch (e) {
        setError(n, capitalise(errorText(e)));
      }
    },
    [backend, setError],
  );

  const cancel = useCallback(
    async (n: number) => {
      setError(n, null);
      await backend.CancelExpSweep(n).catch(() => {});
    },
    [backend, setError],
  );

  /** Ends input n's sweep and applies it: one edit, one history entry, one save. */
  const finish = useCallback(
    async (n: number) => {
      try {
        const r = await backend.FinishExpSweep(n);
        setError(n, null);
        note(n, r.low);
        note(n, r.high);
        applyAs({ type: "exp", n, patch: sweepPatch(r) }, `Exp ${n + 1} · calibrated by sweeping`);
        return true;
      } catch (e) {
        setError(n, capitalise(errorText(e)));
        return false;
      }
    },
    [applyAs, backend, note, setError],
  );

  const captures: Capture[] = state?.expCapture ?? [IDLE_CAPTURE, IDLE_CAPTURE];
  const capRef = useRef(captures);
  capRef.current = captures;
  const anyOn = captures.some((c) => c.on);

  // A running sweep ends on its own: at rest once it has enough, or at the time limit.
  useEffect(() => {
    if (!anyOn) return;
    const id = setInterval(() => {
      capRef.current.forEach((c, n) => {
        if (!c.on || ended.current[n] === c.startedAt) return;
        const v = sweepVerdict(c, Date.now());
        if (v === "wait") return;
        ended.current[n] = c.startedAt;
        const enough = c.low >= 0 && c.high - c.low >= MIN_SWEEP_SPAN;
        if (v === "finish" || enough) {
          void finish(n).then((ok) => {
            if (!ok) ended.current[n] = 0; // still running: let it try again
          });
        } else {
          void cancel(n).then(() => setError(n, capitalise(TOO_SMALL)));
        }
      });
    }, VERDICT_EVERY_MS);
    return () => clearInterval(id);
  }, [anyOn, cancel, finish, setError]);

  const setLearn = useCallback((n: number, on: boolean) => {
    setLearnState((xs) => {
      const next = xs.map((x, i) => (i === n ? on : x));
      writeLearn(next);
      return next;
    });
  }, []);

  return useMemo(
    () => ({
      rings,
      seen,
      captures,
      errors,
      learn,
      setLearn,
      watch,
      sweep: { start, finish, cancel },
      clearError: (n: number) => setError(n, null),
    }),
    [rings, seen, captures, errors, learn, setLearn, watch, start, finish, cancel, setError],
  );
}

export type ExpLive = ReturnType<typeof useExpLive>;
