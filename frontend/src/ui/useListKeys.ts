import { useEffect, useRef } from "react";

/** Stable React keys for a list whose items have no ids (the combos): one per index,
 *  kept when items after it change. A change to the length made elsewhere (undo) adds or
 *  drops keys at the end; `remove(i)` drops the key of the item actually removed, just
 *  before removing it, so the items after it keep theirs. */
export function useListKeys(length: number) {
  const next = useRef(0);
  const keys = useRef<number[]>([]);
  const k = keys.current;
  while (k.length < length) k.push(next.current++);
  if (k.length > length) k.length = length;
  return { keys: k, remove: (i: number) => k.splice(i, 1) };
}

/** False during the first render, true after: items mounting later are new arrivals. */
export function useMounted() {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);
  return mounted;
}
