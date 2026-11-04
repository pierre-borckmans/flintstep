// AUTOSAVE. Every change to the mapping is saved on its own, a moment after the last
// one, so a slider drag or typing "127" is one save at the end rather than one per step.
//
// One save runs at a time; a change made while one is running is saved after it. A
// config that does not validate is held back (the status says why) and saved as soon as
// a change makes it valid again. A save the app rejects keeps the edit and shows the
// error; the next change, or a flush, tries again. The timers are injected so the tests
// drive the clock.

export type SaveStatus =
  | { kind: "saved" }
  /** Waiting for the edits to settle. */
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "invalid"; error: string }
  | { kind: "failed"; error: string };

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const browserTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface AutosaveOptions<T> {
  /** What the app holds now. */
  saved: T;
  save(value: T): Promise<void>;
  validate(value: T): string | null;
  same(a: T, b: T): boolean;
  delayMs: number;
  timers: Timers;
  onStatus(status: SaveStatus): void;
  errorText(e: unknown): string;
}

export interface Autosave<T> {
  /** The value to end up saved. */
  change(value: T): void;
  /** Saves now whatever is waiting, and resolves once nothing is in flight. */
  flush(): Promise<void>;
  /** The app saved `value` itself (a calibration, a reset): it is both what is saved
   *  and the edit, and anything waiting is dropped. Follow with change() for an edit
   *  on top of it. */
  adopt(value: T): void;
  status(): SaveStatus;
  dispose(): void;
}

export function createAutosave<T>(o: AutosaveOptions<T>): Autosave<T> {
  let saved = o.saved;
  let latest = o.saved;
  let timer: unknown = null;
  let flight: Promise<void> | null = null;
  let flying: T | null = null;
  let failed: { value: T; error: string } | null = null;
  let status: SaveStatus = { kind: "saved" };

  const emit = (s: SaveStatus) => {
    const same =
      s.kind === status.kind &&
      ("error" in s ? s.error : "") === ("error" in status ? status.error : "");
    status = s;
    if (!same) o.onStatus(s);
  };
  const stopTimer = () => {
    if (timer !== null) o.timers.clear(timer);
    timer = null;
  };

  /** Where things stand with no timer running and nothing in flight: settled, held
   *  back, or failed; otherwise save now. */
  function settleNow() {
    const err = o.validate(latest);
    if (err) return emit({ kind: "invalid", error: err });
    if (o.same(latest, saved)) return emit({ kind: "saved" });
    if (failed && o.same(latest, failed.value)) {
      return emit({ kind: "failed", error: failed.error });
    }
    run();
  }

  function run() {
    stopTimer();
    const value = latest;
    flying = value;
    failed = null;
    emit({ kind: "saving" });
    // Called synchronously, so a flush from beforeunload has the request on its way
    // before the page goes.
    let p: Promise<void>;
    try {
      p = o.save(value);
    } catch (e) {
      p = Promise.reject(e);
    }
    flight = p.then(
      () => {
        saved = value;
      },
      (e) => {
        failed = { value, error: o.errorText(e) };
      },
    );
    flight.then(() => {
      flight = null;
      flying = null;
      if (timer !== null) emit({ kind: "pending" });
      else settleNow();
    });
  }

  function change(value: T) {
    latest = value;
    stopTimer();
    const err = o.validate(value);
    if (err) return emit({ kind: "invalid", error: err });
    if (flight) {
      // Back to what is being saved: nothing more to do once it lands.
      if (flying !== null && o.same(value, flying)) return emit({ kind: "saving" });
    } else if (o.same(value, saved)) {
      return emit({ kind: "saved" });
    }
    timer = o.timers.set(() => {
      timer = null;
      if (!flight) run();
      // else: the flight's end sees the change and saves it.
    }, o.delayMs);
    emit(flight ? { kind: "saving" } : { kind: "pending" });
  }

  async function flush() {
    const hadTimer = timer !== null;
    stopTimer();
    if (!flight && hadTimer) run();
    else if (!flight && !o.validate(latest) && !o.same(latest, saved)) run();
    // A flight's end saves what came after it, so wait until nothing flies.
    while (flight) await flight;
  }

  function adopt(value: T) {
    stopTimer();
    saved = value;
    latest = value;
    failed = null;
    if (!flight) emit({ kind: "saved" });
  }

  return {
    change,
    flush,
    adopt,
    status: () => status,
    dispose: stopTimer,
  };
}
