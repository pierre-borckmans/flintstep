// THE THEME, as numbers the GPU can use. The pedal itself is black in both themes and
// owns its own materials (sparkArt); what follows the theme is what sits on the stage
// round it — captions, leaders, the gauges, the selection plates, the rings — and those
// read style.css's tokens here, once per theme change, rather than repeating them.

export interface Palette {
  light: boolean;
  leader: number;
  cold: number;
  lampCold: number;
  muted: number;
  faint: number;
  bone: number;
  beam: number;
  lampBeam: number;
  edgeStrong: number;
  font: string;
  mono: string;
  /** How bright the link rings get at their peak. */
  ringPeak: number;
  /** The cables' shadow on the stage. */
  cableShadow: number;
  /** The case's shadows: colour and strength (style.css --shadow-contact/--shadow-cast). */
  shadow: { color: number; contact: number; cast: number };
}

function parse(raw: string, fallback: number): number {
  const s = raw.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(s);
  if (hex) return Number.parseInt(hex[1], 16);
  const short = /^#([0-9a-f]{3})$/i.exec(s);
  if (short) {
    const [r, g, b] = [...short[1]].map((c) => Number.parseInt(c + c, 16));
    return (r << 16) | (g << 8) | b;
  }
  const rgb = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(s);
  if (rgb) return (Number(rgb[1]) << 16) | (Number(rgb[2]) << 8) | Number(rgb[3]);
  return fallback;
}

/** The palette in force, read off the document. */
export function readPalette(light: boolean): Palette {
  const css = typeof document === "undefined" ? null : getComputedStyle(document.documentElement);
  const v = (name: string, fallback: number) =>
    css ? parse(css.getPropertyValue(name), fallback) : fallback;
  const font =
    (typeof document !== "undefined" && getComputedStyle(document.body).fontFamily) ||
    "system-ui, sans-serif";
  const mono = css?.getPropertyValue("--font-mono").trim() || "ui-monospace, Menlo, monospace";
  return {
    light,
    leader: v("--color-leader", 0x77806d),
    cold: v("--color-cold", 0xc9e4f2),
    lampCold: v("--lamp-cold", 0xc9e4f2),
    muted: v("--color-muted", 0xa3a89d),
    faint: v("--color-faint", 0x858c80),
    bone: v("--color-bone", 0xe8e6dc),
    beam: v("--color-beam", 0xd6bc83),
    lampBeam: v("--lamp-beam", 0xd6bc83),
    edgeStrong: v("--color-edge-strong", 0x464b42),
    font,
    mono,
    ringPeak: light ? 0.5 : 0.45,
    cableShadow: light ? 0.14 : 0.22,
    shadow: light
      ? { color: 0x1e180e, contact: 0.5, cast: 0.4 }
      : { color: 0x000000, contact: 0.8, cast: 0.7 },
  };
}

/** A CSS colour string for a palette number, for the HTML drawn over the canvas. */
export const css = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
