// Chapter consequences of replacing a work's structure: which chapter
// completions and collection entries would lose their meaning. Shared by the
// explicit, previewed library operations that can move chapter boundaries —
// PDF structural repair, Reprocessing (#63) and Corrections (spec #68 / #72)
// — together with the one writer that applies accepted consequences.
import {
  CollectionSchema,
  type CollectionEntryTarget,
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
 * (src/content/corrections/structure.ts), so for them the same id with the
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

/** Inside the caller's transaction (completions, collections and
 * collectionActiveEntries in scope): drop the accepted completion and
 * collection-entry consequences, and forget a removed active entry. */
export async function writeChapterConsequences(
  consequences: readonly ChapterConsequence[],
  updatedAt: string,
): Promise<void> {
  for (const consequence of consequences) {
    if (consequence.kind === "completion") await db.completions.delete(consequence.id);
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
    await db.collections.put({
      ...before,
      entries: before.entries.filter((entry) => !removed.has(entry.id)),
      updatedAt,
    });
    const active = await db.collectionActiveEntries.get(id);
    if (active && removed.has(active.entryId)) await db.collectionActiveEntries.delete(id);
  }
}
