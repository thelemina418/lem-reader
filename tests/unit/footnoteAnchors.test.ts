import { describe, expect, it } from "vitest";
import { ArticleSchema } from "../../src/content/schema";
import type { Block } from "../../src/content/types";
import { articleGraphemeIndex, footnoteRows } from "../../src/content/normalizeText";
import { footnoteAnchorOffset } from "../../src/reader/footnoteAnchors";

const reference: Block = { kind: "footnote-reference", footnoteId: "fn-1", marker: "[1]" };
const prose: Block = {
  kind: "paragraph",
  content: [
    { text: "  Earlier 👩‍👩‍👧‍👦 prose  ", marks: [] },
    { text: "e\u0301", marks: [] },
  ],
};

function articleWith(block: Block) {
  return ArticleSchema.parse({
    id: "footnote-anchor",
    revision: 1,
    lang: "en",
    provenance: {
      title: "Footnote navigation",
      retrievedAt: "2026-01-01T00:00:00Z",
      originalHtmlHash: "footnote-anchor-v1",
    },
    blocks: [prose, block],
    footnotes: [
      { id: "fn-1", content: [{ text: "The note body.", marks: [] }] },
      { id: "fn-2", content: [{ text: "  ", marks: [] }] },
    ],
  });
}

describe("footnote anchor destinations", () => {
  it("resolves notes and top-level references in canonical graphemes", () => {
    const article = articleWith(reference);
    expect(footnoteAnchorOffset(article, "#fn-1")).toBe(footnoteRows(article)[0]!.start);
    expect(footnoteAnchorOffset(article, "#fn-ref-1")).toBe(
      articleGraphemeIndex(article).blockStartOffsets[1],
    );
  });

  it.each(["blockquote", "bulleted-list", "numbered-list"] as const)(
    "finds the precise nested destination in %s, including empty item separators",
    (kind) => {
      const children: Block[] = [prose, { kind: "blockquote", children: [prose, reference] }];
      const container: Block =
        kind === "blockquote"
          ? { kind, children }
          : kind === "numbered-list"
            ? {
                kind,
                start: 4,
                items: [{ content: [] }, { content: [prose] }, { content: children }],
              }
            : { kind, items: [{ content: [] }, { content: [prose] }, { content: children }] };
      const article = articleWith(container);
      const index = articleGraphemeIndex(article);
      const expected = index.clusters.indexOf("[");
      expect(expected).toBeGreaterThan(index.blockStartOffsets[1]!);
      expect(footnoteAnchorOffset(article, "#fn-ref-1")).toBe(expected);
      expect(index.clusters.slice(expected, expected + 3).join("")).toBe("[1]");
    },
  );

  it("does not invent destinations for missing references, unknown IDs, or empty notes", () => {
    const article = articleWith(reference);
    for (const href of ["#fn-2", "#fn-99", "#fn-ref-2", "#fn-ref-99", "#main", "#fn-1-extra"]) {
      expect(footnoteAnchorOffset(article, href)).toBeNull();
    }
  });
});

// ── Inline footnote references (spec #66 / issue #55) ────────────────────────

function inlineRef(occurrence: number, marker = "1") {
  return {
    text: marker,
    marks: [{ type: "footnote-ref" as const, footnoteId: "fn-1", occurrence }],
  };
}

/** A paragraph citing fn-1 twice, after awkward whitespace and a grapheme
 * cluster, so the run → stream mapping is exercised (runs join with a space
 * in the D-05 stream). */
const citing: Block = {
  kind: "paragraph",
  content: [
    { text: "  The 👩‍👩‍👧‍👦 claim", marks: [] },
    inlineRef(1, "[1]"),
    { text: " holds, and again", marks: [{ type: "em" }] },
    inlineRef(2, "[1]"),
    { text: ".", marks: [] },
  ],
};

describe("inline footnote reference destinations (issue #55)", () => {
  it("resolves each occurrence to its own marker in the canonical stream", () => {
    const article = articleWith(citing);
    const index = articleGraphemeIndex(article);
    const text = index.clusters.join("");
    const first = footnoteAnchorOffset(article, "#fn-ref-1");
    const second = footnoteAnchorOffset(article, "#fn-ref-1-2");
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(index.clusters.slice(first!, first! + 3).join("")).toBe("[1]");
    expect(index.clusters.slice(second!, second! + 3).join("")).toBe("[1]");
    expect(second!).toBeGreaterThan(first!);
    // Known-good literal: the paragraph stream is "The 👩‍👩‍👧‍👦 claim [1] holds, and again [1] ."
    expect(text).toContain("The 👩‍👩‍👧‍👦 claim [1] holds, and again [1] .");
    expect(first! - index.blockStartOffsets[1]!).toBe("The X claim ".length);
  });

  it.each(["blockquote", "bulleted-list"] as const)(
    "finds an inline reference nested in %s",
    (kind) => {
      const children: Block[] = [prose, citing];
      const container: Block =
        kind === "blockquote"
          ? { kind, children }
          : { kind, items: [{ content: [] }, { content: children }] };
      const article = articleWith(container);
      const index = articleGraphemeIndex(article);
      const offset = footnoteAnchorOffset(article, "#fn-ref-1");
      expect(offset).toBe(index.clusters.indexOf("["));
    },
  );

  it("an occurrence that does not exist has no destination", () => {
    const article = articleWith(citing);
    for (const href of ["#fn-ref-1-3", "#fn-ref-1-1", "#fn-ref-1-0"]) {
      expect(footnoteAnchorOffset(article, href)).toBeNull();
    }
  });
});
