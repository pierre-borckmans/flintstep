import { useCallback, useState } from "react";
import { localStore } from "./lib/storage";

/** Reads a stored list of flags, each falling back to its default. */
export function readFlags(raw: string | null | undefined, defaults: boolean[]): boolean[] {
  try {
    const v = JSON.parse(raw ?? "null");
    if (Array.isArray(v)) return defaults.map((d, i) => (typeof v[i] === "boolean" ? v[i] : d));
  } catch {
    // The defaults.
  }
  return [...defaults];
}

/** A few on/off view settings kept in localStorage under `key` (one per expression
 *  input, say): what was left open stays open next time. Storage that refuses keeps
 *  them for the session. `force` starts from given flags instead (a URL asking for it). */
export function useStoredFlags(key: string, defaults: boolean[], force?: boolean[]) {
  const [flags, setFlags] = useState(
    () => force ?? readFlags(localStore()?.getItem(key), defaults),
  );
  const set = useCallback(
    (i: number, on: boolean) => {
      setFlags((xs) => {
        const next = xs.map((x, j) => (j === i ? on : x));
        try {
          localStore()?.setItem(key, JSON.stringify(next));
        } catch {
          // Kept for this session only.
        }
        return next;
      });
    },
    [key],
  );
  return [flags, set] as const;
}
