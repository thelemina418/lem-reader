// tests/unit/settings/customColorDormancy.test.ts
// Issue #222 — the slot's custom hex becomes a DORMANT memory (ADR 0008,
// amended): a slot gains `customColorActive` — `false` + hex = dormant (the
// remembered hex is retained while a named fill is active), `true` + hex =
// active, `true` without a hex is unrepresentable (the schema's
// superRefine polices it into the honest corrupt routing). The unit layer
// pins:
//
//   1. The entry-seam migration (migrateReaderSettings): a pre-#222 slot
//      with a customColor snapshot arrives ACTIVE (existing hex ⇒
//      customColorActive: true); slots without one arrive inactive; an
//      already-migrated row passes through UNCHANGED (same reference —
//      idempotent at the seams); a garbage highlightSlots rides through
//      untouched so the downstream parse still fails (STATE-04).
//   2. The schema contract: active/dormant/plain rows parse; `true` without
//      a hex fails; the parsed v8 row round-trips BYTE-STABLY
//      (JSON.stringify(parse(row)) equals the stored bytes) — the Dexie /
//      mirror / bundle re-write can never churn a stored row.
//   3. The shipped defaults: every shipped slot starts inactive, and the
//      canonical write version is 8.
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../../src/settings/defaults";
import { ReaderSettingsSchema, defaultHighlightSlots } from "../../../src/content/schema";
import { migrateReaderSettings } from "../../../src/settings/settingsMigration";

/** A v7 reader-prefs row (pre-#222): slot 3 carries a custom color snapshot
 * and NO customColorActive key — the exact shape #196/#219 wrote. */
function v7Row(): Record<string, unknown> {
  return {
    schemaVersion: 7,
    font: "serif",
    size: 18,
    measure: 64,
    spacing: "comfortable",
    theme: "sepia",
    animatePageTurns: false,
    readingMode: "paginated",
    showReadAloud: true,
    speechNoticeDismissed: false,
    rate: 1,
    librarySort: "recently-added",
    openAfterAdd: true,
    highlightSlots: [
      { name: "Default", color: "default", tags: [] },
      { name: "Yellow", color: "yellow", tags: [] },
      { name: "Custom", color: "blue", customColor: "#e9c46a", tags: ["essays"] },
      { name: "Blue", color: "blue", tags: [] },
      { name: "Pink", color: "pink", tags: [] },
    ],
    defaultHighlightSlot: 2,
  };
}

describe("migrateReaderSettings — the #222 dormancy migration", () => {
  it("a pre-#222 slot with a customColor snapshot arrives ACTIVE (hex retained)", () => {
    const out = migrateReaderSettings(v7Row()) as {
      highlightSlots: Array<Record<string, unknown>>;
    };
    expect(out.highlightSlots[2]).toEqual({
      id: "slot-3", // issue #41 — the identity migration composes
      name: "Custom",
      color: "blue",
      customColor: "#e9c46a",
      customColorActive: true,
      tags: ["essays"],
    });
  });

  it("pre-#222 slots without a snapshot arrive inactive (customColorActive: false)", () => {
    const out = migrateReaderSettings(v7Row()) as {
      highlightSlots: Array<Record<string, unknown>>;
    };
    expect(out.highlightSlots[0]).toEqual({
      id: "slot-1",
      name: "Default",
      color: "default",
      customColorActive: false,
      tags: [],
    });
    expect(out.highlightSlots[4]).toEqual({
      id: "slot-5",
      name: "Pink",
      color: "pink",
      customColorActive: false,
      tags: [],
    });
  });

  it("an already-migrated (v9) row passes through UNCHANGED — same reference, idempotent at the seams", () => {
    const { defaultHighlightSlot: _index, ...v7 } = v7Row();
    const row = {
      ...v7,
      schemaVersion: 9,
      defaultHighlightSlotId: "slot-3",
      highlightSlots: [
        { id: "slot-1", name: "Default", color: "default", customColorActive: false, tags: [] },
        { id: "slot-2", name: "Yellow", color: "yellow", customColorActive: false, tags: [] },
        {
          id: "slot-3",
          name: "Custom",
          color: "blue",
          customColor: "#e9c46a",
          customColorActive: true,
          tags: [],
        },
        { id: "slot-4", name: "Blue", color: "blue", customColorActive: false, tags: [] },
        { id: "slot-5", name: "Pink", color: "pink", customColorActive: false, tags: [] },
      ],
    };
    expect(migrateReaderSettings(row)).toBe(row);
  });

  it("a row WITHOUT highlightSlots passes through UNCHANGED (the .default() hydration owns it)", () => {
    const row: Record<string, unknown> = { ...v7Row() };
    delete row.highlightSlots;
    delete row.defaultHighlightSlot; // a pre-#195 row carries neither slot field
    expect(migrateReaderSettings(row)).toBe(row);
  });

  it("a GARBAGE highlightSlots (non-array) rides through untouched — downstream parse fails → the honest corrupt routing", () => {
    const row: Record<string, unknown> = { ...v7Row(), highlightSlots: "five slots" };
    delete row.defaultHighlightSlot;
    expect(migrateReaderSettings(row)).toBe(row);
  });

  it.each(["false", null, 0, undefined])(
    "preserves an invalid present dormancy value (%s) for rejection",
    (value) => {
      const row = v7Row();
      (row.highlightSlots as Array<Record<string, unknown>>)[2]!.customColorActive = value;
      const migrated = migrateReaderSettings(row) as typeof row;
      expect(
        (migrated.highlightSlots as Array<Record<string, unknown>>)[2]!.customColorActive,
      ).toBe(value);
      expect(ReaderSettingsSchema.safeParse(migrated).success).toBe(false);
    },
  );

  it("does not mutate the input row", () => {
    const row = v7Row();
    migrateReaderSettings(row);
    expect((row.highlightSlots as Array<Record<string, unknown>>)[2]).not.toHaveProperty(
      "customColorActive",
    );
  });
});

