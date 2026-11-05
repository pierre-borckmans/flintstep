import { describe, expect, it } from "vitest";
import { type KeyStore, migrateStorage } from "./storage";

function mem(init: Record<string, string>): KeyStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

describe("migrateStorage", () => {
  it("copies old keys to unset new ones and keeps the old", () => {
    const s = mem({
      "sparkx.theme": "dark",
      "sparkx.nuts": '{"mode":"shuffled"}',
      "sparkx.viewer.split": "60",
      "sparkx.exppedals.placement": "beside",
      "other.thing": "x",
    });
    expect(migrateStorage(s).sort()).toEqual([
      "flintstep.exppedals.placement",
      "flintstep.nuts",
      "flintstep.theme",
      "flintstep.viewer.split",
    ]);
    expect(s.data.get("flintstep.theme")).toBe("dark");
    expect(s.data.get("flintstep.viewer.split")).toBe("60");
    expect(s.data.get("sparkx.theme")).toBe("dark");
    expect(s.data.has("flintstep.thing")).toBe(false);
  });

  it("never overwrites a new value, so it runs once in effect", () => {
    const s = mem({ "sparkx.theme": "dark", "flintstep.theme": "light" });
    expect(migrateStorage(s)).toEqual([]);
    expect(s.data.get("flintstep.theme")).toBe("light");
    expect(migrateStorage(s)).toEqual([]);
  });

  it("survives storage that is missing or throws", () => {
    expect(migrateStorage(undefined)).toEqual([]);
    const broken = mem({ "sparkx.theme": "dark" });
    broken.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    expect(migrateStorage(broken)).toEqual([]);
  });
});
