// Spec #68 / issue #75 — seam 2: split and merge through the corrections
// store. A merge turns a block separator ("\n") into a space and a split
// turns a space into a separator, so a highlight whose words span that
// boundary no longer matches its text exactly. Only a confident (exact,
// context-narrowed) match is carried; the loose prefix/suffix fallback
// highlights use for changed words must not quietly re-attach it, so the
// preview reports it and the consequences dialog asks first.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fakeIndexedDB, { IDBKeyRange } from "fake-indexeddb";
import { Dexie } from "dexie";
import { ArticleSchema, type Correction } from "../../../src/content/schema";
import { deriveQuoteSelector, normalizeText } from "../../../src/content/normalizeText";
import {
  applyCorrections,
  mergeCorrection,
  splitCorrection,
} from "../../../src/content/corrections/engine";

Dexie.dependencies.indexedDB = fakeIndexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;
Object.assign(globalThis, { indexedDB: fakeIndexedDB, IDBKeyRange });

const para = (text: string) => ({ kind: "paragraph" as const, content: [{ text, marks: [] }] });

const saved = ArticleSchema.parse({
  id: "broken-essay",
  revision: 1,
  lang: "en",
  provenance: {
    sourceUrl: "https://example.com/broken",
    title: "Broken",
    retrievedAt: "2026-01-01T00:00:00Z",
    originalHtmlHash: "hash",
  },
  blocks: [
    para("The ferry leaves at dawn, and the gulls"),
    para("follow it out past the breakwater. The fog lifts by noon."),
    para("Evening comes early here."),
  ],
});

function highlight(id: string, exact: string) {
  const text = normalizeText(saved);
  const at = text.indexOf(exact);
  const start = [...text.slice(0, at)].length;
  const position = { start, end: start + [...exact].length };
  return {
    schemaVersion: 1 as const,
    id,
    articleId: saved.id,
    revision: 1,
    position,
    quote: deriveQuoteSelector(saved, position),
    createdAt: "2026-01-02T00:00:00Z",
  };
}

const across = highlight("h-across", "the gulls\nfollow it");
const within = highlight("h-within", "past the breakwater");
const fog = highlight("h-fog", "breakwater. The fog");

const meta = { id: "c-1", createdAt: "2026-11-27T10:00:00.000Z" };
const view = (path: number[]) => {
  const result = applyCorrections(saved);
  return { result, block: result.view.allBlocks.find((b) => b.path.join(".") === path.join("."))! };
};

function mergeOf(path: number[]): Correction {
  const { result, block } = view(path);
  return mergeCorrection(result, block, meta)!;
}

function splitBefore(path: number[], marker: string): Correction {
  const { result, block } = view(path);
  const text = normalizeText(saved).slice(0);
  const blockText = [...text].slice(block.viewStart, block.viewEnd).join("");
  const caret = [...blockText.slice(0, blockText.indexOf(marker))].length;
  return splitCorrection(result, block, caret, meta)!;
}

async function seed() {
  const { db } = await import("../../../src/persistence/db");
  await db.articles.put(saved);
  await db.highlights.bulkPut([across, within, fog]);
  return db;
}

const store = () => import("../../../src/persistence/correctionsStore");

beforeEach(async () => {
  const { db } = await import("../../../src/persistence/db");
  await db.open();
});

afterEach(async () => {
  const { db } = await import("../../../src/persistence/db");
  await db.delete();
});

describe("merging blocks", () => {
  it("reports a highlight across the merged boundary by its words, and asks first", async () => {
    const db = await seed();
    const { previewAddCorrection, applyCorrectionsChange, ACCEPTANCE_REQUIRED } = await store();
    const before = JSON.stringify(await db.highlights.toArray());
    const preview = await previewAddCorrection(saved.id, mergeOf([0]));
    expect(preview.outcomes).toEqual([{ status: "applied" }]);
    const byId = new Map(preview.highlights.map((h) => [h.highlightId, h]));
    expect(byId.get("h-across")).toEqual({
      highlightId: "h-across",
      exact: "the gulls\nfollow it",
      outcome: "crosses", // its words are all there; only the boundary moved
    });
    expect(byId.get("h-within")?.outcome).toBe("confident");
    expect(preview.clean).toBe(false);
    await expect(applyCorrectionsChange(preview)).rejects.toThrow(ACCEPTANCE_REQUIRED);
    expect(await db.corrections.count()).toBe(0);
    expect(JSON.stringify(await db.highlights.toArray())).toBe(before);
  });

  it("applies once accepted, re-anchoring only the highlights it can place with confidence", async () => {
    const db = await seed();
    const { previewAddCorrection, applyCorrectionsChange } = await store();
    const preview = await previewAddCorrection(saved.id, mergeOf([0]));
    await applyCorrectionsChange(preview, { acceptConsequences: true });
    expect((await db.highlights.get("h-across"))!.position).toEqual(across.position);
    const text = normalizeText(preview.proposed);
    const start = [...text.slice(0, text.indexOf("past the breakwater"))].length;
    expect((await db.highlights.get("h-within"))!.position).toEqual({
      start,
      end: start + [..."past the breakwater"].length,
    });
  });

  it("applies at once when no highlight crosses the boundary", async () => {
    const { db } = await import("../../../src/persistence/db");
    await db.articles.put(saved);
    await db.highlights.put(within);
    const { previewAddCorrection } = await store();
    const preview = await previewAddCorrection(saved.id, mergeOf([0]));
    expect(preview.clean).toBe(true);
  });
});

describe("splitting a block", () => {
  it("reports a highlight across the new boundary, and keeps the others", async () => {
    await seed();
    const { previewAddCorrection } = await store();
    const preview = await previewAddCorrection(saved.id, splitBefore([1], "The fog"));
    expect(normalizeText(preview.proposed)).toContain("breakwater.\nThe fog");
    const byId = new Map(preview.highlights.map((h) => [h.highlightId, h.outcome]));
    expect(byId.get("h-fog")).toBe("crosses");
    expect(byId.get("h-within")).toBe("confident");
    expect(preview.clean).toBe(false);
  });
});
