import { noteName } from "./notes";

/** Human words for one MIDI message, the fallback when an Activity has no label (and
 *  what the mock labels its own messages with). */
export function describeMidi(bytes: number[]): string {
  if (bytes.length === 0) return "";
  const status = bytes[0] & 0xf0;
  const ch = (bytes[0] & 0x0f) + 1;
  const d1 = bytes[1] ?? 0;
  const d2 = bytes[2] ?? 0;
  switch (status) {
    case 0xb0:
      return `CC ${d1} = ${d2} · ch ${ch}`;
    case 0x90:
      return d2 > 0
        ? `Note on ${noteName(d1)} v${d2} · ch ${ch}`
        : `Note off ${noteName(d1)} · ch ${ch}`;
    case 0x80:
      return `Note off ${noteName(d1)} · ch ${ch}`;
    case 0xc0:
      return `PC ${d1} · ch ${ch}`;
    default:
      return bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ");
  }
}

/** "now", "4s", "3m", "2h": how long ago, compact enough for a log column. */
export function relTime(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 1) return "now";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}
