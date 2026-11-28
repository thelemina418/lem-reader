// PDF structural repair. Spec #68 / #78: the reader's corrections are
// re-applied to the repaired original inside the preview (by finding their
// text, through the one engine), so chapter consequences and chapters
// before/after are what the reader reads; corrections that no longer fit
// are listed and stay in the corrections list as not applied. A repair
// changes block kinds without a revision bump, so the repaired original
// carries its own `repairStamp` (src/content/sameText.ts) and the saved
// reading position is re-stamped in the same transaction (by repair and by
// recovery), carried by quote when corrections change what is read.
import { z } from "zod";
import {
  ArticleSchema,
  CollectionSchema,
  CollectionActiveEntrySchema,
  CompletionRecordSchema,
  type CanonicalArticle,
  type LocationRecord,
} from "../content/schema";
import { deriveWorkStructure } from "../content/structure";
import { normalizeText } from "../content/normalizeText";
import { carryOffset } from "../content/corrections/positions";
import { reapplyCorrections, type NotAppliedCorrection } from "../content/corrections/reapply";
import { isSameText, repairStampOf, textStamp, type TextStamp } from "../content/sameText";
import type { Correction } from "../content/schema";
import { db } from "./db";
import { chapterConsequences, type ChapterConsequence } from "./chapterConsequences";
import { loadCorrections } from "./correctionsStore";
import { ACCEPTANCE_REQUIRED, everyRevision, latestLocation, STALE_PREVIEW } from "./readerRows";

export class PdfRepairRefusal extends Error {}

const StoredArticle = ArticleSchema.passthrough();
const Backup = z.object({
  schemaVersion: z.literal(1).default(1),
  article: StoredArticle,
  appliedArticle: z.string(),
  completions: z.array(CompletionRecordSchema).default([]),
  collections: z
    .array(
      z.object({
        before: CollectionSchema,
        applied: z.string(),
        active: CollectionActiveEntrySchema.optional(),
        appliedActive: z.string(),
      }),
    )
    .default([]),
});
const fingerprint = (value: unknown): string => JSON.stringify(value) ?? "missing";

export type RepairConsequence = ChapterConsequence;

export interface PdfRepairPreview {
  articleId: string;
  /** Snapshot identity: never apply a preview against a newer work. */
  original: string;
  proposed: CanonicalArticle;
  changes: { blockIndex: number; before: string; after: string }[];
  consequences: RepairConsequence[];
  chaptersBefore: string[];
  chaptersAfter: string[];
  /** The reader's corrections re-applied to the repaired original (#78). */
  corrections: {
    reapplied: readonly Correction[];
    notApplied: readonly NotAppliedCorrection[];
  };
  /** Snapshot of the reader data apply re-stamps (corrections, positions). */
  readerData: string;
}

const structureOf = (article: CanonicalArticle) =>
  article.structure ??
  deriveWorkStructure({ ...article, provenanceTitle: article.provenance.title });

async function readerDataOf(articleId: string): Promise<string> {
  return JSON.stringify({
    corrections: await db.corrections.get(articleId),
    locations: await everyRevision(db.location, articleId).toArray(),
  });
}

/** Inside a transaction: move the saved reading position from `before` to
 * `after` (the article as the reader sees it before and after the row
 * changes), stamped with `after`'s text identity. Offsets carry unchanged
 * when only the stamp moves (repair keeps every D-05 coordinate); otherwise
 * by quote. A position that can't be matched is left as it was. */
async function restampLocation(
  articleId: string,
  original: CanonicalArticle,
  before: CanonicalArticle,
  after: CanonicalArticle,
): Promise<void> {
  const latest = await latestLocation(articleId);
  if (!latest) return;
  const offset = carriedOffset(latest, original, before, after);
  if (offset === null) return;
  const stamp: TextStamp = textStamp(after);
  await everyRevision(db.location, articleId).delete();
  const record: LocationRecord = {
    schemaVersion: 1,
    articleId,
    ...stamp,
    graphemeOffset: offset,
    savedAt: latest.savedAt,
  };
  await db.location.put(record);
}

function carriedOffset(
  location: LocationRecord,
  original: CanonicalArticle,
  before: CanonicalArticle,
  after: CanonicalArticle,
): number | null {
  const from = isSameText(location, before)
    ? before
    : isSameText(location, original)
      ? original
      : null;
  if (from === null) return null;
  // Same normalized text: the coordinates are identical (a repair alone).
  if (from === after || normalizeText(from) === normalizeText(after))
    return location.graphemeOffset;
  return carryOffset(from, after, location.graphemeOffset);
}

/** No writes. The candidate comes from explicitly processing the original PDF
 * with the current ingestion adapter, never from length-based demotion. The
 * repair changes classification only: raw runs, order, language, footnotes,
 * and all D-05 coordinates remain identical. Revision stays unchanged because
 * this operation changes structure, not the content coordinate substrate. */
