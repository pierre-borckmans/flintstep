// THE LOCALSTORAGE KEYS' OLD NAMES. Before the rename to Flintstep the view settings
// (theme, nuts, split, expression pedal placement) were saved under "sparkx.*". This
// copies each one to its "flintstep.*" key when that key has nothing yet, and leaves
// the old one alone. index.html does the same before the first paint, so the theme is
// right from the start; main.tsx calls this too, for any page without that script.

import { LEGACY_STORAGE_PREFIX, STORAGE_PREFIX } from "../product";

/** The bit of Storage this needs; tests pass a Map-backed one. */
export interface KeyStore {
  readonly length: number;
  key(i: number): string | null;
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/** Copies old-prefixed keys to new ones that are unset. Returns the new keys written.
 *  Never throws: storage can be missing or refuse writes (private mode, full disk). */
export function migrateStorage(store: KeyStore | undefined): string[] {
  const written: string[] = [];
  if (!store) return written;
  try {
    const old: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k?.startsWith(LEGACY_STORAGE_PREFIX)) old.push(k);
    }
    for (const k of old) {
      const nk = STORAGE_PREFIX + k.slice(LEGACY_STORAGE_PREFIX.length);
      const v = store.getItem(k);
      if (v !== null && store.getItem(nk) === null) {
        store.setItem(nk, v);
        written.push(nk);
      }
    }
  } catch {
    // Nothing to do: the defaults apply.
  }
  return written;
}

/** window.localStorage, or undefined where reading it throws. */
export function localStore(): KeyStore | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
