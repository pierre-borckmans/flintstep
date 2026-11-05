// The app's names for the frontend. ../product.env at the repo root is the source of
// truth; product.test.ts fails when these disagree with it. The Go side has its own
// copy in internal/product.

export const PRODUCT_NAME = "Flintstep";
/** The virtual MIDI source DAWs see. */
export const MIDI_PORT_NAME = "Flintstep (Spark Control X)";
/** The virtual MIDI destination a DAW sends LED feedback to. */
export const MIDI_LED_PORT_NAME = "Flintstep LEDs (Spark Control X)";
export const REPO_SLUG = "pierre-borckmans/flintstep";
export const SITE_URL = "https://flintstep.app";

/** Prefix of this app's localStorage keys. */
export const STORAGE_PREFIX = "flintstep.";
/** The prefix before the rename; see lib/storage.ts. */
export const LEGACY_STORAGE_PREFIX = "sparkx.";