export async function previewPdfRepair(
  articleId: string,
  candidate: CanonicalArticle,
): Promise<PdfRepairPreview> {
  const row = await db.articles.get(articleId);
  const article = ArticleSchema.parse(row);
  const corrected = ArticleSchema.parse(candidate);
  if (article.provenance.originalHtmlHash !== corrected.provenance.originalHtmlHash) {
    throw new PdfRepairRefusal(
      "Choose the original PDF. Its source fingerprint does not match this saved work.",
    );
  }
  if (
    article.lang !== corrected.lang ||
    JSON.stringify(article.footnotes) !== JSON.stringify(corrected.footnotes) ||
    article.blocks.length !== corrected.blocks.length
  ) {
    throw new PdfRepairRefusal(
      "The extracted text boundaries have changed. This repair cannot map them reliably; nothing was changed.",
    );
  }
  const changes: PdfRepairPreview["changes"] = [];
  const blocks = article.blocks.map((block, blockIndex) => {
    const next = corrected.blocks[blockIndex]!;
    if (
      (block.kind === "heading" || block.kind === "paragraph") &&
      (next.kind === "heading" || next.kind === "paragraph") &&
      JSON.stringify(block.content) === JSON.stringify(next.content)
    ) {
      if (
        block.kind !== next.kind ||
        (block.kind === "heading" && next.kind === "heading" && block.level !== next.level)
      ) {
        changes.push({ blockIndex, before: block.kind, after: next.kind });
      }
      return next.kind === "heading"
        ? { ...block, kind: "heading" as const, level: next.level }
        : { kind: "paragraph" as const, content: block.content };
    }
    if (JSON.stringify(block) !== JSON.stringify(next)) {
      throw new PdfRepairRefusal(
        "The extracted text has changed. Annotation correspondence cannot be guaranteed; nothing was changed.",
      );
    }
    return block;
  });
  // The repaired original's own text identity (#78): the same revision, a
  // new stamp. Set before deriving so the structure carries it too.
  const proposed = ArticleSchema.parse({
    ...article,
    blocks,
    structure: undefined,
    repairStamp: repairStampOf(blocks),
  });
  proposed.structure = deriveWorkStructure({
    ...proposed,
    provenanceTitle: proposed.provenance.title,
  });
  const readerData = await readerDataOf(articleId);
  const carry = reapplyCorrections(article, proposed, await loadCorrections(articleId));
  const oldStructure = structureOf(carry.before.article);
  const newStructure = structureOf(carry.after.article);
  const consequences = await chapterConsequences(articleId, oldStructure, newStructure);
  const chapterTitles = (structure: typeof oldStructure) =>
    structure?.destinations.filter((d) => d.kind === "chapter").map((d) => d.title) ?? [];
  return {
    articleId,
    original: JSON.stringify(row),
    proposed,
    changes,
    consequences,
    chaptersBefore: chapterTitles(oldStructure),
    chaptersAfter: chapterTitles(newStructure),
    corrections: { reapplied: carry.reapplied, notApplied: carry.notApplied },
    readerData,
  };
}

/** Apply and snapshot are a single IndexedDB transaction. A pending recovery
 * version must be recovered before another repair can replace it. */
