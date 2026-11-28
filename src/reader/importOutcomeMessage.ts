// src/reader/importOutcomeMessage.ts
// The post-import status sentence (Settings → Your data): what was imported,
// what was skipped, and — never silently — what happened to local
// collections and to imported corrections (spec #68 / issue #77).
import type { ResolvedImportPlan } from "../portability/conflicts";

/** "{n} {noun}" with honest singular/plural agreement (calm DOC-06 voice). */
export function counted(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function importOutcomeMessage(
  plan: Pick<
    ResolvedImportPlan,
    | "articlesToWrite"
    | "highlightsToWrite"
    | "notesToWrite"
    | "articleNotesToWrite"
    | "locationsToWrite"
    | "collectionsToWrite"
    | "skipped"
    | "localCollectionsBrokenByImport"
    | "correctionsNotApplied"
    | "correctionsSetAside"
  >,
): string {
  const skipped =
    plan.skipped.articles +
    plan.skipped.highlights +
    plan.skipped.notes +
    plan.skipped.articleNotes +
    plan.skipped.locations +
    plan.skipped.collections;
  let message = `Imported ${counted(plan.articlesToWrite.length, "article", "articles")}, ${counted(plan.highlightsToWrite.length, "highlight", "highlights")}, ${counted(plan.notesToWrite.length, "note", "notes")}, ${counted(plan.articleNotesToWrite.length, "article note", "article notes")}, ${counted(plan.locationsToWrite.length, "reading position", "reading positions")}, and ${counted(plan.collectionsToWrite.length, "collection", "collections")}.`;
  if (skipped > 0) {
    message += ` ${counted(skipped, "item", "items")} ${skipped === 1 ? "was" : "were"} skipped.`;
  }
  // Issue #249 — the whole-library preflight's honest report: the
  // reader's content choices invalidated entry targets in local
  // collections (blame-attributed: pre-existing breakage is never
  // counted, replaced rows are moot). The rows are never destroyed —
  // the breakage is admitted here, never silent.
  if (plan.localCollectionsBrokenByImport > 0) {
    message += ` ${counted(
      plan.localCollectionsBrokenByImport,
      "collection",
      "collections",
    )} ${plan.localCollectionsBrokenByImport === 1 ? "now points" : "now point"} at readings this import changed.`;
  }
  // Spec #68 / #77 — imported corrections that don't fit their winning
  // original are kept as not applied (the engine gives each its reason),
  // never stripped — and admitted here.
  if (plan.correctionsNotApplied > 0) {
    message += ` ${counted(plan.correctionsNotApplied, "correction", "corrections")} didn't fit and ${
      plan.correctionsNotApplied === 1 ? "was" : "were"
    } kept as not applied.`;
  }
  // ...and incoming corrections set aside because this device's copy won
  // and already had its own.
  if (plan.correctionsSetAside > 0) {
    message +=
      plan.correctionsSetAside === 1
        ? " Corrections for 1 article were set aside: the copy on this device kept its own corrections."
        : ` Corrections for ${plan.correctionsSetAside} articles were set aside: the copies on this device kept their own corrections.`;
  }
  return message;
}
