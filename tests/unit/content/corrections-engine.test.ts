// Spec #68 / issue #71 — seam 1: the correction engine
// (src/content/corrections/engine.ts). Original article + ordered corrections
// in → corrected article (hidden blocks absent), correction-view model
// (hidden blocks present and marked), one outcome per correction.
//
// Guarantees pinned here: hide / unhide, ordered application, targets found
// by TEXT (never by index alone), not-applied reasons for targets that no
// longer fit, a valid canonical article out, view ↔ reading offset maps that
// agree with the corrected article's own index, and the byte-identical
// pass-through for an article with no corrections.

import { describe, expect, it } from "vitest";
import type { Block, CanonicalArticle } from "../../../src/content/types";
import { ArticleSchema, type Correction } from "../../../src/content/schema";
import {
  applyCorrections,
  blockCorrection,
  blockTargetFor,
  hideAvailability,
  unhideAvailability,
  REASONS,
} from "../../../src/content/corrections/engine";
import {
  articleGraphemeIndex,
  mainTextLength,
  normalizeText,
} from "../../../src/content/normalizeText";
import { isSameText, textStamp } from "../../../src/content/sameText";
import { resolveWorkStructure } from "../../../src/content/chapterTargets";
import { deriveWorkStructure } from "../../../src/content/structure";

const paragraph = (text: string): Block => ({ kind: "paragraph", content: [{ text, marks: [] }] });
const heading = (level: 2 | 3, text: string): Block => ({
  kind: "heading",
  level,
  content: [{ text, marks: [] }],
});

