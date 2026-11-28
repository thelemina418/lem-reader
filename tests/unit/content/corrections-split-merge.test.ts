// Spec #68 / issue #75 — seam 1: the correction engine's split and merge.
// Original article + ordered corrections in → corrected article out.
//
// Guarantees pinned here: split produces two blocks of the same type at a
// word boundary (a space becomes a block separator); merge joins the text
// with a single space and takes the first block's type; marks travel with
// their words; the words never change (only separators move); each kind's
// validity reasons come from the engine; targets are found by text, so a
// split or merge re-applies after earlier blocks change and is not applied
// once its text (or the block merged into it) is gone; hidden blocks stay
// hidden as split and merge shift the blocks around them.

import { describe, expect, it } from "vitest";
import type { Block, CanonicalArticle, InlineRun } from "../../../src/content/types";
import { ArticleSchema, type Correction } from "../../../src/content/schema";
import {
  applyCorrections,
  blockCorrection,
  mergeAvailability,
  mergeCorrection,
  splitAvailability,
  splitCorrection,
  type CorrectionsResult,
} from "../../../src/content/corrections/engine";
import { SPLIT_MERGE_REASONS as R } from "../../../src/content/corrections/splitMerge";
import { normalizeText } from "../../../src/content/normalizeText";

const run = (text: string, marks: InlineRun["marks"] = []): InlineRun => ({ text, marks });
const paragraph = (...content: (string | InlineRun)[]): Block => ({
  kind: "paragraph",
  content: content.map((c) => (typeof c === "string" ? run(c) : c)),
});
const heading = (level: 2 | 3, text: string): Block => ({
  kind: "heading",
  level,
  content: [run(text)],
});
const figure = (alt: string, caption: string): Block => ({
  kind: "figure",
  alt,
  src: "https://example.com/a.jpg",
  caption: caption ? [run(caption)] : [],
});

