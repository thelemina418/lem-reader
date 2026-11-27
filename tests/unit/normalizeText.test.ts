import { describe, expect, it } from "vitest";
import { ArticleSchema } from "../../src/content/schema";
import {
  BLOCK_SEPARATOR,
  footnoteRows,
  normalizeRunText,
  normalizeText,
} from "../../src/content/normalizeText";
import type { CanonicalArticle } from "../../src/content/types";

/**
 * normalizeText substrate (D-05) — one deterministic string per article revision.
 * Guards Pitfall 2 (whitespace drift), Pitfall 3 (footnote body position),
 * code-block verbatim, and idempotency.
 */

function parseArticle(raw: unknown): CanonicalArticle {
  return ArticleSchema.parse(raw);
}

const baseArticle = {
  id: "norm-test",
  revision: 1,
  lang: "en",
  provenance: {
    sourceUrl: "https://example.com/norm",
    title: "Norm Test",
    retrievedAt: "2026-01-01T00:00:00Z",
    originalHtmlHash: "sha256:deadbeef",
  },
};

// ── Idempotency ──────────────────────────────────────────────────────────────

describe("normalizeRunText idempotency", () => {
  it.each(["hello world", "  multiple   spaces  ", "\t\n tabs and newlines"])(
    "is idempotent on %j",
    (s) => {
      expect(normalizeRunText(normalizeRunText(s))).toBe(normalizeRunText(s));
    },
  );
});

describe("normalizeText idempotency", () => {
  const article = parseArticle({
    ...baseArticle,
    blocks: [{ kind: "paragraph", content: [{ text: "Hello world." }] }],
  });

  it("returns the same string on repeated calls", () => {
    expect(normalizeText(article)).toBe(normalizeText(article));
  });
});

// ── ASCII whitespace collapse (Pitfall 2) ────────────────────────────────────

describe("ASCII whitespace collapse", () => {
  it("collapses runs of ASCII whitespace in inline text to a single space", () => {
    const article = parseArticle({
      ...baseArticle,
      blocks: [
        {
          kind: "paragraph",
          content: [{ text: "  hello   world  " }],
        },
      ],
    });
    expect(normalizeText(article)).toBe("hello world");
  });

  it("does NOT collapse NBSP (\\u00A0)", () => {
    const article = parseArticle({
      ...baseArticle,
      blocks: [
        {
          kind: "paragraph",
          content: [{ text: "a\u00A0b" }],
        },
      ],
    });
    expect(normalizeText(article)).toBe("a\u00A0b");
  });

  it("does NOT collapse ZWJ (\\u200D)", () => {
    const article = parseArticle({
      ...baseArticle,
      blocks: [
        {
          kind: "paragraph",
          content: [{ text: "a\u200Db" }],
        },
      ],
    });
    expect(normalizeText(article)).toBe("a\u200Db");
  });
});

// ── Block separator (exactly one "\n" between blocks) ────────────────────────

describe("block separator", () => {
  it("joins two paragraph blocks with exactly one newline", () => {
    const article = parseArticle({
      ...baseArticle,
      blocks: [
        { kind: "paragraph", content: [{ text: "first" }] },
        { kind: "paragraph", content: [{ text: "second" }] },
      ],
    });
    const text = normalizeText(article);
    // body has blocks.length - 1 = 1 newline between the two paragraphs; no footnotes.
    const newlineCount = (text.match(/\n/g) ?? []).length;
    expect(newlineCount).toBe(1);
    expect(text).toBe("first\nsecond");
  });

  it("exports BLOCK_SEPARATOR as a single newline", () => {
    expect(BLOCK_SEPARATOR).toBe("\n");
  });
});

// ── Code-block verbatim (whitespace NOT collapsed) ───────────────────────────

describe("code-block source is verbatim", () => {
  it("preserves internal whitespace and newlines in code-block source", () => {
    const article = parseArticle({
      ...baseArticle,
      blocks: [{ kind: "code-block", source: "  indented\n  code" }],
    });
    expect(normalizeText(article)).toBe("  indented\n  code");
  });
});

// ── Footnote body position (Pitfall 3) ───────────────────────────────────────

