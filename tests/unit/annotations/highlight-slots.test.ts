// tests/unit/annotations/highlight-slots.test.ts
// Issue #195 — the ONE pure highlight-slot vocabulary (highlightSlots.ts):
//   - slotPreset normalizes the slot's tags through the ONE normalizeTags
//     seam (trim, drop empties, case-insensitive dedupe) and carries the
//     closed-set color verbatim;
//   - defaultSlotIndex resolves the settings' EXPLICIT default-slot identity
//     (defensively clamped — a slot is configuration, never a crash);
//   - mergeSlotTags is the ADDITIVE union: existing tags keep their values,
//     casings, and order; the slot's tags join the end; a case twin never
//     stacks.
// Pure functions — no DOM, no React, no persistence.
import { describe, expect, it } from "vitest";
import { defaultHighlightSlots } from "../../../src/content/schema";
import type { HighlightSlot } from "../../../src/content/schema";
import {
  activeCustomColor,
  defaultSlotIndex,
  mergeSlotTags,
  slotPreset,
} from "../../../src/annotations/highlightSlots";

function slot(overrides: Partial<HighlightSlot> = {}): HighlightSlot {
  return {
    id: "t-6",
    name: "Reading list",
    color: "yellow",
    customColorActive: false,
    tags: [],
    ...overrides,
  };
}

describe("slotPreset (issue #195)", () => {
  it("carries the slot's color verbatim and normalizes its tags", () => {
    const preset = slotPreset(
      slot({ color: "green", tags: ["  Essays ", "reading", "ESSAYS", ""] }),
    );
    expect(preset.color).toBe("green");
    // Trimmed, empties dropped, case twins folded (first-seen casing wins).
    expect(preset.tags).toEqual(["Essays", "reading"]);
  });

  it("an empty tag list stays empty", () => {
    expect(slotPreset(slot({ tags: [] })).tags).toEqual([]);
  });

  it("carries a custom color snapshot verbatim (issue #196; #222 — while Custom is ACTIVE)", () => {
    const preset = slotPreset(
      slot({ color: "default", customColor: "#e9c46a", customColorActive: true, tags: [] }),
    );
    expect(preset.customColor).toBe("#e9c46a");
    expect(preset.color).toBe("default");
  });

  it("a named-color slot's payload carries NO customColor key (absent stays absent — the JSON round-trip)", () => {
    const preset = slotPreset(slot({ color: "pink", tags: [] }));
    expect("customColor" in preset).toBe(false);
    expect(JSON.stringify(preset)).not.toContain("customColor");
  });

  it("carries the custom hex only while Custom is the slot's ACTIVE source (issue #222)", () => {
    const preset = slotPreset(
      slot({ color: "blue", customColor: "#e9c46a", customColorActive: true, tags: [] }),
    );
    expect(preset.customColor).toBe("#e9c46a");
  });

  it("a DORMANT hex (retained while a named fill is active) rides NO customColor (issue #222)", () => {
    const preset = slotPreset(
      slot({ color: "blue", customColor: "#e9c46a", customColorActive: false, tags: [] }),
    );
    expect("customColor" in preset).toBe(false);
    expect(JSON.stringify(preset)).not.toContain("customColor");
    expect(preset.color).toBe("blue");
  });

  it("activeCustomColor gates the hex on the active flag — the ONE door every consumer reads through", () => {
    expect(activeCustomColor(slot({ customColor: "#e9c46a", customColorActive: true }))).toBe(
      "#e9c46a",
    );
    expect(
      activeCustomColor(slot({ customColor: "#e9c46a", customColorActive: false })),
    ).toBeUndefined();
    expect(activeCustomColor(slot({ customColorActive: true }))).toBeUndefined();
  });
});

describe("the default slot resolves by identity (issues #195/#41)", () => {
  it("reads the explicit default-slot choice from the settings record", () => {
    const slots: HighlightSlot[] = defaultHighlightSlots().map((s, i) =>
      i === 3 ? { ...s, name: "Important", color: "blue", tags: ["important"] } : s,
    );
    const preset = slotPreset(slots[defaultSlotIndex(slots, slots[3]!.id)]!);
    expect(preset.color).toBe("blue");
    expect(preset.tags).toEqual(["important"]);
  });

  it("follows the default's IDENTITY, not its position (issue #41)", () => {
    const slots = defaultHighlightSlots();
    const moved = [slots[4]!, ...slots.slice(0, 4)]; // Pink moved to the top
    expect(slotPreset(moved[defaultSlotIndex(moved, slots[4]!.id)]!).color).toBe("pink");
    expect(slotPreset(moved[defaultSlotIndex(moved, slots[0]!.id)]!).color).toBe("default");
  });

  it("an identity naming no slot falls back to slot 1 (defence in depth — the schema requires it to exist)", () => {
    const slots = defaultHighlightSlots();
    expect(slotPreset(slots[defaultSlotIndex(slots, "gone")]!).color).toBe("default");
  });
});

describe("mergeSlotTags (issue #195 — applying a slot adds tags, never removes)", () => {
  it("keeps every existing tag in order and appends the slot's tags", () => {
    expect(mergeSlotTags(["essays", "to-reread"], ["reading", "key-idea"])).toEqual([
      "essays",
      "to-reread",
      "reading",
      "key-idea",
    ]);
  });

  it("a case twin resolves to the EXISTING tag's casing (first-seen wins)", () => {
    expect(mergeSlotTags(["Essays"], ["essays", "ESSAYS"])).toEqual(["Essays"]);
  });

  it("dedupes within the slot's own tags and trims both sides", () => {
    expect(mergeSlotTags([" a "], ["a", "b", " b "])).toEqual(["a", "b"]);
  });

  it("applying to a highlight with no tags is a plain normalized copy", () => {
    expect(mergeSlotTags([], [" Essays ", ""])).toEqual(["Essays"]);
  });
});

describe("defaultHighlightSlots (issue #195 — the shipped set)", () => {
  it("is exactly the five shipped choices with empty tags, numbered 1–5 (no custom colors — the shipped defaults stay named)", () => {
    expect(defaultHighlightSlots()).toEqual([
      { id: "slot-1", name: "Default", color: "default", customColorActive: false, tags: [] },
      { id: "slot-2", name: "Yellow", color: "yellow", customColorActive: false, tags: [] },
      { id: "slot-3", name: "Green", color: "green", customColorActive: false, tags: [] },
      { id: "slot-4", name: "Blue", color: "blue", customColorActive: false, tags: [] },
      { id: "slot-5", name: "Pink", color: "pink", customColorActive: false, tags: [] },
    ]);
    for (const s of defaultHighlightSlots()) {
      expect("customColor" in s).toBe(false);
    }
  });

  it("returns a FRESH deep copy per call (no shared references across parses)", () => {
    const a = defaultHighlightSlots();
    const b = defaultHighlightSlots();
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
    expect(a[0]?.tags).not.toBe(b[0]?.tags);
  });
});
