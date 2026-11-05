// SAVING INTO A PRESET. Go saves a mapping into whichever preset it runs, and the
// menu-bar menu can switch that at any moment, so a save is tagged with the preset that
// owns the edit and routed here: when Go still runs it, the save goes straight in;
// when Go has moved on (a menu-bar switch landed before the save), the router selects
// the edit's preset, saves into it, and selects the running one again. An edit always
// lands in its own preset, never in the one that happens to be running.
//
// Every call that changes what Go runs or holds goes through one queue, so a routed
// save never interleaves with a switch, a reset or a calibration.

export interface PresetIO<C> {
  /** The preset Go runs now. */
  active(): Promise<string>;
  select(id: string): Promise<unknown>;
  /** Saves into the preset Go runs. */
  save(c: C): Promise<void>;
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

  const saveInto = (preset: string, c: C) =>
    run(async () => {
      const running = await io.active();
      if (running === preset) return io.save(c);
      await io.select(preset);
      try {
        await io.save(c);
      } finally {
        await io.select(running);
      }
    });

  async function idle() {
    while (queued > 0) await tail;
  }

  return { saveInto, run, idle, busy: () => queued > 0 };
}