const makeArticle = (
  blocks: Block[],
  overrides: Partial<CanonicalArticle> = {},
): CanonicalArticle =>
  ArticleSchema.parse({
    id: "corrections-article",
    revision: 1,
    lang: "en",
    provenance: {
      sourceUrl: "https://example.com/corrections",
      title: "Corrections Article",
      retrievedAt: "2026-11-27T00:00:00Z",
      originalHtmlHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    blocks,
    footnotes: [],
    ...overrides,
  });

// A real mistake: site chrome survives extraction between body paragraphs.
const chrome = () =>
  makeArticle([
    heading(2, "The harbour"),
    paragraph("The ferry leaves at dawn."),
    paragraph("Share this article"),
    paragraph("Gulls follow it out past the breakwater."),
    paragraph("Sign up for our newsletter"),
  ]);

let seq = 0;
const meta = () => ({ id: `c-${++seq}`, createdAt: "2026-11-27T10:00:00.000Z" });

function hide(article: CanonicalArticle, path: number[], corrections: Correction[] = []) {
  const result = applyCorrections(article, corrections);
  const block = result.view.allBlocks.find((b) => b.path.join(".") === path.join("."))!;
  return blockCorrection("hide", result, block, meta())!;
}

function unhide(article: CanonicalArticle, path: number[], corrections: Correction[]) {
  const result = applyCorrections(article, corrections);
  const block = result.view.allBlocks.find((b) => b.path.join(".") === path.join("."))!;
  return blockCorrection("unhide", result, block, meta())!;
}

describe("pass-through — an article with no corrections", () => {
  it("is the original object, byte for byte, with no fingerprint", () => {
    const article = chrome();
    const result = applyCorrections(article, []);
    expect(result.article).toBe(article);
    expect(result.outcomes).toEqual([]);
    expect(result.fingerprint).toBeUndefined();
    expect(textStamp(result.article)).toEqual({ revision: 1 });
  });

  it("is the original when no correction applies", () => {
    const article = chrome();
    const stray = hide(makeArticle([paragraph("Other text"), paragraph("More")]), [0]);
    const result = applyCorrections(article, [stray]);
    expect(result.article).toBe(article);
    expect(result.outcomes[0]).toEqual({ status: "not-applied", reason: REASONS.notFound });
  });

  it("returns the same result for the same inputs (runs once per corrections change)", () => {
    const article = chrome();
    const corrections = [hide(article, [2])];
    expect(applyCorrections(article, corrections)).toBe(applyCorrections(article, corrections));
  });
});

describe("hide", () => {
  it("removes the block from the corrected article and keeps it, marked, in the view", () => {
    const article = chrome();
    const result = applyCorrections(article, [hide(article, [2])]);
    expect(result.outcomes).toEqual([{ status: "applied" }]);
    expect(normalizeText(result.article)).toBe(
      "The harbour\nThe ferry leaves at dawn.\nGulls follow it out past the breakwater.\nSign up for our newsletter",
    );
    expect(ArticleSchema.safeParse(result.article).success).toBe(true);
    expect(result.view.article).toBe(article);
    expect(result.view.blocks.map((b) => b.hidden)).toEqual([false, false, true, false, false]);
    expect(result.view.blocks[2]!.label).toBe("Paragraph");
  });

  it("never touches the original", () => {
    const article = chrome();
    const before = JSON.stringify(article);
    applyCorrections(article, [hide(article, [2])]);
    expect(JSON.stringify(article)).toBe(before);
  });

  it("gives the corrected article its own text stamp (same revision, a fingerprint)", () => {
    const article = chrome();
    const result = applyCorrections(article, [hide(article, [2])]);
    expect(result.fingerprint).toMatch(/^c/);
    expect(textStamp(result.article)).toEqual({ revision: 1, corrections: result.fingerprint });
    expect(isSameText(textStamp(article), result.article)).toBe(false);
    expect(isSameText(textStamp(result.article), result.article)).toBe(true);
  });

  it("never carries the original's frozen work structure onto the corrected article", () => {
    const article = { ...chrome(), structure: { frozen: true } as never };
    const result = applyCorrections(article, [hide(article, [2])]);
    expect(result.article.structure).not.toEqual({ frozen: true });
  });

  it("hides a trailing block so the main text ends earlier", () => {
    const article = chrome();
    const result = applyCorrections(article, [hide(article, [4])]);
    expect(mainTextLength(result.article)).toBe(
      mainTextLength(article) - [..."\nSign up for our newsletter"].length,
    );
  });

  it("hides a block inside a quotation, keeping the quotation", () => {
    const article = makeArticle([
      paragraph("Before."),
      { kind: "blockquote", children: [paragraph("Quoted line."), paragraph("Share this quote")] },
      paragraph("After."),
    ]);
    const result = applyCorrections(article, [hide(article, [1, 1])]);
    expect(normalizeText(result.article)).toBe("Before.\nQuoted line.\nAfter.");
    const quote = result.view.blocks[1]!;
    expect(quote.hidden).toBe(false);
    expect(quote.children!.map((c) => [c.label, c.hidden])).toEqual([
      ["Paragraph", false],
      ["Paragraph", true],
    ]);
  });

  it("drops a quotation whose every child is hidden", () => {
    const article = makeArticle([
      paragraph("Before."),
      { kind: "blockquote", children: [paragraph("Share this quote")] },
    ]);
    const result = applyCorrections(article, [hide(article, [1, 0])]);
    expect(result.article.blocks).toHaveLength(1);
    expect(result.view.blocks[1]!.hidden).toBe(true);
    expect(result.view.blocks[1]!.hiddenDirectly).toBe(false);
  });

  it("hides a figure, a whole list and an unsupported block", () => {
    const article = makeArticle([
      paragraph("Body."),
      { kind: "figure", alt: "A gull", caption: [{ text: "Photo: staff", marks: [] }] },
      { kind: "bulleted-list", items: [{ content: [paragraph("Related post")] }] },
      { kind: "unsupported", originalKind: "embed", plainDescription: "An embedded video." },
    ]);
    let corrections: Correction[] = [];
    for (const path of [[1], [2], [3]])
      corrections = [...corrections, hide(article, path, corrections)];
    const result = applyCorrections(article, corrections);
    expect(result.outcomes.every((o) => o.status === "applied")).toBe(true);
    expect(normalizeText(result.article)).toBe("Body.");
  });
});

describe("unhide", () => {
  it("restores the block exactly", () => {
    const article = chrome();
    const hid = hide(article, [2]);
    const result = applyCorrections(article, [hid, unhide(article, [2], [hid])]);
    expect(result.outcomes).toEqual([{ status: "applied" }, { status: "applied" }]);
    expect(result.article).toBe(article);
    expect(result.fingerprint).toBeUndefined();
  });

  it("is not applied to a block that isn't hidden", () => {
    const article = chrome();
    const hid = hide(article, [2]);
    const un = unhide(article, [2], [hid]);
    const result = applyCorrections(article, [un]);
    expect(result.outcomes[0]).toEqual({ status: "not-applied", reason: REASONS.notHidden });
  });

  it("is unavailable inside a hidden quotation, with a reason", () => {
    const article = makeArticle([
      paragraph("Body."),
      { kind: "blockquote", children: [paragraph("Pull quote")] },
    ]);
    const result = applyCorrections(article, [hide(article, [1])]);
    const child = result.view.blocks[1]!.children![0]!;
    expect(child.hidden).toBe(true);
    expect(unhideAvailability(child)).toEqual({
      available: false,
      reason: REASONS.insideHidden,
    });
    expect(unhideAvailability(result.view.blocks[1]!)).toEqual({ available: true });
  });
});

describe("targets are found by text, in order", () => {
  it("re-finds a hidden block after earlier blocks moved (no index is trusted)", () => {
    const article = chrome();
    const hid = hide(article, [2]);
    // Re-ingested: a new paragraph arrives before the chrome.
    const changed = makeArticle([
      heading(2, "The harbour"),
      paragraph("An editor's note."),
      paragraph("The ferry leaves at dawn."),
      paragraph("Share this article"),
      paragraph("Gulls follow it out past the breakwater."),
      paragraph("Sign up for our newsletter"),
    ]);
    const result = applyCorrections(changed, [hid]);
    expect(result.outcomes).toEqual([{ status: "applied" }]);
    expect(result.view.blocks[3]!.hidden).toBe(true);
  });

  it("is not applied when the text is gone", () => {
    const article = chrome();
    const hid = hide(article, [2]);
    const changed = makeArticle([paragraph("The ferry leaves at dawn."), paragraph("Gulls.")]);
    expect(applyCorrections(changed, [hid]).outcomes[0]).toEqual({
      status: "not-applied",
      reason: REASONS.notFound,
    });
  });

  it("matches the whole block, not the same words inside another block", () => {
    const article = makeArticle([
      paragraph("Please Share this article with friends."),
      paragraph("Share this article"),
      paragraph("End."),
    ]);
    const hid = hide(article, [1]);
    const result = applyCorrections(article, [hid]);
    expect(normalizeText(result.article)).toBe("Please Share this article with friends.\nEnd.");
  });

  it("uses context to tell identical blocks apart, and is not applied when it can't", () => {
    const article = makeArticle([
      paragraph("First section."),
      paragraph("Advertisement"),
      paragraph("Second section."),
      paragraph("Advertisement"),
      paragraph("Third section."),
    ]);
    const second = hide(article, [3]);
    const result = applyCorrections(article, [second]);
    expect(result.view.blocks.map((b) => b.hidden)).toEqual([false, false, false, true, false]);

    const changed = makeArticle([
      paragraph("Elsewhere."),
      paragraph("Advertisement"),
      paragraph("Elsewhere again."),
      paragraph("Advertisement"),
    ]);
    expect(applyCorrections(changed, [second]).outcomes[0]).toEqual({
      status: "not-applied",
      reason: REASONS.ambiguous,
    });
  });

  it("applies corrections in order, each against the result before it", () => {
    const article = chrome();
    const a = hide(article, [2]);
    const b = hide(article, [4], [a]);
    const result = applyCorrections(article, [a, b]);
    expect(result.outcomes).toEqual([{ status: "applied" }, { status: "applied" }]);
    // The same hide twice: the second finds the block already hidden.
    const twice = applyCorrections(article, [a, { ...a, id: "again" }]);
    expect(twice.outcomes[1]).toEqual({ status: "not-applied", reason: REASONS.alreadyHidden });
  });

  it("records the block's text, kind and depth — never only an index", () => {
    const article = chrome();
    expect(blockTargetFor(article, [2])).toEqual({
      quote: {
        prefix: expect.any(String),
        exact: "Share this article",
        suffix: expect.any(String),
      },
      kind: "paragraph",
      depth: 0,
    });
  });
});

describe("validity rules", () => {
  it("refuses to hide the last block left to read", () => {
    const article = makeArticle([paragraph("Only one."), paragraph("Two.")]);
    const first = hide(article, [0]);
    const result = applyCorrections(article, [first]);
    const last = result.view.blocks[1]!;
    expect(hideAvailability(result, last)).toEqual({ available: false, reason: REASONS.lastBlock });
  });

  it("refuses to hide a block holding a footnote reference", () => {
    const article = makeArticle(
      [
        paragraph("Body."),
        {
          kind: "paragraph",
          content: [
            { text: "Claim", marks: [] },
            { text: "1", marks: [{ type: "footnote-ref", footnoteId: "fn-1", occurrence: 1 }] },
          ],
        },
      ],
      { footnotes: [{ id: "fn-1", content: [{ text: "The note.", marks: [] }] }] },
    );
    const result = applyCorrections(article, []);
    expect(hideAvailability(result, result.view.blocks[1]!)).toEqual({
      available: false,
      reason: REASONS.footnoteReference,
    });
  });

  it("offers hiding a heading or a highlighted block (the consequences step asks first)", () => {
    const article = chrome();
    const result = applyCorrections(article, []);
    expect(hideAvailability(result, result.view.blocks[0]!)).toEqual({ available: true });
    expect(hideAvailability(result, result.view.blocks[2]!)).toEqual({ available: true });
  });

  it("refuses a figure with no text to find it by", () => {
    const article = makeArticle([paragraph("Body."), { kind: "figure", alt: "", caption: [] }]);
    const result = applyCorrections(article, []);
    expect(hideAvailability(result, result.view.blocks[1]!)).toEqual({
      available: false,
      reason: REASONS.noText,
    });
  });
});

describe("chapters of the corrected article", () => {
  // Three chapters; site chrome sits inside the first.
  const book = () =>
    makeArticle([
      paragraph("A short preface."),
      heading(2, "Morning the ferry"),
      paragraph("The ferry leaves at dawn."),
      paragraph("Share this article"),
      heading(2, "Noon"),
      paragraph("Gulls follow it out past the breakwater."),
      heading(2, "Evening"),
      paragraph("The lamps come on along the quay."),
    ]);
  const chapters = (article: CanonicalArticle) =>
    resolveWorkStructure(article)!.destinations.filter((d) => d.kind === "chapter");

  it("keeps every unchanged chapter's identity and title when a paragraph is hidden", () => {
    const article = book();
    const result = applyCorrections(article, [hide(article, [3])]);
    const before = chapters(article);
    const after = chapters(result.article);
    expect(after.map((c) => [c.id, c.title])).toEqual(before.map((c) => [c.id, c.title]));
    // The ranges are the corrected article's own (the structure validates
    // against the text the reader reads).
    expect(after[1]!.startOffset).toBeLessThan(before[1]!.startOffset);
  });

  it("keeps the publisher's chapter titles captured at ingest", () => {
    const plain = book();
    const structure = deriveWorkStructure({ ...plain, provenanceTitle: plain.provenance.title }, [
      "Morning: the ferry",
      "Noon",
      "Evening",
    ])!;
    const article = { ...plain, structure };
    expect(chapters(article).map((c) => c.title)).toEqual([
      "Morning: the ferry",
      "Noon",
      "Evening",
    ]);
    const result = applyCorrections(article, [hide(article, [3])]);
    expect(chapters(result.article).map((c) => [c.title, c.titleSource])).toEqual([
      ["Morning: the ferry", "publisher"],
      ["Noon", "publisher"],
      ["Evening", "publisher"],
    ]);
  });

  it("removes a hidden heading's chapter and keeps the others", () => {
    const article = book();
    const before = chapters(article);
    const result = applyCorrections(article, [hide(article, [4])]);
    expect(chapters(result.article).map((c) => [c.id, c.title])).toEqual([
      [before[0]!.id, "Morning the ferry"],
      [before[2]!.id, "Evening"],
    ]);
  });

  it("is the original structure again after unhiding", () => {
    const article = book();
    const hidden = [hide(article, [4])];
    const result = applyCorrections(article, [...hidden, unhide(article, [4], hidden)]);
    expect(resolveWorkStructure(result.article)).toEqual(resolveWorkStructure(article));
  });
});

describe("view ↔ reading offsets", () => {
  it("agree with the corrected article's own index", () => {
    const article = makeArticle(
      [
        paragraph("Alpha."),
        paragraph("Share this"),
        {
          kind: "blockquote",
          children: [paragraph("Quote one."), paragraph("Ad"), paragraph("Quote two.")],
        },
        paragraph("Omega."),
      ],
      { footnotes: [{ id: "fn-1", content: [{ text: "A note.", marks: [] }] }] },
    );
    const first = hide(article, [1]);
    const corrections = [first, hide(article, [2, 1], [first])];
    const result = applyCorrections(article, corrections);
    const index = articleGraphemeIndex(result.article);
    const top = result.view.blocks.filter((b) => !b.hidden);
    expect(top.map((b) => b.readingStart)).toEqual(index.blockStartOffsets.slice(0, -1));
    const readingText = index.clusters.join("");
    const viewText = articleGraphemeIndex(article).clusters;
    // Every reading offset maps into the view onto the same character.
    for (let r = 0; r < index.totalGraphemes; r++) {
      const v = result.view.viewOffsetFor(r);
      expect(viewText[v]).toBe([...readingText][r]);
      expect(result.view.readingOffsetFor(v)).toBe(r);
    }
    // A hidden block lands on the next passage still read.
    const hiddenBlock = result.view.blocks[1]!;
    expect(result.view.readingOffsetFor(hiddenBlock.viewStart)).toBe(top[1]!.readingStart);
  });
});
