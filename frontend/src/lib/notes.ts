// MIDI note numbers and names. Middle C is C4 = 60 (the Logic / Yamaha convention).

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 60 -> "C4", 61 -> "C#4", 0 -> "C-1", 127 -> "G9". */
export function noteName(n: number): string {
  const v = Math.round(n);
  if (v < 0 || v > 127) return "";
  return `${NAMES[v % 12]}${Math.floor(v / 12) - 1}`;
}

/** Reads "60", "C4", "c#4", "Db3", "C-1". Null when it is neither a number nor a
 *  note name, or lands outside 0..127. */
export function parseNote(text: string): number | null {
  const t = text.trim();
  if (/^\d+$/.test(t)) {
    const v = Number(t);
    return v <= 127 ? v : null;
  }
  const m = /^([a-gA-G])([#b♯♭]?)(-?\d)$/.exec(t);
  if (!m) return null;
  let pc = PITCH[m[1].toUpperCase()];
  if (m[2] === "#" || m[2] === "♯") pc += 1;
  if (m[2] === "b" || m[2] === "♭") pc -= 1;
  const v = (Number(m[3]) + 1) * 12 + pc;
  return v >= 0 && v <= 127 ? v : null;
}
