import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LEGACY_STORAGE_PREFIX,
  MIDI_LED_PORT_NAME,
  MIDI_PORT_NAME,
  PRODUCT_NAME,
  REPO_SLUG,
  SITE_URL,
  STORAGE_PREFIX,
} from "./product";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

/** product.env as scripts/lib/common.sh reads it: KEY=value, values verbatim. */
function productEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of read("../../product.env").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
  }
  return env;
}

describe("product names", () => {
  it("match product.env", () => {
    const env = productEnv();
    expect(PRODUCT_NAME).toBe(env.PRODUCT_NAME);
    expect(MIDI_PORT_NAME).toBe(env.MIDI_PORT_NAME);
    expect(MIDI_LED_PORT_NAME).toBe(env.MIDI_LED_PORT_NAME);
    expect(REPO_SLUG).toBe(env.REPO_SLUG);
    expect(SITE_URL).toBe(env.SITE_URL);
  });

  it("match index.html, which can't import them", () => {
    const html = read("../index.html");
    expect(html).toContain(`<title>${PRODUCT_NAME}</title>`);
    expect(html).toContain(`"${STORAGE_PREFIX}"`);
    expect(html).toContain(`"${LEGACY_STORAGE_PREFIX}"`);
    expect(html).toContain(`"${STORAGE_PREFIX}theme"`);
  });
});
