// Spec #68 — "annotations never silently re-attach". A highlight's words
// never change under corrections (same ingest revision = same words), so on
// a corrected article whose text stamp it doesn't share it is shown only by
// an EXACT match. One whose words now span a split, merged or moved block
// boundary would match the loose prefix/suffix fallback; instead it needs
// attention (orphaned), exactly as the consequences dialog said. Highlights
// on an uncorrected article, or carried from an older revision whose words
// changed, keep the loose fallback (D5-02) unchanged.
import { describe, expect, it } from "vitest";
import { ArticleSchema, type CanonicalArticle } from "../../../src/content/schema";
import { applyCorrections, splitCorrection } from "../../../src/content/corrections/engine";
import { deriveQuoteSelector, normalizeText } from "../../../src/content/normalizeText";
import {
  resolveStoredHighlight,
  type StoredHighlightAnchor,
} from "../../../src/annotations/storedHighlight";
import { textStamp } from "../../../src/content/sameText";

const TEXT = "The ferry leaves at dawn before the fog lifts over the harbour.";

const original: CanonicalArticle = ArticleSchema.parse({
  id: "harbour",
  revision: 1,
  lang: "en",
  provenance: {
    title: "Harbour",
    retrievedAt: "2026-01-01T00:00:00.000Z",
    originalHtmlHash: "0".repeat(64),
  },
  blocks: [
    { kind: "paragraph", content: [{ text: "A short opening." }] },
    { kind: "paragraph", content: [{ text: TEXT }] },
  ],
});

function highlightOn(article: CanonicalArticle, exact: string): StoredHighlightAnchor {
  const text = normalizeText(article);
  const start = [...text.slice(0, text.indexOf(exact))].length;
  const position = { start, end: start + [...exact].length };
  const { revision, fingerprint } = textStamp(article);
  return {
    revision,
    ...(fingerprint !== undefined ? { fingerprint } : {}),
    position,
    quote: deriveQuoteSelector(article, position),
  };
}

/** Split the long paragraph between "dawn" and "before". */
function splitAtDawn() {
  const result = applyCorrections(original, []);
  const block = result.view.blocks[1]!;
  return splitCorrection(result, block, TEXT.indexOf(" before"), {
    id: "c-split",
    createdAt: "2026-11-27T10:00:00.000Z",
  })!;
}

describe("resolveStoredHighlight", () => {
  it("does not re-attach a highlight whose words now cross a split boundary", () => {
    const across = highlightOn(original, "dawn before the fog");
    const corrected = applyCorrections(original, [splitAtDawn()]).article;
    expect(resolveStoredHighlight(corrected, across)).toBe("orphan");
  });

  it("still shows a highlight wholly inside one block of the corrected article", () => {
    const inside = highlightOn(original, "lifts over the harbour");
    const corrected = applyCorrections(original, [splitAtDawn()]).article;
    const resolved = resolveStoredHighlight(corrected, inside);
    expect(typeof resolved).toBe("object");
  });

  it("keeps the loose fallback for a highlight from an older revision whose words changed", () => {
    const old = { ...highlightOn(original, "dawn before the fog"), revision: 1 };
    const edited = ArticleSchema.parse({
      ...original,
      revision: 2,
      blocks: [
        original.blocks[0],
        {
          kind: "paragraph",
          content: [{ text: TEXT.replace("before the fog", "ahead of the fog") }],
        },
      ],
    });
    // Unchanged D5-02 behaviour on an uncorrected article (no stamp involved).
    expect(resolveStoredHighlight(edited, old)).not.toBe("ambiguous");
    expect(typeof resolveStoredHighlight(edited, old)).toBe("object");
  });
});
