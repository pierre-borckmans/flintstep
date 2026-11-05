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
import { createSaveRouter } from "./lib/saveinto";
import type { Gesture } from "./lib/scrub";
import * as S from "./lib/stacks";
import type { Activity, Config, ExpEdge, PedalRef, PresetSource, State } from "./types";

export const LOG_SIZE = 50;
/** How long the edits must settle before they are saved. */
export const SAVE_DELAY_MS = 300;
/** Histories of this many presets are kept, the least recently used going first. */
export const KEPT_HISTORIES = 20;

export type LoggedActivity = Activity & { id: number };

/** Everything the UI holds: the live State from Go, the mapping being edited with its
 *  undo history, and the recent MIDI.
 *
 *  Each preset has its own undo history (lib/stacks.ts) and its own autosave. The
 *  mapping on screen is the active preset's current entry; edits, undo and redo move it
 *  within that preset only, and switching presets puts the other preset's history on
 *  screen without making an entry. Every autosave saves into the preset that owns its
 *  edits, through one queue (lib/saveinto.ts), so an edit still waiting when the preset
 *  changes, from here or from the menu bar, lands in its own preset. The remembered
 *  pedal is not part of any of it: Choose / Forget change it in Go directly, the screen
 *  shows Go's, and each save carries Go's current one. */
