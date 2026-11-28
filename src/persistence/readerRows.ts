// src/persistence/readerRows.ts
// The reader data one article owns, read the same way by every store that
// previews a change to its text and then applies it inside one transaction
// (Reprocessing, PDF repair, corrections — spec #68 / #78): every revision's
// rows by the [articleId+revision] key, the latest saved position (the
// library's own fold), the stale-preview snapshot, and the shared refusal
// copy. One module so the stores cannot drift apart on what "changed since
// the preview" or "the reader's position" means.

import type { Collection, Table } from "dexie";
import { LocationRecordSchema, type LocationRecord } from "../content/schema";
import { db } from "./db";

/** Apply refused: the article or its reader data changed after the preview. */
export const STALE_PREVIEW =
  "Something changed after the preview, so nothing was changed. Try again.";

/** Apply refused: the preview disclosed consequences nobody accepted. */
export const ACCEPTANCE_REQUIRED =
  "Explicit acceptance is required for the highlights or chapters this affects; nothing was changed.";

/** Every revision's rows of one article, by the [articleId+revision] key. */
export function everyRevision<T, K>(table: Table<T, K>, articleId: string): Collection<T, K> {
  return table
    .where("[articleId+revision]")
    .between([articleId, 0], [articleId, Number.MAX_SAFE_INTEGER]);
}

/** The latest valid saved position among `rows` (newest `savedAt` wins). */
export function latestOf(rows: readonly unknown[]): LocationRecord | undefined {
  return rows
    .flatMap((row) => {
      const parsed = LocationRecordSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    })
    .sort((x, y) => (x.savedAt < y.savedAt ? 1 : x.savedAt > y.savedAt ? -1 : 0))[0];
}

/** The latest saved position of an article across revisions. */
export async function latestLocation(articleId: string): Promise<LocationRecord | undefined> {
  return latestOf(await everyRevision(db.location, articleId).toArray());
}

/** Everything a text-changing apply reads for one article, serialized in a
 * stable order: a preview whose snapshot no longer matches is stale. A
 * correction made between preview and apply is a change too. */
export async function readerRowsSnapshot(articleId: string): Promise<string> {
  const [row, corrections, highlights, locations, completions, collections] = await Promise.all([
    db.articles.get(articleId),
    db.corrections.get(articleId),
    everyRevision(db.highlights, articleId).toArray(),
    everyRevision(db.location, articleId).toArray(),
    db.completions.toArray(),
    db.collections.toArray(),
  ]);
  return JSON.stringify({ row, corrections, highlights, locations, completions, collections });
}
