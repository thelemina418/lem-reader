// tests/unit/settings/slotIdentity.test.ts
// Issue #41 (ADR 0012) — highlight slots become an ORDERED list of 1–10 with
// stable identities; the default slot points at an identity, not a position.
//   - the pre-parse migration gives legacy five-slot rows generated
//     identities and maps the default from its old index (calm, idempotent);
//   - the schema bounds the list to 1..10, polices unique identities and a
//     default that names an existing slot;
//   - the pure list operations (add / remove / move) keep the default on its
//     slot, and removing the default makes slot 1 the default.
import { describe, expect, it } from "vitest";
import {
  MAX_HIGHLIGHT_SLOTS,
  MIN_HIGHLIGHT_SLOTS,
  ReaderSettingsSchema,
  defaultHighlightSlots,
} from "../../../src/content/schema";
import type { HighlightSlot } from "../../../src/content/schema";
import { migrateReaderSettings } from "../../../src/settings/settingsMigration";
import { DEFAULT_SETTINGS } from "../../../src/settings/defaults";
import {
  addSlot,
  defaultSlotIndex,
  moveSlot,
  removeSlot,
  slotDisplayName,
} from "../../../src/annotations/highlightSlots";

/** A v8 row exactly as the pre-#41 client wrote it: five id-less slots and
 * the default as a position index. */
function v8Row(defaultHighlightSlot: unknown = 2): Record<string, unknown> {
  const { highlightSlots: _s, defaultHighlightSlotId: _d, ...rest } = DEFAULT_SETTINGS;
  return {
    ...rest,
    schemaVersion: 8,
    highlightSlots: defaultHighlightSlots().map(({ id: _id, ...s }) => s),
    defaultHighlightSlot,
  };
}

function slot(overrides: Partial<HighlightSlot> = {}): HighlightSlot {
  return {
    id: "s-x",
    name: "Questions",
    color: "yellow",
    customColorActive: false,
    tags: [],
    ...overrides,
  };
}

describe("slot identity migration (issue #41)", () => {
  it("gives legacy slots generated identities and maps the default from its old index", () => {
    const migrated = migrateReaderSettings(v8Row(2)) as Record<string, unknown>;
    const parsed = ReaderSettingsSchema.parse(migrated);
    expect(parsed.highlightSlots).toHaveLength(5);
    const ids = parsed.highlightSlots.map((s) => s.id);
    expect(new Set(ids).size).toBe(5);
    expect(parsed.defaultHighlightSlotId).toBe(ids[2]);
    expect(parsed.highlightSlots.map((s) => s.name)).toEqual([
      "Default",
      "Yellow",
      "Green",
      "Blue",
      "Pink",
    ]);
    expect("defaultHighlightSlot" in migrated).toBe(false);
  });

  it("is deterministic and idempotent (a migrated row passes through as the same reference)", () => {
    const once = migrateReaderSettings(v8Row(1));
    expect(migrateReaderSettings(v8Row(1))).toEqual(once);
    const parsed = ReaderSettingsSchema.parse(once);
    expect(migrateReaderSettings(parsed)).toBe(parsed);
  });

  it("a legacy row without a default index maps to slot 1", () => {
    const row = v8Row();
    delete row.defaultHighlightSlot;
    const parsed = ReaderSettingsSchema.parse(migrateReaderSettings(row));
    expect(parsed.defaultHighlightSlotId).toBe(parsed.highlightSlots[0]!.id);
  });

  it("an out-of-band legacy index is never silently coerced (the row stays corrupt)", () => {
    expect(ReaderSettingsSchema.safeParse(migrateReaderSettings(v8Row(7))).success).toBe(false);
    expect(ReaderSettingsSchema.safeParse(migrateReaderSettings(v8Row("0"))).success).toBe(false);
  });

  it("a pre-slot row (no slot fields) hydrates the shipped five with slot 1 as default", () => {
    const row = v8Row();
    delete row.highlightSlots;
    delete row.defaultHighlightSlot;
    const parsed = ReaderSettingsSchema.parse(migrateReaderSettings({ ...row, schemaVersion: 6 }));
    expect(parsed.highlightSlots).toEqual(defaultHighlightSlots());
    expect(parsed.defaultHighlightSlotId).toBe(defaultHighlightSlots()[0]!.id);
  });
});