export function useBridge(backend: Backend) {
  const [state, setState] = useState<State | null>(null);
  const [history, setHistory] = useState<H.History<Config> | null>(null);
  const [shownPreset, setShownPreset] = useState("");
  const [log, setLog] = useState<LoggedActivity[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "saved" });
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [presetError, setPresetError] = useState<string | null>(null);
  const seq = useRef(0);
  // The histories and autosaves are read and written outside React's render (key
  // handlers, async calls), so the refs are the source of truth and the state mirrors
  // them.
  const stacks = useRef<S.Stacks<Config> | null>(null);
  /** Each preset's autosave, by id. One with nothing left to save goes once its preset
   *  is off screen. */
  const saves = useRef(new Map<string, Autosave<Config>>());
  const pedal = useRef<PedalRef>({ address: "", name: "" });
  /** Preset names by id, for the save status. */
  const names = useRef(new Map<string, string>());
  /** A preset switch or library change is under way: the screen and Go may disagree on
   *  the active preset until it ends. */
  const busy = useRef(false);
  const router = useRef(
    createSaveRouter<Config>({
      active: async () => (await backend.GetState()).activePreset,
      select: (id) => backend.SelectPreset(id),
      save: (c) => backend.SaveConfig({ ...c, pedal: pedal.current }),
    }),
  ).current;

  const rules = useRef<S.StackRules<Config>>({
    same: sameMapping,
    describe: diffConfigs,
    // Gaps shorter than this between edits to one field make one undo step.
    coalesceMs: 1200,
    cap: 100,
    stacks: KEPT_HISTORIES,
  }).current;

  /** The save status to show: the preset on screen's, unless that is all saved and
   *  another preset's edits are still on their way (or were refused). */
  const showStatus = useCallback(() => {
    const id = stacks.current?.active ?? "";
    const own = saves.current.get(id)?.status() ?? { kind: "saved" };
    let shown: SaveStatus = own;
    if (own.kind === "saved") {
      for (const [other, a] of saves.current) {
        const st = a.status();
        if (other === id || st.kind === "saved") continue;
        const name = names.current.get(other) ?? "Preset";
        shown = "error" in st ? { ...st, error: `${name}: ${st.error}` } : { kind: "saving" };
        break;
      }
    }
    setSaveStatus(shown);
  }, []);

  /** Preset `id`'s autosave, made on first use with `saved` as what Go holds. */
  const autosave = useCallback(
    (id: string, saved: Config) => {
      const had = saves.current.get(id);
      if (had) return had;
      const a = createAutosave<Config>({
        saved,
        save: (c) => router.saveInto(id, c),
        validate,
        same: sameMapping,
        delayMs: SAVE_DELAY_MS,
        timers: browserTimers,
        onStatus: (st) => {
          if (st.kind === "saved" && id === stacks.current?.active) setSavedAt(Date.now());
          showStatus();
        },
        errorText,
      });
      saves.current.set(id, a);
      return a;
    },
    [router, showStatus],
  );

  /** The autosave of the preset on screen. */
  const own = () => saves.current.get(stacks.current?.active ?? "");
  const flushAll = useCallback(async () => {
    await Promise.all([...saves.current.values()].map((a) => a.flush()));
  }, []);

  const show = useCallback((s: S.Stacks<Config>) => {
    stacks.current = s;
    setHistory(S.active(s));
    setShownPreset(s.active);
  }, []);

  /** Puts preset `id` on screen, Go running `fresh` for it: its own history comes back.
   *  An autosave still holding an edit for it (refused by Go, or held back as invalid)
   *  keeps that edit on screen. */
  const enter = useCallback(
    (id: string, fresh: Config) => {
      const s = stacks.current;
      if (!s) return;
      const held = saves.current.get(id);
      const keep = !!held && held.status().kind !== "saved";
      const entered = S.enter(s, rules, id, fresh, Date.now(), { keep });
      // The preset left may be gone (deleted while active).
      show(names.current.size ? S.retain(entered, new Set(names.current.keys())) : entered);
      if (!keep) held?.adopt(fresh);
      autosave(id, fresh);
      for (const [other, a] of saves.current) {
        if (other !== id && a.status().kind === "saved") {
          a.dispose();
          saves.current.delete(other);
        }
      }
      showStatus();
    },
    [autosave, rules, show, showStatus],
  );

  const learn = useCallback((s: State) => {
    pedal.current = s.config.pedal;
    names.current = new Map(s.presets.map((p) => [p.id, p.name]));
    // A rename keeps its history (by id); a preset that went takes its own along.
    if (stacks.current) stacks.current = S.retain(stacks.current, new Set(names.current.keys()));
  }, []);

  const boot = useCallback(
    (s: State) => {
      learn(s);
      if (stacks.current) return;
      const m = mappingOf(s.config);
      show(S.open(s.activePreset, m, Date.now()));
      autosave(s.activePreset, m);
    },
    [autosave, learn, show],
  );

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

  /** Brings the screen in line with `s`, Go's state, following its active preset. */
  const follow = useCallback(
    (s: State) => {
      learn(s);
      setState(s);
      if (s.activePreset !== stacks.current?.active) enter(s.activePreset, mappingOf(s.config));
    },
    [enter, learn],
  );

  /** Go switched preset on its own (the menu-bar menu), or seems to. The event may be
   *  older than a switch made here, or come from a routed save visiting another preset,
   *  so wait for the queue and ask Go again before believing it. What the old preset
   *  still had waiting is saved into it, never into the new one. */
  const checkExternal = useCallback(async () => {
    await router.idle();
    if (busy.current) return;
    const first = await backend.GetState();
    if (first.activePreset === stacks.current?.active) return;
    await exclusive(async () => {
      // Each waiting save visits its own preset and comes back.
      await flushAll();
      await router.idle();
      follow(await backend.GetState());
    });
  }, [backend, exclusive, flushAll, follow, router]);

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
      const moved = s.activePreset !== stacks.current?.active;
      if (moved && !busy.current && !router.busy()) void checkExternal();
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
  }, [backend, boot, checkExternal, router]);

  // Never lose an edit: save what is waiting when the window goes away or loses focus.
  useEffect(() => {
    const flush = () => void flushAll();
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
  }, [flushAll]);

  /** Makes `h` the active preset's history, and its current entry what to save. */
  const commit = useCallback(
    (h: H.History<Config>) => {
      const s = stacks.current;
      if (!s || h === S.active(s)) return;
      show(S.update(s, h));
      own()?.change(H.current(h));
    },
    [show],
  );

  /** An edit. Made by a drag (`gesture`, a scrubbed number), every step shows at once
   *  and joins one history entry, but nothing is saved until the drag is done: one
   *  entry and one save per drag, however long it takes. */
  const apply = useCallback(
    (op: Op, gesture?: Gesture) => {
      const s = stacks.current;
      if (!s) return;
      const h = S.active(s);
      const pushed = H.push(h, rules, edit(H.current(h), op), {
        at: Date.now(),
        key: opKey(op),
        gesture: gesture?.id ?? null,
      });
      if (!gesture) return commit(pushed);
      if (pushed !== h) show(S.update(s, pushed));
      if (gesture.done) own()?.change(H.current(pushed));
    },
    [commit, rules, show],
  );

  const undo = useCallback(() => {
    if (stacks.current) commit(H.undo(S.active(stacks.current)));
  }, [commit]);
  const redo = useCallback(() => {
    if (stacks.current) commit(H.redo(S.active(stacks.current)));
  }, [commit]);
  const jump = useCallback(
    (i: number) => {
      if (stacks.current) commit(H.jump(S.active(stacks.current), i));
    },
    [commit],
  );

  /** Go changed the active preset's mapping itself and saved it (`fresh`); `next` is
   *  what to show, an undoable step in that preset's history. */
  const adopt = useCallback(
    (fresh: Config, next: Config, label?: string) => {
      const s = stacks.current;
      if (!s) return;
      const a = autosave(s.active, mappingOf(fresh));
      a.adopt(mappingOf(fresh));
      const config = mappingOf(next);
      show(S.update(s, H.push(S.active(s), rules, config, { at: Date.now(), label })));
      // An edit made while Go was busy (next ≠ fresh) still has to be saved.
      a.change(config);
    },
    [autosave, rules, show],
  );

  const reset = useCallback(async () => {
    // Anything still waiting would otherwise land after the reset and undo it.
    await own()?.flush();
    const fresh = await router.run(() => backend.ResetConfig());
    adopt(fresh, fresh, "Mapping reset");
  }, [backend, adopt, router]);

  const calibrate = useCallback(
    async (n: number, edge: ExpEdge) => {
      // Go calibrates on top of what it holds, so send the edits first.
      await own()?.flush();
      const fresh = await router.run(() => backend.CalibrateExp(n, edge));
      const s = stacks.current;
      adopt(fresh, s ? mergeCalibration(H.current(S.active(s)), fresh, n) : fresh);
    },
    [backend, adopt, router],
  );

  const refresh = useCallback(async () => {
    const s = await backend.GetState();
    learn(s);
    setState(s);
    return s;
  }, [backend, learn]);

  // ---- presets ----

  /** Switches to preset `id`, whose own history comes back. Navigation: nothing to undo. */
  const selectPreset = useCallback(
    (id: string, _name?: string) =>
      exclusive(async () => {
        if (!stacks.current || stacks.current.active === id) return;
        try {
          // Saved now, straight into the preset being left.
          await own()?.flush();
          const fresh = await router.run(() => backend.SelectPreset(id));
          enter(id, mappingOf(fresh));
          setPresetError(null);
        } catch (e) {
          setPresetError(errorText(e));
        }
        follow(await backend.GetState());
      }),
    [backend, enter, exclusive, follow, router],
  );

  /** A library change: the histories are not involved, but the list is. Errors are the
   *  caller's to show. */
  const library = useCallback(
    async <R>(task: () => Promise<R>): Promise<R> => {
      setPresetError(null);
      const r = await router.run(task);
      await refresh();
      return r;
    },
    [refresh, router],
  );

  /** A preset that did not exist before starts with an empty history. */
  const startEmpty = (id: string) => {
    if (stacks.current) stacks.current = S.forget(stacks.current, id);
  };

  /** A new preset from the current mapping or the default one, then switches to it. */
  const createPreset = useCallback(
    async (from: PresetSource) => {
      // A copy of the current one should have the edits still waiting.
      await own()?.flush();
      const info = await library(() => backend.CreatePreset("", from));
      startEmpty(info.id);
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
      await saves.current.get(id)?.flush();
      const info = await library(() => backend.DuplicatePreset(id));
      startEmpty(info.id);
      return info;
    },
    [backend, library],
  );

  /** Deletes a preset (the UI has asked first). If it was the active one Go runs a
   *  neighbour, which the screen follows. Its history and waiting edits go with it. */
  const deletePreset = useCallback(
    (id: string) =>
      exclusive(async () => {
        setPresetError(null);
        saves.current.get(id)?.dispose();
        saves.current.delete(id);
        await router.run(() => backend.DeletePreset(id));
        if (stacks.current) stacks.current = S.forget(stacks.current, id);
        follow(await backend.GetState());
      }),
    [backend, exclusive, follow, router],
  );

  const exportPreset = useCallback(
    async (id: string) => {
      await saves.current.get(id)?.flush();
      setPresetError(null);
      await backend.ExportPreset(id);
    },
    [backend],
  );

  /** Imports a preset file and switches to it; null when the panel was cancelled. */
  const importPreset = useCallback(async () => {
    const info = await library(() => backend.ImportPreset());
    if (!info.id) return null;
    startEmpty(info.id);
    await selectPreset(info.id, info.name);
    return info;
  }, [backend, library, selectPreset]);

  const config: Config | null =
    history && state ? { ...H.current(history), pedal: state.config.pedal } : null;

  return {
    state,
    config,
    log,
    saveStatus,
    savedAt,
    /** The active preset's undo history. */
    history,
    apply,
    undo,
    redo,
    jump,
    flush: flushAll,
    reset,
    calibrate,
    refresh,
    presets: {
      list: state?.presets ?? [],
      /** The preset on screen: ahead of Go's while a switch runs. */
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
