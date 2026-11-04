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
import { presetLabel } from "./lib/presets";
import type { Gesture } from "./lib/scrub";
import type { Activity, Config, ExpEdge, PedalRef, PresetSource, State } from "./types";

export const LOG_SIZE = 50;
/** How long the edits must settle before they are saved. */
export const SAVE_DELAY_MS = 300;

export type LoggedActivity = Activity & { id: number };

/** One point in the undo history: which preset ran, and its mapping then. */
export interface Snap {
  preset: string;
  config: Config;
}

const sameSnap = (a: Snap, b: Snap) => a.preset === b.preset && sameMapping(a.config, b.config);

/** Everything the UI holds: the live State from Go, the mapping being edited with its
 *  undo history, and the recent MIDI.
 *
 *  The mapping on screen is the history's current entry, a preset and its mapping. Edits
 *  move it within the active preset and go through one autosave, which sends it to Go
 *  (into the active preset) once the edits settle. Switching presets is an entry too:
 *  undoing one, or jumping across it, saves what is waiting, asks Go to select the other
 *  preset, and then saves the entry's mapping into it if Go's differs. The remembered
 *  pedal is not part of any of it: Choose / Forget change it in Go directly, the screen
 *  shows Go's, and each save carries Go's current one. */
export function useBridge(backend: Backend) {
  const [state, setState] = useState<State | null>(null);
  const [history, setHistory] = useState<H.History<Snap> | null>(null);
  const [log, setLog] = useState<LoggedActivity[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "saved" });
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [presetError, setPresetError] = useState<string | null>(null);
  const seq = useRef(0);
  // The history and autosave are read and written outside React's render (key handlers,
  // async calls), so the refs are the source of truth and the state mirrors them.
  const hist = useRef<H.History<Snap> | null>(null);
  const auto = useRef<Autosave<Config> | null>(null);
  const pedal = useRef<PedalRef>({ address: "", name: "" });
  /** The preset Go runs, as far as this side has made it so. */
  const active = useRef("");
  /** Preset names by id, for history labels. */
  const names = useRef(new Map<string, string>());
  /** A preset switch or library change is talking to Go: the screen and Go may
   *  disagree on the active preset until it ends. */
  const busy = useRef(false);

  const nameOf = (id: string) => names.current.get(id) ?? "Preset";
  const rules = useRef<H.HistoryRules<Snap>>({
    same: sameSnap,
    describe: (a, b) =>
      a.preset === b.preset ? diffConfigs(a.config, b.config) : presetLabel(nameOf(b.preset)),
    // Gaps shorter than this between edits to one field make one undo step.
    coalesceMs: 1200,
    cap: 100,
  }).current;

  const setHist = useCallback((h: H.History<Snap>) => {
    hist.current = h;
    setHistory(h);
  }, []);

  /** Brings the screen in line with what Go runs: drops the history of presets that are
   *  gone, and if Go runs another preset or mapping than the current entry, makes that
   *  a new entry. Pending edits are dropped: they could only land in the wrong preset. */
  const reconcile = useCallback(
    (s: State) => {
      const h = hist.current;
      if (!h) return;
      const ids = new Set(s.presets.map((p) => p.id));
      const go: Snap = { preset: s.activePreset, config: mappingOf(s.config) };
      const kept = H.drop(h, (x) => !ids.has(x.preset), sameSnap) ?? H.start(go, Date.now());
      active.current = s.activePreset;
      auto.current?.adopt(go.config);
      const switched = H.current(kept).preset !== go.preset;
      setHist(
        H.push(kept, rules, go, {
          at: Date.now(),
          label: switched ? presetLabel(nameOf(go.preset)) : undefined,
        }),
      );
    },
    [rules, setHist],
  );

  const learn = useCallback((s: State) => {
    pedal.current = s.config.pedal;
    names.current = new Map(s.presets.map((p) => [p.id, p.name]));
  }, []);

  const boot = useCallback(
    (s: State) => {
      learn(s);
      if (hist.current) return;
      const m = mappingOf(s.config);
      active.current = s.activePreset;
      setHist(H.start({ preset: s.activePreset, config: m }, Date.now()));
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
    [backend, learn, setHist],
  );

  /** Go switched preset on its own (the menu-bar menu). The event may be older than a
   *  switch made here, so ask Go again before believing it. */
  const checkExternal = useCallback(async () => {
    const s = await backend.GetState();
    if (busy.current || s.activePreset === active.current) return;
    learn(s);
    setState(s);
    reconcile(s);
  }, [backend, learn, reconcile]);

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
      if (!busy.current && s.activePreset !== active.current) void checkExternal();
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
  }, [backend, boot, checkExternal]);

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

  /** Runs `task` with busy set, one at a time; a second one while busy is refused. */
  const exclusive = useCallback(async <R>(task: () => Promise<R>): Promise<R | undefined> => {
    if (busy.current) return undefined;
    busy.current = true;
    try {
      return await task();
    } finally {
      busy.current = false;
    }
  }, []);

  /** Sends the current entry to Go: into the autosave when it is the active preset's,
   *  otherwise by selecting its preset first. Entries that change meanwhile are
   *  followed until Go runs the current one. */
  const sync = useCallback(() => {
    const h = hist.current;
    if (!h || busy.current) return; // a running switch syncs when it ends
    const snap = H.current(h);
    if (snap.preset === active.current) {
      auto.current?.change(snap.config);
      return;
    }
    busy.current = true;
    void (async () => {
      try {
        for (;;) {
          const now = H.current(hist.current!);
          if (now.preset === active.current) {
            auto.current?.change(now.config);
            break;
          }
          // What is waiting belongs to the preset being left.
          await auto.current?.flush();
          const fresh = await backend.SelectPreset(now.preset);
          active.current = now.preset;
          auto.current?.adopt(mappingOf(fresh));
        }
        setPresetError(null);
      } catch (e) {
        setPresetError(errorText(e));
        const s = await backend.GetState().catch(() => null);
        if (s) {
          learn(s);
          setState(s);
          reconcile(s);
        }
      } finally {
        busy.current = false;
      }
    })();
  }, [backend, learn, reconcile]);

  /** Makes `h` the history, and its current entry what Go should run. */
  const commit = useCallback(
    (h: H.History<Snap>) => {
      if (h === hist.current) return;
      setHist(h);
      sync();
    },
    [setHist, sync],
  );

  /** An edit. Made by a drag (`gesture`, a scrubbed number), every step shows at once
   *  and joins one history entry, but nothing is sent to Go until the drag is done: one
   *  entry and one save per drag, however long it takes. */
  const apply = useCallback(
    (op: Op, gesture?: Gesture) => {
      const h = hist.current;
      if (!h) return;
      const now = H.current(h);
      const next = { preset: now.preset, config: edit(now.config, op) };
      const pushed = H.push(h, rules, next, {
        at: Date.now(),
        key: opKey(op),
        gesture: gesture?.id ?? null,
      });
      if (!gesture) return commit(pushed);
      if (pushed !== hist.current) setHist(pushed);
      if (gesture.done) sync();
    },
    [commit, rules, setHist, sync],
  );

  const undo = useCallback(() => hist.current && commit(H.undo(hist.current)), [commit]);
  const redo = useCallback(() => hist.current && commit(H.redo(hist.current)), [commit]);
  const jump = useCallback(
    (i: number) => hist.current && commit(H.jump(hist.current, i)),
    [commit],
  );

  /** Go changed the active preset's mapping itself and saved it (`fresh`); `next` is
   *  what to show, an undoable step from what was on screen. */
  const adopt = useCallback(
    (fresh: Config, next: Config, label?: string) => {
      auto.current?.adopt(mappingOf(fresh));
      const h = hist.current;
      if (!h) return;
      const snap = { preset: active.current, config: mappingOf(next) };
      setHist(H.push(h, rules, snap, { at: Date.now(), label }));
      // An edit made while Go was busy (next ≠ fresh) still has to be saved.
      auto.current?.change(snap.config);
    },
    [rules, setHist],
  );

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
      adopt(fresh, h ? mergeCalibration(H.current(h).config, fresh, n) : fresh);
    },
    [backend, adopt],
  );

  const refresh = useCallback(async () => {
    const s = await backend.GetState();
    learn(s);
    setState(s);
    return s;
  }, [backend, learn]);
  const flush = useCallback(() => auto.current?.flush() ?? Promise.resolve(), []);

  // ---- presets ----

  /** Switches to preset `id`: an undoable step. */
  const selectPreset = useCallback(
    (id: string, name?: string) =>
      exclusive(async () => {
        const h = hist.current;
        if (!h || H.current(h).preset === id) return;
        try {
          await auto.current?.flush();
          const fresh = await backend.SelectPreset(id);
          active.current = id;
          auto.current?.adopt(mappingOf(fresh));
          const snap = { preset: id, config: mappingOf(fresh) };
          setHist(
            H.push(hist.current!, rules, snap, {
              at: Date.now(),
              label: presetLabel(name ?? nameOf(id)),
            }),
          );
          setPresetError(null);
        } catch (e) {
          setPresetError(errorText(e));
        }
        await refresh();
      }).finally(sync),
    [backend, exclusive, refresh, rules, setHist, sync],
  );

  /** A library change: the history is not involved, but the list is. Errors are the
   *  caller's to show. */
  const library = useCallback(
    async <R>(task: () => Promise<R>): Promise<R> => {
      setPresetError(null);
      const r = await task();
      await refresh();
      return r;
    },
    [refresh],
  );

  /** A new preset from the current mapping or the default one, then switches to it. */
  const createPreset = useCallback(
    async (from: PresetSource) => {
      // A copy of the current one should have the edits still waiting.
      await auto.current?.flush();
      const info = await library(() => backend.CreatePreset("", from));
      await selectPreset(info.id, info.name);
      return info;
    },
    [backend, library, selectPreset],
  );

  const renamePreset = useCallback(
    (id: string, name: string) => library(() => backend.RenamePreset(id, name)),
    [backend, library],
  );

  const duplicatePreset = useCallback(
    async (id: string) => {
      if (id === active.current) await auto.current?.flush();
      return library(() => backend.DuplicatePreset(id));
    },
    [backend, library],
  );

  /** Deletes a preset (the UI has asked first). If it was the active one Go runs a
   *  neighbour, which the screen follows. Its history goes with it. */
  const deletePreset = useCallback(
    (id: string) =>
      exclusive(async () => {
        setPresetError(null);
        await auto.current?.flush();
        await backend.DeletePreset(id);
        reconcile(await refresh());
      }),
    [backend, exclusive, reconcile, refresh],
  );

  const exportPreset = useCallback(
    async (id: string) => {
      if (id === active.current) await auto.current?.flush();
      setPresetError(null);
      await backend.ExportPreset(id);
    },
    [backend],
  );

  /** Imports a preset file and switches to it; null when the panel was cancelled. */
  const importPreset = useCallback(async () => {
    const info = await library(() => backend.ImportPreset());
    if (!info.id) return null;
    await selectPreset(info.id, info.name);
    return info;
  }, [backend, library, selectPreset]);

  const config: Config | null =
    history && state ? { ...H.current(history).config, pedal: state.config.pedal } : null;
  const shownPreset = history ? H.current(history).preset : "";

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
    presets: {
      list: state?.presets ?? [],
      /** The preset on screen: the history's, ahead of Go's while a switch runs. */
      active: shownPreset,
      error: presetError,
      libraryError: state?.libraryError ?? "",
      clearError: () => setPresetError(null),
      select: selectPreset,
      create: createPreset,
      rename: renamePreset,
      duplicate: duplicatePreset,
      remove: deletePreset,
      export: exportPreset,
      import: importPreset,
    },
  };
}

export type Bridge = ReturnType<typeof useBridge>;
export type Presets = Bridge["presets"];