describe("footnote body participates AFTER body blocks (Pitfall 3)", () => {
  it("footnote body text offset > footnote reference marker offset", () => {
    const article = parseArticle({
      ...baseArticle,
      blocks: [
        { kind: "paragraph", content: [{ text: "Body text with a note" }] },
        { kind: "footnote-reference", footnoteId: "fn-1", marker: "[1]" },
      ],
      footnotes: [{ id: "fn-1", content: [{ text: "Footnote body text here" }] }],
    });
    const text = normalizeText(article);
    const refOffset = text.indexOf("[1]");
    const bodyOffset = text.indexOf("Footnote body text here");
    expect(refOffset).toBeGreaterThanOrEqual(0);
    expect(bodyOffset).toBeGreaterThan(refOffset);
  });
});

describe("multi-paragraph footnote bodies (issue #59)", () => {
  const article = parseArticle({
    ...baseArticle,
    blocks: [{ kind: "paragraph", content: [{ text: "Body." }] }],
    footnotes: [
      {
        id: "fn-1",
        content: [{ text: "First  paragraph." }],
        laterParagraphs: [[{ text: "Second paragraph." }], [{ text: "Third." }]],
      },
      { id: "fn-2", content: [{ text: "Short note." }] },
    ],
  });

  it("joins a note's paragraphs with the block separator", () => {
    expect(normalizeText(article)).toBe(
      "Body.\nFirst paragraph.\nSecond paragraph.\nThird.\nShort note.",
    );
  });

  it("the note's canonical row covers all of its paragraphs", () => {
    // "First paragraph.\nSecond paragraph.\nThird." = 16 + 1 + 17 + 1 + 6
    expect(footnoteRows(article)).toEqual([
      { index: 0, start: 6, length: 41 },
      { index: 1, start: 48, length: 11 },
    ]);
  });
});

// Spec #66 review S3 (story 31) — "The marker graphemes stay in the article's
// normalized text, so ... existing highlight quotes that include a marker are
// unchanged": a footnote-ref run contributes its graphemes with no inserted
// separator where the source had none, exactly as the old flattened ingest
// ("Claim1 more.") did.
describe("footnote marker runs join their sentence without a separator", () => {
  const marker = (text: string) => ({
    text,
    marks: [{ type: "footnote-ref" as const, footnoteId: "fn-1", occurrence: 1 }],
  });
  const withRuns = (content: unknown[]) =>
    parseArticle({
      ...baseArticle,
      blocks: [{ kind: "paragraph", content }],
      footnotes: [{ id: "fn-1", content: [{ text: "A note.", marks: [] }] }],
    });

  it('pins "Claim1 more." for a marker glued to its word', () => {
    const article = withRuns([{ text: "Claim", marks: [] }, marker("1"), { text: " more.", marks: [] }]);
    expect(normalizeText(article).split(BLOCK_SEPARATOR)[0]).toBe("Claim1 more.");
  });

  it("keeps trailing punctuation glued too", () => {
    const article = withRuns([{ text: "It holds", marks: [] }, marker("2"), { text: ".", marks: [] }]);
    expect(normalizeText(article).split(BLOCK_SEPARATOR)[0]).toBe("It holds2.");
  });

  it("keeps source whitespace around a marker as one space", () => {
    const article = withRuns([{ text: "Claim ", marks: [] }, marker("[1]"), { text: "more.", marks: [] }]);
    expect(normalizeText(article).split(BLOCK_SEPARATOR)[0]).toBe("Claim [1]more.");
    const spaced = withRuns([
      { text: "Claim", marks: [] },
      { text: " ", marks: [] },
      marker("[1]"),
      { text: " more.", marks: [] },
    ]);
    expect(normalizeText(spaced).split(BLOCK_SEPARATOR)[0]).toBe("Claim [1] more.");
  });

  it("other run boundaries keep the one-space join", () => {
    const article = parseArticle({
      ...baseArticle,
      blocks: [
        {
          kind: "paragraph",
          content: [
            { text: "Plain", marks: [] },
            { text: "bold", marks: [{ type: "strong" }] },
          ],
        },
      ],
    });
    expect(normalizeText(article)).toBe("Plain bold");
  });
});
