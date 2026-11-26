// src/routes/collections/collectionImportCopy.ts
// Issue #15 — the reader-facing copy for an import into a collection. Kept
// free of persistence imports: the add dialog renders it synchronously and
// loads the importIntoCollection service itself only when a collection
// import is submitted.

/** The parts of an outcome the page-level announcement depends on. */
export type CollectionImportAnnouncementInput =
  | { outcome: "added"; saved: boolean; notes: readonly string[] }
  | { outcome: "already-in-collection"; saved: boolean }
  | { outcome: "not-added"; saved: boolean };

/**
 * collectionImportAnnouncement — the page-level status lines for a landed
 * import (the first line is the outcome; any further lines are the new
 * reading's visible-limit notes, the same sentences the reader renders).
 */
export function collectionImportAnnouncement(
  outcome: CollectionImportAnnouncementInput,
  collectionName: string,
): string[] {
  switch (outcome.outcome) {
    case "added":
      return [
        outcome.saved
          ? `Saved to your library and added to ${collectionName}.`
          : `Already in your library — added to ${collectionName}.`,
        ...outcome.notes,
      ];
    case "not-added":
      return [
        outcome.saved
          ? `Saved to your library, but it couldn't be added to ${collectionName}.`
          : `Already in your library, but it couldn't be added to ${collectionName}.`,
      ];
    case "already-in-collection":
      return [`That reading is already in ${collectionName}. Nothing was added.`];
  }
}