describe("ReaderSettingsSchema — the dormancy shape (issue #222)", () => {
  it("an ACTIVE slot (true + hex) parses; the parsed row round-trips BYTE-STABLY", () => {
    const row = { ...v7Row(), schemaVersion: 9 } as Record<string, unknown>;
    delete row.defaultHighlightSlot; // issue #41 — the default is an identity now
    // Fill the migration by hand (the exact bytes a v9 write emits).
    row.highlightSlots = [
      { id: "slot-1", name: "Default", color: "default", customColorActive: false, tags: [] },
      { id: "slot-2", name: "Yellow", color: "yellow", customColorActive: false, tags: [] },
      {
        id: "slot-3",
        name: "Custom",
        color: "blue",
        customColor: "#e9c46a",
        customColorActive: true,
        tags: [],
      },
      { id: "slot-4", name: "Blue", color: "blue", customColorActive: false, tags: [] },
      { id: "slot-5", name: "Pink", color: "pink", customColorActive: false, tags: [] },
    ];
    row.defaultHighlightSlotId = "slot-3";
    const parsed = ReaderSettingsSchema.parse(JSON.parse(JSON.stringify(row)));
    // Byte-stable: the Dexie/mirror/bundle re-write of a parsed v9 row
    // cannot churn a single byte.
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(row));
  });

  it("a DORMANT slot (false + retained hex) parses byte-stably", () => {
    const row = { ...v7Row(), schemaVersion: 9 } as Record<string, unknown>;
    delete row.defaultHighlightSlot; // issue #41 — the default is an identity now
    row.highlightSlots = [
      { id: "slot-1", name: "Default", color: "default", customColorActive: false, tags: [] },
      { id: "slot-2", name: "Yellow", color: "yellow", customColorActive: false, tags: [] },
      {
        id: "slot-3",
        name: "Custom",
        color: "blue",
        customColor: "#e9c46a",
        customColorActive: false,
        tags: [],
      },
      { id: "slot-4", name: "Blue", color: "blue", customColorActive: false, tags: [] },
      { id: "slot-5", name: "Pink", color: "pink", customColorActive: false, tags: [] },
    ];
    row.defaultHighlightSlotId = "slot-3";
    const parsed = ReaderSettingsSchema.parse(JSON.parse(JSON.stringify(row)));
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(row));
  });

  it.each([
    ["active without a hex", true, undefined],
    ["active with a GARBAGE hex", true, "gold"],
  ])(
    "a slot with customColorActive %s and %s fails parse — `true` without a hex is unrepresentable",
    (_label, active, hex) => {
      const row = { ...v7Row(), schemaVersion: 8 } as Record<string, unknown>;
      delete row.defaultHighlightSlot;
      row.defaultHighlightSlotId = "slot-1";
      const slots = [
        { id: "slot-1", name: "Default", color: "default", customColorActive: false, tags: [] },
        { id: "slot-2", name: "Yellow", color: "yellow", customColorActive: false, tags: [] },
        { id: "slot-3", name: "Custom", color: "blue", customColorActive: active, tags: [] },
        { id: "slot-4", name: "Blue", color: "blue", customColorActive: false, tags: [] },
        { id: "slot-5", name: "Pink", color: "pink", customColorActive: false, tags: [] },
      ];
      if (hex !== undefined) (slots[2] as Record<string, unknown>).customColor = hex;
      row.highlightSlots = slots;
      expect(ReaderSettingsSchema.safeParse(row).success).toBe(false);
    },
  );

  it("the migration output parses (the v7 → v8 hand-off is coherent end to end)", () => {
    const parsed = ReaderSettingsSchema.safeParse(migrateReaderSettings(v7Row()));
    expect(parsed.success).toBe(true);
  });

  it("schemaVersion 10 forward-rejects (the V5 boundary discipline holds — issue #41 made 9 current)", () => {
    const row = {
      ...(migrateReaderSettings(v7Row()) as Record<string, unknown>),
      schemaVersion: 10,
    };
    expect(ReaderSettingsSchema.safeParse(row).success).toBe(false);
  });
});

describe("the shipped defaults (issue #222)", () => {
  it("the canonical write version is 9 (issue #41 moved it from #222's 8)", () => {
    expect(DEFAULT_SETTINGS.schemaVersion).toBe(9);
  });

  it("every shipped slot starts INACTIVE (no custom colors — the shipped defaults stay named)", () => {
    expect(defaultHighlightSlots().map((s) => s.customColorActive)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
