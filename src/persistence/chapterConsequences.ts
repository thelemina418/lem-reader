// Chapter consequences of replacing a work's structure: which chapter
// completions and collection entries would lose their meaning. Shared by the
// explicit, previewed library operations that can move chapter boundaries —
// PDF structural repair, Reprocessing (#63) and Corrections (spec #68 / #72)
// — together with the one writer that applies accepted consequences.
import {
  CollectionSchema,
  CompletionRecordSchema,
  type CollectionEntry,
  type CollectionEntryTarget,
  type CompletionRecord,
  type StructureDestination,
  type WorkStructure,
} from "../content/schema";
import { db } from "./db";

export type ChapterConsequence =
  | { kind: "completion"; id: string; label: string }
  | { kind: "collection-entry"; collectionId: string; entryId: string; label: string };

/** Is `now` still the chapter `was` was? */
export type SameChapter = (was: StructureDestination, now: StructureDestination) => boolean;

/** Repair and Reprocessing: the destination must be identical, range and all
 * (their ids encode the original's ranges). */
const identical: SameChapter = (was, now) => JSON.stringify(was) === JSON.stringify(now);

/** No writes. A chapter target keeps its meaning only when a destination
 * with its id exists in both structures and `sameChapter` holds (by default:
 * identical). Corrections carry unchanged chapters' ids over by heading text
 * (src/content/corrections/correctedStructure.ts), so for them the same id with the
 * same title is the same chapter even though its range moved. */
export async function chapterConsequences(
  articleId: string,
  before: WorkStructure | undefined | null,
  after: WorkStructure | undefined | null,
  sameChapter: SameChapter = identical,
): Promise<ChapterConsequence[]> {
  const reliableChapter = (target: CollectionEntryTarget): boolean => {
    if (target.kind !== "work-chapter" || target.articleId !== articleId) return true;
    const was = before?.destinations.find(
      (d) => d.id === target.destinationId && d.kind === "chapter",
    );
    const now = after?.destinations.find(
      (d) => d.id === target.destinationId && d.kind === "chapter",
    );
    return was !== undefined && now !== undefined && sameChapter(was, now);
  };
  const chapterLabel = (target: CollectionEntryTarget): string => {
    if (target.kind !== "work-chapter") return "unknown chapter";
    const title =
      before?.destinations.find((d) => d.id === target.destinationId)?.title ??
      target.destinationId;
    // Preview copy is bounded; the complete titles remain in the chapter
    // disclosures. This does not truncate canonical content or navigation.
    return `“${title.length > 120 ? `${title.slice(0, 120)}…` : title}” (${target.destinationId})`;
  };
  const consequences: ChapterConsequence[] = [];
  for (const completion of await db.completions.toArray()) {
    if (!reliableChapter(completion.target))
      consequences.push({
        kind: "completion",
        id: completion.targetKey,
        label: `Remove ${completion.finished ? "finished" : "unfinished"} status for chapter ${chapterLabel(completion.target)}.`,
      });
  }
  for (const collection of await db.collections.toArray()) {
    for (const entry of collection.entries) {
      if (!reliableChapter(entry.target))
        consequences.push({
          kind: "collection-entry",
          collectionId: collection.id,
          entryId: entry.id,
          label: `Remove chapter ${chapterLabel(entry.target)}, entry ${entry.id}, from “${collection.name}”; it cannot be redirected to a different chapter.`,
        });
    }
  }
  return consequences;
}

/** The rows an accepted chapter consequence removed — kept by the
 * Correction view's session history so undoing the change that removed them
 * can bring them back (#76). Never persisted. */
export interface RemovedChapterRows {
  readonly completions: readonly CompletionRecord[];
  readonly entries: readonly {
    readonly collectionId: string;
    readonly index: number;
    readonly entry: CollectionEntry;
  }[];
}

export const NO_REMOVED_ROWS: RemovedChapterRows = Object.freeze({
  completions: Object.freeze([]),
  entries: Object.freeze([]),
}) as RemovedChapterRows;

/** Inside the caller's transaction (completions, collections and
 * collectionActiveEntries in scope): drop the accepted completion and
 * collection-entry consequences, and forget a removed active entry.
 * Returns exactly the rows it removed. */
