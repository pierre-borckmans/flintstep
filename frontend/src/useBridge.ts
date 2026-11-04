import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Backend } from "./api";
import { errorText } from "./api";
import { edit, mergeCalibration, type Op, sameConfig, validate } from "./lib/config";
import type { Activity, Config, ExpEdge, State } from "./types";

export const LOG_SIZE = 50;

export type LoggedActivity = Activity & { id: number };

/** Everything the UI holds: the live State from Go, the user's draft of the config,
 *  and the recent MIDI.
 *
 *  The draft is null while it matches what Go has, and the UI then simply follows Go
 *  (so a config changed elsewhere, say by a calibration, shows up). Editing makes it
 *  a copy; Save sends it and drops it again. `pedal` is never edited here: Choose /
 *  Forget change it in Go directly, so a save always carries Go's current value. */
export function useBridge(backend: Backend) {
  const [state, setState] = useState<State | null>(null);
  const [draft, setDraft] = useState<Config | null>(null);
  const [log, setLog] = useState<LoggedActivity[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    let alive = true;
    backend.GetState().then((s) => alive && setState(s));
    const offState = backend.onState((s) => setState(s));
    const offAct = backend.onActivity((a) => {
      const row = { ...a, id: ++seq.current };
      setLog((l) => [row, ...l].slice(0, LOG_SIZE));
    });
    return () => {
      alive = false;
      offState();
      offAct();
    };
  }, [backend]);

  const base = state?.config ?? null;
  const config = draft ?? base;
  const dirty =
    draft !== null && base !== null && !sameConfig({ ...draft, pedal: base.pedal }, base);
  const invalid = useMemo(() => (config ? validate(config) : null), [config]);

  const refresh = useCallback(async () => setState(await backend.GetState()), [backend]);

  const apply = useCallback(
    (op: Op) => {
      if (!base) return;
      setSaveError(null);
      setDraft((d) => {
        const next = edit(d ?? base, op);
        return sameConfig({ ...next, pedal: base.pedal }, base) ? null : next;
      });
    },
    [base],
  );

  const save = useCallback(async () => {
    if (!draft || !base || invalid) return;
    setSaving(true);
    setSaveError(null);
    try {
      await backend.SaveConfig({ ...draft, pedal: base.pedal });
      await refresh();
      setDraft(null);
      setSavedAt(Date.now());
    } catch (e) {
      setSaveError(errorText(e));
    } finally {
      setSaving(false);
    }
  }, [backend, draft, base, invalid, refresh]);

  const revert = useCallback(() => {
    setDraft(null);
    setSaveError(null);
  }, []);

  const reset = useCallback(async () => {
    const fresh = await backend.ResetConfig();
    setDraft(null);
    setState((s) => (s ? { ...s, config: fresh } : s));
    await refresh();
  }, [backend, refresh]);

  const calibrate = useCallback(
    async (n: number, edge: ExpEdge) => {
      const fresh = await backend.CalibrateExp(n, edge);
      setDraft((d) => (d ? mergeCalibration(d, fresh, n) : null));
      setState((s) => (s ? { ...s, config: fresh } : s));
    },
    [backend],
  );

  return {
    state,
    config,
    dirty,
    invalid,
    saving,
    saveError,
    savedAt,
    log,
    apply,
    save,
    revert,
    reset,
    calibrate,
    refresh,
  };
}

export type Bridge = ReturnType<typeof useBridge>;