describe("slot list schema bounds (issue #41)", () => {
  const withSlots = (highlightSlots: unknown, defaultHighlightSlotId?: string) =>
    ReaderSettingsSchema.safeParse({
      ...DEFAULT_SETTINGS,
      highlightSlots,
      defaultHighlightSlotId:
        defaultHighlightSlotId ??
        (Array.isArray(highlightSlots) ? (highlightSlots[0] as HighlightSlot | undefined)?.id : ""),
    });
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => slot({ id: `s-${i}`, name: `S${i}` }));

  it("accepts 1 through 10 slots", () => {
    expect(MIN_HIGHLIGHT_SLOTS).toBe(1);
    expect(MAX_HIGHLIGHT_SLOTS).toBe(10);
    expect(withSlots(many(1)).success).toBe(true);
    expect(withSlots(many(10)).success).toBe(true);
  });

  it("refuses zero or eleven slots", () => {
    expect(withSlots([], "s-0").success).toBe(false);
    expect(withSlots(many(11)).success).toBe(false);
  });

  it("refuses duplicate identities", () => {
    expect(withSlots([slot({ id: "a" }), slot({ id: "a" })], "a").success).toBe(false);
  });

  it("refuses a default that names no slot", () => {
    expect(withSlots(many(3), "s-9").success).toBe(false);
  });

  it("accepts an unnamed slot (an empty name)", () => {
    expect(withSlots([slot({ id: "a", name: "" })], "a").success).toBe(true);
  });
});

describe("slot list operations (issue #41)", () => {
  const three = [
    slot({ id: "a", name: "One" }),
    slot({ id: "b", name: "Two" }),
    slot({ id: "c", name: "Three" }),
  ];

  it("addSlot appends an unnamed Neutral slot with no tags and a fresh identity", () => {
    const next = addSlot(three);
    expect(next).toHaveLength(4);
    const added = next[3]!;
    expect(added).toMatchObject({
      name: "",
      color: "default",
      customColorActive: false,
      tags: [],
    });
    expect(["a", "b", "c"]).not.toContain(added.id);
    expect(addSlot(three)[3]!.id).not.toBe(added.id);
  });

  it("addSlot refuses beyond ten (returns the same list)", () => {
    const ten = Array.from({ length: 10 }, (_, i) => slot({ id: `s-${i}` }));
    expect(addSlot(ten)).toBe(ten);
  });

  it("the default follows its identity when its slot moves", () => {
    const moved = moveSlot(three, "b", 1);
    expect(moved.map((s) => s.id)).toEqual(["a", "c", "b"]);
    expect(defaultSlotIndex(moved, "b")).toBe(2);
    expect(moveSlot(three, "a", -1)).toBe(three); // already first
    expect(moveSlot(three, "c", 1)).toBe(three); // already last
  });

  it("removing a non-default slot keeps the default", () => {
    // removeSlot(slots, idToRemove, currentDefaultId)
    const r = removeSlot(three, "a", "c");
    expect(r.slots.map((s) => s.id)).toEqual(["b", "c"]);
    expect(r.defaultHighlightSlotId).toBe("c");
    expect(r.defaultFellBack).toBe(false);
  });

  it("removing the default slot makes slot 1 the default", () => {
    const r = removeSlot(three, "b", "b");
    expect(r.slots.map((s) => s.id)).toEqual(["a", "c"]);
    expect(r.defaultHighlightSlotId).toBe("a");
    expect(r.defaultFellBack).toBe(true);
    const first = removeSlot(three, "a", "a");
    expect(first.defaultHighlightSlotId).toBe("b");
  });

  it("the last slot can never be removed", () => {
    const one = [slot({ id: "a" })];
    const r = removeSlot(one, "a", "a");
    expect(r.slots).toBe(one);
    expect(r.defaultHighlightSlotId).toBe("a");
  });

  it("defaultSlotIndex falls back to slot 1 for an unknown identity", () => {
    expect(defaultSlotIndex(three, "zzz")).toBe(0);
  });

  it("an unnamed slot reads by its number and color", () => {
    expect(slotDisplayName(slot({ name: "", color: "default" }), 5)).toBe("Slot 6 · Neutral");
    expect(slotDisplayName(slot({ name: "", color: "pink" }), 0)).toBe("Slot 1 · Pink");
    expect(
      slotDisplayName(
        slot({ name: "", color: "default", customColor: "#112233", customColorActive: true }),
        2,
      ),
    ).toBe("Slot 3 · Custom");
    expect(slotDisplayName(slot({ name: "Questions" }), 3)).toBe("Questions");
  });
});