const makeArticle = (
  blocks: Block[],
  overrides: Partial<CanonicalArticle> = {},
): CanonicalArticle =>
  ArticleSchema.parse({
    id: "split-merge-article",
    revision: 1,
    lang: "en",
    provenance: {
      sourceUrl: "https://example.com/split-merge",
      title: "Split and merge",
      retrievedAt: "2026-11-27T00:00:00Z",
      originalHtmlHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    blocks,
    footnotes: [],
    ...overrides,
  });

// Real mistakes: two paragraphs run together, and one broken mid-sentence.
const runTogether = () =>
  makeArticle([
    heading(2, "The harbour"),
    paragraph("The ferry leaves at dawn. Gulls follow it out past the breakwater."),
    paragraph("The fog lifts by noon."),
  ]);
const brokenMidSentence = () =>
  makeArticle([
    heading(2, "The harbour"),
    paragraph("The ferry leaves at dawn, and the gulls"),
    paragraph("follow it out past the breakwater."),
    paragraph("The fog lifts by noon."),
  ]);

let seq = 0;
const meta = () => ({ id: `c-${++seq}`, createdAt: "2026-11-27T10:00:00.000Z" });

const viewBlock = (result: CorrectionsResult, path: number[]) =>
  result.view.allBlocks.find((b) => b.path.join(".") === path.join("."))!;

/** The intra-block caret offset just before `marker`'s first occurrence. */
function caretBefore(result: CorrectionsResult, path: number[], marker: string): number {
  const block = viewBlock(result, path);
  const text = [...normalizeText(result.view.article)].slice(block.viewStart, block.viewEnd);
  const at = text.join("").indexOf(marker);
  if (at < 0) throw new Error(`no "${marker}" in block ${path.join(".")}`);
  return [...text.join("").slice(0, at)].length;
}

function split(
  article: CanonicalArticle,
  path: number[],
  marker: string,
  corrections: Correction[] = [],
): Correction {
  const result = applyCorrections(article, corrections);
  const correction = splitCorrection(
    result,
    viewBlock(result, path),
    caretBefore(result, path, marker),
    meta(),
  );
  if (!correction) throw new Error("split unavailable");
  return correction;
}

function merge(article: CanonicalArticle, path: number[], corrections: Correction[] = []) {
  const result = applyCorrections(article, corrections);
  const correction = mergeCorrection(result, viewBlock(result, path), meta());
  if (!correction) throw new Error("merge unavailable");
  return correction;
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).sort();

describe("split", () => {
  it("makes two paragraphs run together two again, at the caret", () => {
    const article = runTogether();
    const result = applyCorrections(article, [split(article, [1], "Gulls")]);
    expect(result.outcomes).toEqual([{ status: "applied" }]);
    expect(result.article.blocks).toEqual([
      heading(2, "The harbour"),
      paragraph("The ferry leaves at dawn."),
      paragraph("Gulls follow it out past the breakwater."),
      paragraph("The fog lifts by noon."),
    ]);
    expect(ArticleSchema.safeParse(result.article).success).toBe(true);
  });

  it("turns the space at the caret into a block boundary and changes no word", () => {
    const article = runTogether();
    const corrected = applyCorrections(article, [split(article, [1], "Gulls")]).article;
    expect(normalizeText(corrected)).toBe(
      normalizeText(article).replace("dawn. Gulls", "dawn.\nGulls"),
    );
    expect(words(normalizeText(corrected))).toEqual(words(normalizeText(article)));
  });

  it("accepts the caret on either side of the space between two words", () => {
    const article = runTogether();
    const result = applyCorrections(article);
    const afterSpace = caretBefore(result, [1], "Gulls");
    const a = splitCorrection(result, viewBlock(result, [1]), afterSpace, meta())!;
    const b = splitCorrection(result, viewBlock(result, [1]), afterSpace - 1, meta())!;
    expect(applyCorrections(article, [a]).article.blocks).toEqual(
      applyCorrections(article, [b]).article.blocks,
    );
  });

  it("keeps marks on both halves, including a run cut in two", () => {
    const article = makeArticle([
      paragraph(
        run("A link "),
        run("to the harbour office", [{ type: "link", href: "https://example.com/office" }]),
        run(" and "),
        run("strong words here", [{ type: "strong" }]),
      ),
    ]);
    const result = applyCorrections(article, [split(article, [0], "words")]);
    expect(result.article.blocks).toEqual([
      paragraph(
        run("A link "),
        run("to the harbour office", [{ type: "link", href: "https://example.com/office" }]),
        run(" and "),
        run("strong", [{ type: "strong" }]),
      ),
      paragraph(run("words here", [{ type: "strong" }])),
    ]);
  });

  it("keeps a footnote reference with its words", () => {
    const article = makeArticle(
      [
        paragraph(
          run("The tide turns"),
          run("1", [{ type: "footnote-ref", footnoteId: "fn-1", occurrence: 1 }]),
          run(" twice a day. Ships wait for it."),
        ),
      ],
      { footnotes: [{ id: "fn-1", content: [run("Tide tables, 1902.")] }] },
    );
    const result = applyCorrections(article, [split(article, [0], "Ships")]);
    expect(result.outcomes).toEqual([{ status: "applied" }]);
    const [first] = result.article.blocks;
    expect(first).toEqual(
      paragraph(
        run("The tide turns"),
        run("1", [{ type: "footnote-ref", footnoteId: "fn-1", occurrence: 1 }]),
        run(" twice a day."),
      ),
    );
    expect(normalizeText(result.article)).toContain("The tide turns1 twice a day.\nShips");
  });

  it("splits a heading into two headings of the same level", () => {
    const article = makeArticle([heading(3, "Chapter one The harbour"), paragraph("Body.")]);
    const result = applyCorrections(article, [split(article, [0], "The harbour")]);
    expect(result.article.blocks.slice(0, 2)).toEqual([
      { kind: "heading", level: 3, content: [run("Chapter one")] },
      { kind: "heading", level: 3, content: [run("The harbour")] },
    ]);
  });

  it("splits a code block between lines, leaving the text exactly as it was", () => {
    const article = makeArticle([
      { kind: "code-block", source: "let a = 1;\nlet b = 2;" },
      paragraph("After."),
    ]);
    const result = applyCorrections(article, [split(article, [0], "let b")]);
    expect(result.article.blocks.slice(0, 2)).toEqual([
      { kind: "code-block", source: "let a = 1;" },
      { kind: "code-block", source: "let b = 2;" },
    ]);
    expect(normalizeText(result.article)).toBe(normalizeText(article));
  });

  it("splits a paragraph inside a quotation, keeping the quotation", () => {
    const article = makeArticle([
      paragraph("Before."),
      { kind: "blockquote", children: [paragraph("One said this. Another said that.")] },
    ]);
    const result = applyCorrections(article, [split(article, [1, 0], "Another")]);
    expect(result.article.blocks[1]).toEqual({
      kind: "blockquote",
      children: [paragraph("One said this."), paragraph("Another said that.")],
    });
  });
});

describe("merge", () => {
  it("makes a paragraph broken mid-sentence whole, joined with a single space", () => {
    const article = brokenMidSentence();
    const result = applyCorrections(article, [merge(article, [1])]);
    expect(result.outcomes).toEqual([{ status: "applied" }]);
    expect(result.article.blocks).toHaveLength(3);
    expect(normalizeText(result.article)).toBe(
      normalizeText(article).replace("the gulls\nfollow", "the gulls follow"),
    );
    expect(words(normalizeText(result.article))).toEqual(words(normalizeText(article)));
    expect(ArticleSchema.safeParse(result.article).success).toBe(true);
  });

  it("takes the first block's type", () => {
    const article = makeArticle([heading(2, "The harbour"), paragraph("at dawn"), paragraph("x")]);
    const result = applyCorrections(article, [merge(article, [0])]);
    expect(result.article.blocks[0]).toMatchObject({ kind: "heading", level: 2 });
    expect(normalizeText(result.article).split("\n")[0]).toBe("The harbour at dawn");
  });

  it("keeps marks, and still joins with a space when the next block starts with a footnote reference", () => {
    const ref = run("2", [{ type: "footnote-ref", footnoteId: "fn-2", occurrence: 1 }]);
    const article = makeArticle(
      [
        paragraph(run("Broken ", []), run("here", [{ type: "em" }])),
        paragraph(ref, run(" and continued.")),
        paragraph("Last."),
      ],
      { footnotes: [{ id: "fn-2", content: [run("A note.")] }] },
    );
    const result = applyCorrections(article, [merge(article, [0])]);
    const merged = result.article.blocks[0]!;
    expect(merged.kind).toBe("paragraph");
    const content = merged.kind === "paragraph" ? merged.content : [];
    expect(content.filter((r) => r.text.trim()).map((r) => r.marks)).toEqual([
      [],
      [{ type: "em" }],
      [{ type: "footnote-ref", footnoteId: "fn-2", occurrence: 1 }],
      [],
    ]);
    expect(normalizeText(result.article).split("\n")[0]).toBe("Broken here 2 and continued.");
  });

  it("merges two paragraphs inside a quotation", () => {
    const article = makeArticle([
      paragraph("Before."),
      { kind: "blockquote", children: [paragraph("One said"), paragraph("this.")] },
    ]);
    const result = applyCorrections(article, [merge(article, [1, 0])]);
    expect(result.article.blocks[1]).toEqual({
      kind: "blockquote",
      children: [paragraph(run("One said"), run(" "), run("this."))],
    });
  });

  it("undoes a split: split then merge reads exactly as the original", () => {
    const article = runTogether();
    const s = split(article, [1], "Gulls");
    const m = merge(article, [1], [s]);
    const result = applyCorrections(article, [s, m]);
    expect(result.outcomes).toEqual([{ status: "applied" }, { status: "applied" }]);
    expect(normalizeText(result.article)).toBe(normalizeText(article));
  });
});

describe("validity reasons (one place for 'unavailable' and 'not applied')", () => {
  const mixed = () =>
    makeArticle([
      paragraph("Opening words here."),
      figure("A ferry", "The ferry at dawn"),
      paragraph("Before the list."),
      { kind: "bulleted-list", items: [{ content: [paragraph("Item one")] }] },
      { kind: "blockquote", children: [paragraph("Quoted line"), paragraph("Second line")] },
      paragraph("Closing words."),
    ]);

  it("can't split a figure, a list or a whole quotation", () => {
    const result = applyCorrections(mixed());
    expect(splitAvailability(result, viewBlock(result, [1]), 2)).toEqual({
      available: false,
      reason: R.splitKind,
    });
    expect(splitAvailability(result, viewBlock(result, [3]), 2)).toEqual({
      available: false,
      reason: R.splitKind,
    });
    expect(splitAvailability(result, viewBlock(result, [4]), 2)).toEqual({
      available: false,
      reason: R.splitQuotation,
    });
  });

  it("needs a caret between two words", () => {
    const result = applyCorrections(mixed());
    const block = viewBlock(result, [0]);
    expect(splitAvailability(result, block, null)).toEqual({
      available: false,
      reason: R.splitNoCaret,
    });
    expect(splitAvailability(result, block, 0)).toEqual({ available: false, reason: R.splitEdge });
    expect(splitAvailability(result, block, 3)).toEqual({
      available: false,
      reason: R.splitMidWord,
    });
    expect(splitAvailability(result, block, caretBefore(result, [0], "words"))).toEqual({
      available: true,
    });
  });

  it("splits a code block only between lines", () => {
    const article = makeArticle([{ kind: "code-block", source: "let a = 1;\nlet b;" }]);
    const result = applyCorrections(article);
    expect(splitAvailability(result, viewBlock(result, [0]), 4)).toEqual({
      available: false,
      reason: R.splitCodeLine,
    });
  });

  it("can't merge across a figure, into a list, or past the end", () => {
    const result = applyCorrections(mixed());
    expect(mergeAvailability(result, viewBlock(result, [0]))).toEqual({
      available: false,
      reason: R.mergeNextKind("figure"),
    });
    expect(mergeAvailability(result, viewBlock(result, [1]))).toEqual({
      available: false,
      reason: R.mergeKind,
    });
    expect(mergeAvailability(result, viewBlock(result, [2]))).toEqual({
      available: false,
      reason: R.mergeNextKind("list"),
    });
    expect(mergeAvailability(result, viewBlock(result, [4, 1]))).toEqual({
      available: false,
      reason: R.mergeNothingNext,
    });
    expect(mergeAvailability(result, viewBlock(result, [5]))).toEqual({
      available: false,
      reason: R.mergeNothingNext,
    });
    expect(mergeAvailability(result, viewBlock(result, [4, 0]))).toEqual({ available: true });
  });

  it("won't split or merge a hidden block, or merge into one", () => {
    const article = brokenMidSentence();
    const before = applyCorrections(article);
    const hide = blockCorrection("hide", before, viewBlock(before, [2]), meta())!;
    const result = applyCorrections(article, [hide]);
    expect(mergeAvailability(result, viewBlock(result, [1]))).toEqual({
      available: false,
      reason: R.mergeNextHidden,
    });
    expect(mergeAvailability(result, viewBlock(result, [2]))).toEqual({
      available: false,
      reason: R.hiddenBlock,
    });
    expect(splitAvailability(result, viewBlock(result, [2]), 6)).toEqual({
      available: false,
      reason: R.hiddenBlock,
    });
  });
});

describe("targets are found by text", () => {
  it("re-applies a split after earlier blocks change", () => {
    const article = runTogether();
    const s = split(article, [1], "Gulls");
    const reprocessed = makeArticle([paragraph("A new standfirst."), ...article.blocks]);
    const result = applyCorrections(reprocessed, [s]);
    expect(result.outcomes).toEqual([{ status: "applied" }]);
    expect(normalizeText(result.article)).toContain("at dawn.\nGulls follow");
  });

  it("is not applied when the block's text has changed", () => {
    const article = runTogether();
    const s = split(article, [1], "Gulls");
    const reprocessed = makeArticle([
      article.blocks[0]!,
      paragraph("The ferry leaves at six. Gulls follow it out past the breakwater."),
      article.blocks[2]!,
    ]);
    expect(applyCorrections(reprocessed, [s]).outcomes).toEqual([
      { status: "not-applied", reason: "Its text is no longer in this article." },
    ]);
  });

  it("is not applied when the block a merge joined has changed", () => {
    const article = brokenMidSentence();
    const m = merge(article, [1]);
    const reprocessed = makeArticle([
      article.blocks[0]!,
      article.blocks[1]!,
      paragraph("A pull quote now sits here."),
      article.blocks[2]!,
    ]);
    const result = applyCorrections(reprocessed, [m]);
    expect(result.outcomes).toEqual([{ status: "not-applied", reason: R.mergeNextChanged }]);
    expect(result.article).toBe(reprocessed);
  });

  it("keeps later hidden blocks hidden as blocks shift around them", () => {
    const article = makeArticle([
      paragraph("First part. Second part."),
      paragraph("Broken"),
      paragraph("sentence."),
      paragraph("Share this article"),
      paragraph("The end."),
    ]);
    const base = applyCorrections(article);
    const hide = blockCorrection("hide", base, viewBlock(base, [3]), meta())!;
    const s = split(article, [0], "Second", [hide]);
    const m = merge(article, [2], [hide, s]);
    const result = applyCorrections(article, [hide, s, m]);
    expect(result.outcomes.every((o) => o.status === "applied")).toBe(true);
    expect(normalizeText(result.article)).toBe(
      "First part.\nSecond part.\nBroken sentence.\nThe end.",
    );
    const hidden = result.view.allBlocks.filter((b) => b.hidden);
    expect(hidden.map((b) => b.path)).toEqual([[3]]);
  });

  it("preserves the words for every possible split and merge", () => {
    const article = makeArticle([
      paragraph(run("One "), run("two three", [{ type: "em" }]), run(" four")),
      paragraph("five six"),
      heading(2, "seven eight"),
    ]);
    const base = applyCorrections(article);
    const original = words(normalizeText(article));
    for (const block of base.view.allBlocks) {
      for (let caret = 0; caret <= block.viewEnd - block.viewStart; caret++) {
        const c = splitCorrection(base, block, caret, meta());
        if (!c) continue;
        const after = applyCorrections(article, [c]);
        expect(after.outcomes).toEqual([{ status: "applied" }]);
        expect(words(normalizeText(after.article))).toEqual(original);
      }
      const c = mergeCorrection(base, block, meta());
      if (c) expect(words(normalizeText(applyCorrections(article, [c]).article))).toEqual(original);
    }
  });
});