export async function writeChapterConsequences(
  consequences: readonly ChapterConsequence[],
  updatedAt: string,
): Promise<RemovedChapterRows> {
  const completions: CompletionRecord[] = [];
  const entries: { collectionId: string; index: number; entry: CollectionEntry }[] = [];
  for (const consequence of consequences) {
    if (consequence.kind !== "completion") continue;
    const parsed = CompletionRecordSchema.safeParse(await db.completions.get(consequence.id));
    if (parsed.success) completions.push(parsed.data);
    await db.completions.delete(consequence.id);
  }
  const byCollection = new Map<string, Set<string>>();
  for (const item of consequences) {
    if (item.kind !== "collection-entry") continue;
    const set = byCollection.get(item.collectionId) ?? new Set<string>();
    set.add(item.entryId);
    byCollection.set(item.collectionId, set);
  }
  for (const [id, removed] of byCollection) {
    const before = CollectionSchema.parse(await db.collections.get(id));
    before.entries.forEach((entry, index) => {
      if (removed.has(entry.id)) entries.push({ collectionId: id, index, entry });
    });
    await db.collections.put({
      ...before,
      entries: before.entries.filter((entry) => !removed.has(entry.id)),
      updatedAt,
    });
    const active = await db.collectionActiveEntries.get(id);
    if (active && removed.has(active.entryId)) await db.collectionActiveEntries.delete(id);
  }
  return { completions, entries };
}

/** Which removed rows would mean what they meant again under `after`: a
 * completion whose chapter is back (and has no row of its own since), an
 * entry whose chapter is back in a collection that still exists and no
 * longer holds it. No writes. */
export async function reinstatableRows(
  articleId: string,
  rows: RemovedChapterRows,
  after: WorkStructure | undefined | null,
): Promise<RemovedChapterRows> {
  const back = (target: CollectionEntryTarget): boolean =>
    target.kind === "work-chapter" &&
    target.articleId === articleId &&
    (after?.destinations.some((d) => d.id === target.destinationId && d.kind === "chapter") ??
      false);
  const completions: CompletionRecord[] = [];
  for (const row of rows.completions) {
    if (back(row.target) && (await db.completions.get(row.targetKey)) === undefined) {
      completions.push(row);
    }
  }
  const entries: RemovedChapterRows["entries"][number][] = [];
  for (const item of rows.entries) {
    if (!back(item.entry.target)) continue;
    const parsed = CollectionSchema.safeParse(await db.collections.get(item.collectionId));
    if (parsed.success && !parsed.data.entries.some((e) => e.id === item.entry.id)) {
      entries.push(item);
    }
  }
  return { completions, entries };
}

/** Plain words for rows that would come back (the consequences dialog). */
export function reinstateLabels(
  rows: RemovedChapterRows,
  after: WorkStructure | undefined | null,
  collectionNames: ReadonlyMap<string, string>,
): string[] {
  const title = (target: CollectionEntryTarget) => {
    const id = target.kind === "work-chapter" ? target.destinationId : "";
    const t = after?.destinations.find((d) => d.id === id)?.title ?? id;
    return `“${t.length > 120 ? `${t.slice(0, 120)}…` : t}”`;
  };
  return [
    ...rows.completions.map(
      (row) =>
        `Bring back ${row.finished ? "finished" : "unfinished"} status for chapter ${title(row.target)}.`,
    ),
    ...rows.entries.map(
      (item) =>
        `Put chapter ${title(item.entry.target)} back in “${collectionNames.get(item.collectionId) ?? "a collection"}”.`,
    ),
  ];
}

/** Inside the caller's transaction: put reinstatable rows back (entries at
 * their old place, clamped). */
export async function writeReinstatedRows(
  rows: RemovedChapterRows,
  updatedAt: string,
): Promise<void> {
  for (const row of rows.completions) await db.completions.put(row);
  const byCollection = new Map<string, RemovedChapterRows["entries"][number][]>();
  for (const item of rows.entries) {
    byCollection.set(item.collectionId, [...(byCollection.get(item.collectionId) ?? []), item]);
  }
  for (const [id, items] of byCollection) {
    const parsed = CollectionSchema.safeParse(await db.collections.get(id));
    if (!parsed.success) continue;
    const entries = [...parsed.data.entries];
    for (const item of [...items].sort((a, b) => a.index - b.index)) {
      if (entries.some((e) => e.id === item.entry.id)) continue;
      entries.splice(Math.min(item.index, entries.length), 0, item.entry);
    }
    await db.collections.put({ ...parsed.data, entries, updatedAt });
  }
}
