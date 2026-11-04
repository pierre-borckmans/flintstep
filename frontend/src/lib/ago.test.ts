import { describe, expect, it } from "vitest";
import { ago } from "./ago";

describe("ago", () => {
  it("rounds down to the unit", () => {
    expect(ago(0, 0)).toBe("just now");
    expect(ago(0, 9_999)).toBe("just now");
    expect(ago(0, 10_000)).toBe("10 s ago");
    expect(ago(0, 59_999)).toBe("59 s ago");
    expect(ago(0, 60_000)).toBe("1 min ago");
    expect(ago(0, 3_599_000)).toBe("59 min ago");
    expect(ago(0, 7_300_000)).toBe("2 h ago");
  });
  it("treats a clock behind the entry as now", () => expect(ago(5000, 0)).toBe("just now"));
});
