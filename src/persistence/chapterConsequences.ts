// Chapter consequences of replacing a work's structure: which chapter
// completions and collection entries would lose their meaning. Shared by the
// two explicit, previewed library operations that can move chapter
// boundaries — PDF structural repair and Reprocessing (#63).
import type { CollectionEntryTarget, WorkStructure } from "../content/schema";
import { db } from "./db";

export type ChapterConsequence =
  | { kind: "completion"; id: string; label: string }
  | { kind: "collection-entry"; collectionId: string; entryId: string; label: string };

/** No writes. A chapter target keeps its meaning only when the same
 * destination exists, identical, in both structures. */
export async function chapterConsequences(
  articleId: string,
  before: WorkStructure | undefined | null,
  after: WorkStructure | undefined | null,
): Promise<ChapterConsequence[]> {
  const reliableChapter = (target: CollectionEntryTarget): boolean => {
    if (target.kind !== "work-chapter" || target.articleId !== articleId) return true;
    const was = before?.destinations.find(
      (d) => d.id === target.destinationId && d.kind === "chapter",
    );
    const now = after?.destinations.find(
      (d) => d.id === target.destinationId && d.kind === "chapter",
    );
    return was !== undefined && now !== undefined && JSON.stringify(was) === JSON.stringify(now);
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
