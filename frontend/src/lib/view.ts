/** View preferences are independent of the saved MIDI configuration. */
export function readViewPreference(key: string, fallback: number, min: number, max: number) {
  try {
    const raw = localStorage.getItem(key);
    const value = raw === null ? fallback : Number(raw);
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  } catch {
    return fallback;
  }
}

export function saveViewPreference(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Resizing still works when storage is unavailable.
  }
}