export async function applyPdfRepair(
  preview: PdfRepairPreview,
  options: { acceptConsequences?: boolean } = {},
): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.articles,
      db.pdfRepairs,
      db.completions,
      db.collections,
      db.collectionActiveEntries,
      db.corrections,
      db.location,
    ],
    async () => {
      const row = await db.articles.get(preview.articleId);
      if (
        JSON.stringify(row) !== preview.original ||
        (await readerDataOf(preview.articleId)) !== preview.readerData
      )
        throw new PdfRepairRefusal(STALE_PREVIEW);
      if (await db.pdfRepairs.get(preview.articleId))
        throw new PdfRepairRefusal(
          "A recovery version already exists. Recover it before applying another repair.",
        );
      const fresh = await previewPdfRepair(preview.articleId, preview.proposed);
      if (JSON.stringify(fresh.proposed) !== JSON.stringify(preview.proposed))
        throw new PdfRepairRefusal("The repair preview is no longer valid.");
      if (JSON.stringify(fresh.consequences) !== JSON.stringify(preview.consequences))
        throw new PdfRepairRefusal(
          "Reader data changed after this preview. Preview again before accepting any consequences.",
        );
      if (fresh.consequences.length > 0 && options.acceptConsequences !== true)
        throw new PdfRepairRefusal(ACCEPTANCE_REQUIRED);
      if (fresh.changes.length === 0)
        throw new PdfRepairRefusal("No heading changes were found; nothing was changed.");
      const repaired = {
        ...row!,
        blocks: fresh.proposed.blocks,
        structure: fresh.proposed.structure,
        repairStamp: fresh.proposed.repairStamp,
      };
      const backup = Backup.parse({ article: row, appliedArticle: JSON.stringify(repaired) });
      for (const consequence of fresh.consequences) {
        if (consequence.kind === "completion") {
          const record = await db.completions.get(consequence.id);
          if (record) backup.completions.push(CompletionRecordSchema.parse(record));
          await db.completions.delete(consequence.id);
        }
      }
      const affectedCollections = new Set(
        fresh.consequences.flatMap((item) =>
          item.kind === "collection-entry" ? [item.collectionId] : [],
        ),
      );
      for (const id of affectedCollections) {
        const before = CollectionSchema.parse(await db.collections.get(id));
        const removed = new Set(
          fresh.consequences.flatMap((item) =>
            item.kind === "collection-entry" && item.collectionId === id ? [item.entryId] : [],
          ),
        );
        const after = {
          ...before,
          entries: before.entries.filter((entry) => !removed.has(entry.id)),
          updatedAt: new Date().toISOString(),
        };
        const active = await db.collectionActiveEntries.get(id);
        if (active && removed.has(active.entryId)) await db.collectionActiveEntries.delete(id);
        backup.collections.push({
          before,
          applied: fingerprint(after),
          active,
          appliedActive: fingerprint(await db.collectionActiveEntries.get(id)),
        });
        await db.collections.put(after);
      }
      await db.pdfRepairs.put({ articleId: preview.articleId, value: backup });
      await db.articles.put(repaired);
      const corrections = await loadCorrections(preview.articleId);
      const before = ArticleSchema.parse(row);
      const carry = reapplyCorrections(before, fresh.proposed, corrections);
      await restampLocation(preview.articleId, before, carry.before.article, carry.after.article);
    },
  );
}

export async function hasPdfRepairRecovery(articleId: string): Promise<boolean> {
  return (await db.pdfRepairs.get(articleId)) !== undefined;
}

/** Restore only state changed by repair. Later passage/annotation/metadata
 * edits remain untouched. Refuse conflicting structural/collection edits
 * rather than overwriting a reader's newer decisions. */
export async function recoverPdfRepair(articleId: string): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.articles,
      db.pdfRepairs,
      db.completions,
      db.collections,
      db.collectionActiveEntries,
      db.corrections,
      db.location,
    ],
    async () => {
      const record = await db.pdfRepairs.get(articleId);
      if (!record) throw new PdfRepairRefusal("No recovery version is available for this work.");
      const backup = Backup.parse(record.value);
      const current = await db.articles.get(articleId);
      const applied = StoredArticle.parse(JSON.parse(backup.appliedArticle));
      if (
        !current ||
        current.id !== backup.article.id ||
        fingerprint(current.blocks) !== fingerprint(applied.blocks) ||
        fingerprint(current.structure) !== fingerprint(applied.structure) ||
        current.revision !== applied.revision ||
        fingerprint(current.provenance) !== fingerprint(applied.provenance)
      ) {
        throw new PdfRepairRefusal(
          "This work's content changed after repair. Recovery cannot safely overwrite those edits; the recovery version has been kept.",
        );
      }
      for (const item of backup.collections) {
        if (
          fingerprint(await db.collections.get(item.before.id)) !== item.applied ||
          fingerprint(await db.collectionActiveEntries.get(item.before.id)) !== item.appliedActive
        ) {
          throw new PdfRepairRefusal(
            "An affected collection changed after repair. Recovery cannot overwrite those edits; the recovery version has been kept.",
          );
        }
      }
      for (const completion of backup.completions) {
        if (await db.completions.get(completion.targetKey))
          throw new PdfRepairRefusal(
            "Chapter completion changed after repair. The recovery version has been kept.",
          );
      }
      const { repairStamp: _repaired, ...unstamped } = current;
      void _repaired;
      const restored = {
        ...unstamped,
        blocks: backup.article.blocks,
        structure: backup.article.structure,
        ...(backup.article.repairStamp !== undefined
          ? { repairStamp: backup.article.repairStamp }
          : {}),
      };
      await db.articles.put(restored);
      const corrections = await loadCorrections(articleId);
      const repairedArticle = ArticleSchema.parse(current);
      const carry = reapplyCorrections(repairedArticle, ArticleSchema.parse(restored), corrections);
      await restampLocation(articleId, repairedArticle, carry.before.article, carry.after.article);
      for (const completion of backup.completions) await db.completions.put(completion);
      for (const item of backup.collections) {
        await db.collections.put(item.before);
        if (item.active) await db.collectionActiveEntries.put(item.active);
        else await db.collectionActiveEntries.delete(item.before.id);
      }
      await db.pdfRepairs.delete(articleId);
    },
  );
}
