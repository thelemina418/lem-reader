// Reprocessing an uploaded article (#64, spec #66 Seam 3): the reader
// chooses the original file again; it must match the fingerprint saved when
// the article was added. Observed through the operation's public interface
// plus what the library holds afterwards.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fakeIndexedDB, { IDBKeyRange } from "fake-indexeddb";
import { Dexie } from "dexie";
import { ArticleSchema, type CanonicalArticle } from "../../../src/content/schema";
import type { IngestionSuccess } from "../../../src/ingestion/IngestionClient";

Dexie.dependencies.indexedDB = fakeIndexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;
Object.assign(globalThis, { indexedDB: fakeIndexedDB, IDBKeyRange });

const para = (text: string) => ({ kind: "paragraph" as const, content: [{ text, marks: [] }] });

const saved = ArticleSchema.parse({
  id: "md-notes-0123456789ab",
  revision: 1,
  lang: "en",
  provenance: {
    title: "Notes",
    retrievedAt: "2026-01-01T00:00:00Z",
    originalHtmlHash: "sha256:original-bytes",
  },
  blocks: [para("A claim1 with a flattened marker."), para("1. The note, as a paragraph.")],
  ingestionMeta: {
    source: "markdown",
    origin: "upload",
    originalHtmlHash: "sha256:original-bytes",
    extractionConfidence: "high",
  },
  tags: ["mine"],
  addedAt: "2026-01-01T00:00:00Z",
});

function ingested(hash: string): IngestionSuccess {
  const article: CanonicalArticle = ArticleSchema.parse({
    ...saved,
    tags: undefined,
    addedAt: undefined,
    provenance: {
      ...saved.provenance,
      retrievedAt: "2026-11-27T00:00:00Z",
      originalHtmlHash: hash,
    },
    ingestionMeta: { ...saved.ingestionMeta, originalHtmlHash: hash },
    blocks: [para("A claim with a linked marker.")],
  });
  return { article, confidence: { state: "confident" }, assets: [] };
}

const file = (name: string) => new File(["# Notes"], name);

beforeEach(async () => {
  const { db } = await import("../../../src/persistence/db");
  await db.open();
  await db.articles.put(saved);
});

afterEach(async () => {
  const { db } = await import("../../../src/persistence/db");
  await db.delete();
});

describe("reprocessing an uploaded article", () => {
  it("processes the re-chosen original file with the article's own format and previews it", async () => {
    const { previewUploadReprocess, applyReprocess } =
      await import("../../../src/persistence/reprocessStore");
    const { db } = await import("../../../src/persistence/db");
    const seen: string[] = [];
    const preview = await previewUploadReprocess(saved.id, file("notes.md"), async (f, source) => {
      seen.push(`${source}:${f.name}`);
      return ingested("sha256:original-bytes");
    });
    expect(seen).toEqual(["markdown:notes.md"]);
    expect(preview.sourceChanged).toBe(false);
    expect(preview.proposed.revision).toBe(2);
    expect(ArticleSchema.parse(await db.articles.get(saved.id))).toEqual(saved);

    await applyReprocess(preview);
    const after = ArticleSchema.parse(await db.articles.get(saved.id));
    expect(after.blocks).toEqual([para("A claim with a linked marker.")]);
    expect(after.tags).toEqual(["mine"]);
  });

  it("refuses a file that is not the original, calmly, and changes nothing", async () => {
    const { previewUploadReprocess, ReprocessRefusal } =
      await import("../../../src/persistence/reprocessStore");
    const { db } = await import("../../../src/persistence/db");
    const attempt = previewUploadReprocess(saved.id, file("other.md"), async () =>
      ingested("sha256:different-bytes"),
    );
    await expect(attempt).rejects.toBeInstanceOf(ReprocessRefusal);
    await expect(attempt).rejects.toThrow(/not the original file.*nothing was changed/i);
    expect(ArticleSchema.parse(await db.articles.get(saved.id))).toEqual(saved);
  });

  it("refuses a URL article: it is reprocessed by fetching its address", async () => {
    const { previewUploadReprocess, ReprocessRefusal } =
      await import("../../../src/persistence/reprocessStore");
    const { db } = await import("../../../src/persistence/db");
    await db.articles.put({
      ...saved,
      ingestionMeta: { ...saved.ingestionMeta!, source: "url", origin: "url" },
    });
    await expect(
      previewUploadReprocess(saved.id, file("notes.md"), async () =>
        ingested("sha256:original-bytes"),
      ),
    ).rejects.toBeInstanceOf(ReprocessRefusal);
  });

  // Spec #66 review S7 — "PDF ingestion is unchanged": PDF articles keep
  // their own repair flow and are not offered reprocessing.
  it("does not offer reprocessing for a PDF article", async () => {
    const { isUploadSource, previewUploadReprocess, ReprocessRefusal } =
      await import("../../../src/persistence/reprocessStore");
    const { db } = await import("../../../src/persistence/db");
    expect(isUploadSource("pdf")).toBe(false);
    await db.articles.put({
      ...saved,
      ingestionMeta: { ...saved.ingestionMeta!, source: "pdf", origin: "upload" },
    });
    await expect(
      previewUploadReprocess(saved.id, file("paper.pdf"), async () =>
        ingested("sha256:original-bytes"),
      ),
    ).rejects.toBeInstanceOf(ReprocessRefusal);
  });
});
