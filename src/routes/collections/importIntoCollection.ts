// src/routes/collections/importIntoCollection.ts
// Issue #15 — import a new reading directly into a collection
// (collections-and-long-works.md § 9a "Import directly into a collection").
//
// The ONE composition of the two seams that already own their policies:
//   1. addToLibrary — the ordinary ingest → dedupe-refuse → atomic save
//      (D7-07/D16-09 unchanged: an already-saved reading is NEVER re-saved;
//      its refusal carries the existing id, which this module references).
//   2. addCollectionEntry — the membership seam's one-transaction append
//      (ADR 0011: the collection REFERENCES the reading; validation,
//      per-collection non-repetition, and end-of-order append live there).
//
// The import always targets the WHOLE reading: an article → an `article`
// entry, an EPUB → ONE `book` entry (chapters are added afterwards through
// Add readings).
//
// Honesty contract (the spec's last bullet): once the library save landed,
// a failed entry add is reported as `not-added` with `saved: true` — the
// save is never rolled back and the entry is never claimed. A library
// refusal adds nothing and passes its typed reason through unchanged, so
// the dialog's calm refusal copy (and the YouTube transcript fallback)
// behave exactly as on the library import.
import { addToLibrary, type AddToLibraryInput } from "../../ingestion/addToLibrary";
import { skippedChaptersCopy } from "../../ingestion/ingestCopy";
import type { IngestionFailureReason } from "../../ingestion/types";
import { addCollectionEntry } from "../../persistence/collectionsStore";
import type { Collection, CollectionEntryTarget } from "../../content/schema";

/**
 * The outcome of one import-into-collection submission. `saved` is true
 * only when THIS submission created the library item (false when the
 * collection references a reading that was already in the library).
 */
export type CollectionImportOutcome =
  /** The library refused — nothing was saved, nothing was added. */
  | { outcome: "refused"; reason: IngestionFailureReason }
  /** The reading (new or existing) is now the collection's last entry.
   * `notes` are the visible-limit disclosures of a NEW save (empty for a
   * confident save and for an existing reading). */
  | {
      outcome: "added";
      saved: boolean;
      collection: Collection;
      entryId: string;
      notes: string[];
    }
  /** The collection already contains this exact whole-reading target. */
  | { outcome: "already-in-collection"; saved: boolean }
  /** The reading is in the library, but the entry could not be added. */
  | { outcome: "not-added"; saved: boolean };

/** The landed outcomes the collection page renders (focus + announcement). */
export type LandedCollectionImport = Extract<
  CollectionImportOutcome,
  { outcome: "added" | "not-added" }
>;

/**
 * The collection an import dialog session lands in: the collection page
 * builds it ("Import into collection"), the app shell hands it to the ONE
 * import dialog, and the dialog reports a landed outcome back through
 * `onImported` (the page owns focus on the new entry and the status
 * announcement — a live region inside the closing dialog could not
 * announce).
 */
export type CollectionImportDestination = {
  collectionId: string;
  collectionName: string;
  onImported: (outcome: LandedCollectionImport) => void;
};

export async function importIntoCollection(
  collectionId: string,
  input: AddToLibraryInput,
  tags: readonly string[] = [],
): Promise<CollectionImportOutcome> {
  const libraryOutcome = await addToLibrary(input, tags);

  let target: CollectionEntryTarget;
  let saved: boolean;
  let notes: string[] = [];
  if (libraryOutcome.outcome === "saved-article") {
    target = { kind: "article", articleId: libraryOutcome.articleId };
    saved = true;
    notes = [libraryOutcome.note, ...libraryOutcome.warnings, libraryOutcome.degraded].filter(
      (line): line is string => line !== undefined,
    );
  } else if (libraryOutcome.outcome === "saved-book") {
    target = { kind: "book", bookId: libraryOutcome.bookId };
    saved = true;
    if (libraryOutcome.skippedChapterCount > 0) {
      notes = [skippedChaptersCopy(libraryOutcome.skippedChapterCount)];
    }
  } else if (
    libraryOutcome.reason === "already-in-library" &&
    libraryOutcome.existingArticleId !== undefined
  ) {
    target = { kind: "article", articleId: libraryOutcome.existingArticleId };
    saved = false;
  } else if (
    libraryOutcome.reason === "already-in-library" &&
    libraryOutcome.existingBookId !== undefined
  ) {
    target = { kind: "book", bookId: libraryOutcome.existingBookId };
    saved = false;
  } else {
    return { outcome: "refused", reason: libraryOutcome.reason };
  }

  try {
    const added = await addCollectionEntry(collectionId, target);
    if (added.outcome === "added") {
      const entry = added.collection.entries[added.collection.entries.length - 1];
      if (entry !== undefined) {
        return { outcome: "added", saved, collection: added.collection, entryId: entry.id, notes };
      }
    } else if (added.outcome === "duplicate") {
      return { outcome: "already-in-collection", saved };
    }
  } catch {
    // A storage failure on the membership write: the library save (if any)
    // already landed and stays — reported below, never rolled back.
  }
  return { outcome: "not-added", saved };
}
