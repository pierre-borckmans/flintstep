import { useSyncExternalStore } from "react";

function subscribeMotion(cb: () => void) {
  try {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    m.addEventListener("change", cb);
    return () => m.removeEventListener("change", cb);
  } catch {
    return () => {};
  }
}

function reducedNow() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Whether the user asked for less motion, live. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, reducedNow, () => false);
}
