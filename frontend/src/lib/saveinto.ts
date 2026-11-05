// SAVING INTO A PRESET. The menu-bar menu can switch the preset Go runs at any moment,
// so a save is tagged with the preset that owns the edit and Go's SaveConfigInto writes
// it there. Go checks, under the same lock as a switch, whether that preset runs and
// only then applies the mapping live: an edit always lands in its own preset, never in
// the one that happens to be running, and the pedal never runs it by accident.
//
// Every call that changes what Go runs or holds goes through one queue, so saves reach
// Go in the order they were made and never interleave with a switch, a reset or a
// calibration made from the window.

export interface PresetIO<C> {
  /** Saves `c` into preset `preset`; Go runs it only if that preset is the active one. */
  saveInto(preset: string, c: C): Promise<void>;
}

export interface SaveRouter<C> {
  /** Saves `c` into preset `preset`, whatever Go runs. */
  saveInto(preset: string, c: C): Promise<void>;
  /** Runs `task` in the queue, after what is already in it. */
  run<R>(task: () => Promise<R>): Promise<R>;
  /** Resolves once the queue is empty. */
  idle(): Promise<void>;
  /** Whether a task is queued or running. */
  busy(): boolean;
}

export function createSaveRouter<C>(io: PresetIO<C>): SaveRouter<C> {
  let tail: Promise<unknown> = Promise.resolve();
  let queued = 0;

  function run<R>(task: () => Promise<R>): Promise<R> {
    queued++;
    const p = tail.then(task);
    const done = () => {
      queued--;
    };
    tail = p.then(done, done);
    return p;
  }

  const saveInto = (preset: string, c: C) => run(() => io.saveInto(preset, c));

  async function idle() {
    while (queued > 0) await tail;
  }

  return { saveInto, run, idle, busy: () => queued > 0 };
}
