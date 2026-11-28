// Spec #68 / issue #70 — the correction-view model for an uncorrected
// article: every block, in order, with its type in words, none hidden, and
// view coordinates equal to reading coordinates.
import { describe, expect, it } from "vitest";
import type { Block, CanonicalArticle } from "../../../src/content/types";
import { correctionViewFromArticle } from "../../../src/content/correctionView";

const run = (text: string) => [{ text, marks: [] }];

const blocks: Block[] = [
  { kind: "heading", level: 2, content: run("Chapter one") },
  { kind: "paragraph", content: run("Body text.") },
  { kind: "blockquote", children: [{ kind: "paragraph", content: run("Quoted.") }] },
  { kind: "code-block", source: "let x = 1;" },
  { kind: "figure", alt: "A photo", caption: run("Stray words") },
  { kind: "figure", alt: "Bare photo", caption: [] },
  { kind: "bulleted-list", items: [{ content: [{ kind: "paragraph", content: run("a") }] }] },
  {
    kind: "numbered-list",
    start: 1,
    items: [{ content: [{ kind: "paragraph", content: run("b") }] }],
  },
  { kind: "footnote-reference", footnoteId: "fn-1", marker: "[1]" },
  { kind: "unsupported", originalKind: "table", plainDescription: "A table was here." },
];

const article: CanonicalArticle = {
  id: "correction-view-article",
  revision: 1,
  lang: "en",
  provenance: {
    sourceUrl: "https://example.com/c",
    title: "C",
    retrievedAt: "2026-11-27T00:00:00Z",
    originalHtmlHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  },
  blocks,
  footnotes: [],
};

describe("correctionViewFromArticle", () => {
  it("lists every block in order with its type in words", () => {
    const model = correctionViewFromArticle(article);
    expect(model.article).toBe(article);
    expect(model.blocks.map((b) => b.label)).toEqual([
      "Heading 2",
      "Paragraph",
      "Quotation",
      "Code",
      "Figure with caption",
      "Figure",
      "Bulleted list",
      "Numbered list",
      "Footnote reference",
      "Unsupported content",
    ]);
    expect(model.blocks.map((b) => b.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(model.blocks.some((b) => b.hidden)).toBe(false);
  });

  it("gives each block a distinct identity", () => {
    const ids = correctionViewFromArticle(article).blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("maps reading positions to the view and back unchanged", () => {
    const model = correctionViewFromArticle(article);
    for (const offset of [0, 7, 42]) {
      expect(model.viewOffsetFor(offset)).toBe(offset);
      expect(model.readingOffsetFor(offset)).toBe(offset);
    }
  });
});
