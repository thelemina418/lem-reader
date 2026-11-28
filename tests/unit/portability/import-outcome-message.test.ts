// Spec #68 / issue #77 — the post-import status message admits what happened
// to imported corrections: ones that didn't fit their winning original are
// kept as not applied, and ones set aside because this device's copy won and
// already had its own corrections are named too (never silent).
import { describe, expect, it } from "vitest";
import { importOutcomeMessage } from "../../../src/reader/importOutcomeMessage";
import type { ResolvedImportPlan } from "../../../src/portability/conflicts";

type Counts = Parameters<typeof importOutcomeMessage>[0];

const plan = (overrides: Partial<Counts> = {}): Counts => ({
  articlesToWrite: [{}, {}] as ResolvedImportPlan["articlesToWrite"],
  highlightsToWrite: [],
  notesToWrite: [],
  articleNotesToWrite: [],
  locationsToWrite: [],
  collectionsToWrite: [],
  skipped: {
    books: 0,
    articles: 0,
    highlights: 0,
    notes: 0,
    articleNotes: 0,
    locations: 0,
    collections: 0,
  } as ResolvedImportPlan["skipped"],
  localCollectionsBrokenByImport: 0,
  correctionsNotApplied: 0,
  correctionsSetAside: 0,
  ...overrides,
});

const BASE =
  "Imported 2 articles, 0 highlights, 0 notes, 0 article notes, 0 reading positions, and 0 collections.";

describe("importOutcomeMessage", () => {
  it("says nothing about corrections when every imported correction was applied", () => {
    expect(importOutcomeMessage(plan())).toBe(BASE);
  });

  it("admits corrections that didn't fit as kept but not applied", () => {
    expect(importOutcomeMessage(plan({ correctionsNotApplied: 1 }))).toBe(
      `${BASE} 1 correction didn't fit and was kept as not applied.`,
    );
    expect(importOutcomeMessage(plan({ correctionsNotApplied: 3 }))).toBe(
      `${BASE} 3 corrections didn't fit and were kept as not applied.`,
    );
  });

  it("tells the reader when incoming corrections were set aside for this device's own", () => {
    expect(importOutcomeMessage(plan({ correctionsSetAside: 1 }))).toBe(
      `${BASE} Corrections for 1 article were set aside: the copy on this device kept its own corrections.`,
    );
    expect(importOutcomeMessage(plan({ correctionsSetAside: 2, correctionsNotApplied: 1 }))).toBe(
      `${BASE} 1 correction didn't fit and was kept as not applied. Corrections for 2 articles were set aside: the copies on this device kept their own corrections.`,
    );
  });
});
