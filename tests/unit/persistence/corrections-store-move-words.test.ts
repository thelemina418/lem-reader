// Spec #68 / issue #73 — seam 2 for moving words: a highlight that spans the
// moved block boundary would no longer match, so the preview reports it (the
// consequences dialog); a highlight wholly inside the moved words still
// matches and is re-anchored onto the corrected text on apply.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fakeIndexedDB, { IDBKeyRange } from "fake-indexeddb";
import { Dexie } from "dexie";
import { ArticleSchema } from "../../../src/content/schema";
import { deriveQuoteSelector, normalizeText } from "../../../src/content/normalizeText";
import { applyCorrections } from "../../../src/content/corrections/engine";
import { selectionCommands } from "../../../src/content/corrections/moveWords";

Dexie.dependencies.indexedDB = fakeIndexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;
Object.assign(globalThis, { indexedDB: fakeIndexedDB, IDBKeyRange });

const STRAY = "The mayor said the ferry would keep running";
const saved = ArticleSchema.parse({
  id: "harbour-caption",
  revision: 1,
  lang: "en",
  provenance: {
    sourceUrl: "https://example.com/harbour",
    title: "The harbour",
    retrievedAt: "2026-01-01T00:00:00Z",
    originalHtmlHash: "hash",
  },
  blocks: [
    {
      kind: "figure",
      alt: "",
      src: "https://example.com/harbour.jpg",
      caption: [{ text: `The harbour at dawn. Photo: Ana Ruiz. ${STRAY}`, marks: [] }],
    },
    { kind: "paragraph", content: [{ text: "through the winter.", marks: [] }] },
  ],
});

function highlight(id: string, exact: string) {
  const text = normalizeText(saved);
  const at = text.indexOf(exact);
  if (at < 0) throw new Error(exact);
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

function moveStrayToNext() {
  const result = applyCorrections(saved, []);
  const text = normalizeText(saved);
  const start = [...text.slice(0, text.indexOf(STRAY))].length;
  const cmds = selectionCommands(
    result,
    { start, end: start + STRAY.length },
    { id: "move-1", createdAt: "2026-11-27T10:00:00.000Z" },
  );
  return cmds.commands.find((c) => c.kind === "move-next")!.correction!;
}

beforeEach(async () => {
  const { db } = await import("../../../src/persistence/db");
  await db.open();
});

afterEach(async () => {
  const { db } = await import("../../../src/persistence/db");
  await db.delete();
});

describe("moving words with highlights nearby", () => {
  it("reports a highlight across the moved boundary; one inside the moved words still matches", async () => {
    const { db } = await import("../../../src/persistence/db");
    const { previewAddCorrection, applyCorrectionsChange } =
      await import("../../../src/persistence/correctionsStore");
    await db.articles.put(saved);
    await db.highlights.bulkPut([
      highlight("h-across", "Ana Ruiz. The mayor"),
      highlight("h-inside", "mayor said the ferry"),
    ]);

    const preview = await previewAddCorrection(saved.id, moveStrayToNext());
    expect(preview.outcomes).toEqual([{ status: "applied" }]);
    const outcomes = Object.fromEntries(preview.highlights.map((h) => [h.highlightId, h.outcome]));
    expect(outcomes["h-inside"]).toBe("confident");
    expect(outcomes["h-across"]).not.toBe("confident");
    expect(preview.clean).toBe(false);

    await applyCorrectionsChange(preview, { acceptConsequences: true });
    const inside = await db.highlights.get("h-inside");
    const text = normalizeText(preview.proposed);
    expect(text).toBe(`The harbour at dawn. Photo: Ana Ruiz.\n${STRAY} through the winter.`);
    const start = [...text.slice(0, text.indexOf("mayor said the ferry"))].length;
    expect(inside!.position).toEqual({ start, end: start + "mayor said the ferry".length });
    // The across highlight is never rewritten (it is what the dialog named).
    expect((await db.highlights.get("h-across"))!.position).toEqual(
      highlight("h-across", "Ana Ruiz. The mayor").position,
    );
  });
});
