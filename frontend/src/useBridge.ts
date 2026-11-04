import { useCallback, useEffect, useRef, useState } from "react";
import type { Backend } from "./api";
import { errorText } from "./api";
import { type Autosave, browserTimers, createAutosave, type SaveStatus } from "./lib/autosave";
import {
  edit,
  mappingOf,
  mergeCalibration,
  type Op,
  opKey,
  sameMapping,
  validate,
} from "./lib/config";
import { diffConfigs } from "./lib/diff";
import * as H from "./lib/history";
import type { Activity, Config, ExpEdge, PedalRef, State } from "./types";

export const LOG_SIZE = 50;
/** How long the edits must settle before they are saved. */
export const SAVE_DELAY_MS = 300;

export type LoggedActivity = Activity & { id: number };

const RULES: H.HistoryRules<Config> = {
  same: sameMapping,
  describe: diffConfigs,
  // Gaps shorter than this between edits to one field make one undo step.
  coalesceMs: 1200,
  cap: 100,
};

/** Everything the UI holds: the live State from Go, the mapping being edited with its
 *  undo history, and the recent MIDI.
 *
 *  The mapping on screen is the history's current entry. Every edit, undo, redo or jump
 *  moves it and goes through one autosave, which sends it to Go once the edits settle.
 *  The remembered pedal is not part of it: Choose / Forget change it in Go directly, the
 *  screen shows Go's, and each save carries Go's current one. */
export function useBridge(backend: Backend) {
  const [state, setState] = useState<State | null>(null);
  const [history, setHistory] = useState<H.History<Config> | null>(null);
  const [log, setLog] = useState<LoggedActivity[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "saved" });
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const seq = useRef(0);
  // The history and autosave are read and written outside React's render (key handlers,
  // async calibrate), so the refs are the source of truth and the state mirrors them.
  const hist = useRef<H.History<Config> | null>(null);
  const auto = useRef<Autosave<Config> | null>(null);
  const pedal = useRef<PedalRef>({ address: "", name: "" });

  const boot = useCallback(
    (s: State) => {
      pedal.current = s.config.pedal;
      if (hist.current) return;
      const m = mappingOf(s.config);
      hist.current = H.start(m, Date.now());
      setHistory(hist.current);
      auto.current = createAutosave<Config>({
        saved: m,
        save: (c) => backend.SaveConfig({ ...c, pedal: pedal.current }),
        validate,
        same: sameMapping,
        delayMs: SAVE_DELAY_MS,
        timers: browserTimers,
        onStatus: (st) => {
          setSaveStatus(st);
          if (st.kind === "saved") setSavedAt(Date.now());
        },
        errorText,
      });
    },
    [backend],
  );

  useEffect(() => {
    let alive = true;
    backend.GetState().then((s) => {
      if (!alive) return;
      boot(s);
      setState(s);
    });
    const offState = backend.onState((s) => {
      boot(s);
      setState(s);
    });
    const offAct = backend.onActivity((a) => {
      const row = { ...a, id: ++seq.current };
      setLog((l) => [row, ...l].slice(0, LOG_SIZE));
    });
    return () => {
      alive = false;
      offState();
      offAct();
    };
  }, [backend, boot]);

  // Never lose an edit: save what is waiting when the window goes away or loses focus.
  useEffect(() => {
    const flush = () => void auto.current?.flush();
    const onVis = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    window.addEventListener("blur", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("blur", flush);
      document.removeEventListener("visibilitychange", onVis);
      flush();
    };
  }, []);

  /** Makes `h` the history, and its current entry the mapping to save. */
  const commit = useCallback((h: H.History<Config>) => {
    if (h === hist.current) return;
    hist.current = h;
    setHistory(h);
    auto.current?.change(H.current(h));
  }, []);

  const apply = useCallback(
    (op: Op) => {
      const h = hist.current;
      if (!h) return;
      const next = edit(H.current(h), op);
      commit(H.push(h, RULES, next, { at: Date.now(), key: opKey(op) }));
    },
    [commit],
  );

  const undo = useCallback(() => hist.current && commit(H.undo(hist.current)), [commit]);
  const redo = useCallback(() => hist.current && commit(H.redo(hist.current)), [commit]);
  const jump = useCallback(
    (i: number) => hist.current && commit(H.jump(hist.current, i)),
    [commit],
  );

  /** Go changed the mapping itself and saved it (`fresh`); `next` is what to show, an
   *  undoable step from what was on screen. */
  const adopt = useCallback((fresh: Config, next: Config, label?: string) => {
    auto.current?.adopt(mappingOf(fresh));
    const h = hist.current;
    if (!h) return;
    const pushed = H.push(h, RULES, mappingOf(next), { at: Date.now(), label });
    hist.current = pushed;
    setHistory(pushed);
    // An edit made while Go was busy (next ≠ fresh) still has to be saved.
    auto.current?.change(H.current(pushed));
  }, []);

  const reset = useCallback(async () => {
    // Anything still waiting would otherwise land after the reset and undo it.
    await auto.current?.flush();
    const fresh = await backend.ResetConfig();
    adopt(fresh, fresh, "Mapping reset");
  }, [backend, adopt]);

  const calibrate = useCallback(
    async (n: number, edge: ExpEdge) => {
      // Go calibrates on top of what it holds, so send the edits first.
      await auto.current?.flush();
      const fresh = await backend.CalibrateExp(n, edge);
      const h = hist.current;
      adopt(fresh, h ? mergeCalibration(H.current(h), fresh, n) : fresh);
    },
    [backend, adopt],
  );

  const refresh = useCallback(async () => setState(await backend.GetState()), [backend]);
  const flush = useCallback(() => auto.current?.flush() ?? Promise.resolve(), []);

  const config: Config | null =
    history && state ? { ...H.current(history), pedal: state.config.pedal } : null;

  return {
    state,
    config,
    log,
    saveStatus,
    savedAt,
    history,
    apply,
    undo,
    redo,
    jump,
    flush,
    reset,
    calibrate,
    refresh,
  };
}

export type Bridge = ReturnType<typeof useBridge>;
