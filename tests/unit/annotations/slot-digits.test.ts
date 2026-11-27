// tests/unit/annotations/slot-digits.test.ts
// Issue #41 (ADR 0012) — the ONE digit → slot vocabulary: `1`–`9` name slots
// 1–9 and `0` names slot 10. (Digits beyond the current slot count are gated
// at the arm site in useSelectionToolbar — the e2e hold/tap specs own that.)
import { describe, expect, it } from "vitest";
import { slotIndexFromDigit } from "../../../src/reader/annotations/useSelectionToolbar";

describe("slotIndexFromDigit (issue #41)", () => {
  it("maps 1–9 to slots 1–9 and 0 to slot 10", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => slotIndexFromDigit(String(d)))).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(slotIndexFromDigit("0")).toBe(9);
  });

  it("any other key names no slot", () => {
    for (const key of ["a", "10", "", " ", "Enter", "-", "!"]) {
      expect(slotIndexFromDigit(key)).toBeNull();
    }
  });
});
