// Spec #68 / issue #74 — seam 1: the "set-type" correction (change a block's
// type) through THE engine (src/content/corrections/engine.ts). Each
// conversion, marks surviving wherever the new type holds them, dropped
// marks reported for code blocks, the footnote-reference refusal, the
// validity rules (a figure can't become a heading, a caption needs a figure
// next to it), the code-block round trip keeping text and spacing, and the
// corrected headings driving the work structure.

import { describe, expect, it } from "vitest";
import type { Block, CanonicalArticle } from "../../../src/content/types";
import { ArticleSchema, type BlockTypeChoice, type Correction } from "../../../src/content/schema";
import { applyCorrections, blockCorrection } from "../../../src/content/corrections/engine";
import {
  BLOCK_TYPE_CHOICES,
  SET_TYPE_REASONS,
  setTypeAvailability,
  setTypeCorrection,
} from "../../../src/content/corrections/setType";
import { normalizeText } from "../../../src/content/normalizeText";
import { resolveWorkStructure } from "../../../src/content/chapterTargets";
import { deriveToc } from "../../../src/content/toc";

const run = (text: string, ...marks: object[]) => ({
  text,
  marks: marks as never[],
});
const paragraph = (...content: { text: string; marks: object[] }[]): Block =>
  ({ kind: "paragraph", content }) as Block;
const p = (text: string) => paragraph(run(text));
const heading = (level: 1 | 2 | 3 | 4 | 5 | 6, text: string): Block => ({
  kind: "heading",
  level,
  content: [{ text, marks: [] }],
});
const figure = (alt: string, caption: string[] = []): Block =>
  ({
    kind: "figure",
    alt,
    caption: caption.map((text) => ({ text, marks: [] })),
  }) as Block;

const makeArticle = (
  blocks: Block[],
  overrides: Partial<CanonicalArticle> = {},
): CanonicalArticle =>
  ArticleSchema.parse({
    id: "set-type-article",
    revision: 1,
    lang: "en",
    provenance: {
      sourceUrl: "https://example.com/set-type",
      title: "Set Type Article",
      retrievedAt: "2026-11-27T00:00:00Z",
      originalHtmlHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    blocks,
    footnotes: [],
    ...overrides,
  });

let seq = 0;
const meta = () => ({ id: `t-${++seq}`, createdAt: "2026-11-27T10:00:00.000Z" });

const viewBlock = (article: CanonicalArticle, corrections: Correction[], path: number[]) => {
  const result = applyCorrections(article, corrections);
  return { result, block: result.view.allBlocks.find((b) => b.path.join(".") === path.join("."))! };
};

/** The set-type correction for the block at `path` (after `corrections`). */
function setType(
  article: CanonicalArticle,
  path: number[],
  to: BlockTypeChoice,
  corrections: Correction[] = [],
): Correction {
  const { result, block } = viewBlock(article, corrections, path);
  return setTypeCorrection(result, block, to, meta())!;
}

function availability(
  article: CanonicalArticle,
  path: number[],
  to: BlockTypeChoice,
  corrections: Correction[] = [],
) {
  const { result, block } = viewBlock(article, corrections, path);
  return setTypeAvailability(result, block, to);
}

const words = (article: CanonicalArticle) =>
  normalizeText(article).split(/\s+/).filter(Boolean).sort();

const H2 = { type: "heading", level: 2 } as const;

describe("paragraph ↔ heading", () => {
  const article = () =>
    makeArticle([
      heading(2, "Leaving port"),
      p("The ferry leaves at dawn."),
      p("Open water"),
      p("By noon the far shore is in view."),
    ]);

  it("turns a paragraph into a heading at any level, keeping its words", () => {
    const original = article();
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      const correction = setType(original, [2], { type: "heading", level });
      const result = applyCorrections(original, [correction]);
      expect(result.outcomes).toEqual([{ status: "applied" }]);
      expect(result.article.blocks[2]).toEqual(heading(level, "Open water"));
      expect(normalizeText(result.article)).toBe(normalizeText(original));
    }
  });

  it("changes a heading's level, and turns a heading back into a paragraph", () => {
    const original = article();
    const level3 = setType(original, [0], { type: "heading", level: 3 });
    expect(applyCorrections(original, [level3]).article.blocks[0]).toEqual(
      heading(3, "Leaving port"),
    );
    const toParagraph = setType(original, [0], { type: "paragraph" });
    expect(applyCorrections(original, [toParagraph]).article.blocks[0]).toEqual(p("Leaving port"));
  });

  it("is unavailable to the type the block already has", () => {
    expect(availability(article(), [0], H2)).toEqual({
      available: false,
      reason: "This block is already Heading 2.",
    });
    expect(availability(article(), [1], { type: "paragraph" })).toEqual({
      available: false,
      reason: "This block is already a paragraph.",
    });
  });

  it("drives the contents and the work structure (a new chapter)", () => {
    const original = article();
    const before = resolveWorkStructure(original)!.destinations.filter((d) => d.kind === "chapter");
    const corrected = applyCorrections(original, [setType(original, [2], H2)]).article;
    expect(deriveToc(corrected).map((e) => e.text)).toEqual([
      "Top of article",
      "Leaving port",
      "Open water",
    ]);
    const after = resolveWorkStructure(corrected)!.destinations.filter((d) => d.kind === "chapter");
    expect(after.map((c) => c.title)).toEqual(["Leaving port", "Open water"]);
    // The untouched chapter keeps its identity.
    expect(after[0]!.id).toBe(before[0]!.id);
  });

  it("keeps a chapter's identity when only its heading level changes", () => {
    const original = makeArticle([
      heading(2, "One"),
      p("Alpha text."),
      heading(2, "Two"),
      p("Beta text."),
    ]);
    const before = resolveWorkStructure(original)!.destinations.filter((d) => d.kind === "chapter");
    const corrected = applyCorrections(original, [
      setType(original, [0], { type: "heading", level: 3 }),
      setType(original, [2], { type: "heading", level: 3 }),
    ]).article;
    const after = resolveWorkStructure(corrected)!.destinations.filter((d) => d.kind === "chapter");
    expect(after.map((c) => c.id)).toEqual(before.map((c) => c.id));
  });
});

describe("marks", () => {
  const link = { type: "link", href: "https://example.com/tide" };
  const marked = () =>
    makeArticle([
      p("Before."),
      paragraph(run("The "), run("tide", { type: "em" }), run(" tables", link), run(" are here.")),
      p("After."),
    ]);

  it("survive a change to a heading and to a quotation", () => {
    const original = marked();
    const block = original.blocks[1]!;
    if (block.kind !== "paragraph") throw new Error("fixture");
    const asHeading = applyCorrections(original, [setType(original, [1], H2)]).article.blocks[1];
    expect(asHeading).toEqual({ kind: "heading", level: 2, content: block.content });
    const asQuote = applyCorrections(original, [setType(original, [1], { type: "quotation" })])
      .article.blocks[1];
    expect(asQuote).toEqual({ kind: "blockquote", children: [block] });
  });

  it("are dropped by a code block, which reports them by their words", () => {
    const original = marked();
    const result = applyCorrections(original, [setType(original, [1], { type: "code-block" })]);
    expect(result.article.blocks[1]).toEqual({
      kind: "code-block",
      source: "The tide tables are here.",
    });
    expect(result.outcomes).toEqual([
      {
        status: "applied",
        droppedMarks: [
          { mark: "em", text: "tide" },
          { mark: "link", text: "tables" },
        ],
      },
    ]);
    expect(normalizeText(result.article)).toBe(normalizeText(original));
  });

  it("reports nothing dropped for plain text", () => {
    const original = marked();
    const result = applyCorrections(original, [setType(original, [0], { type: "code-block" })]);
    expect(result.outcomes).toEqual([{ status: "applied" }]);
  });

  it("refuse a code block when the block holds a footnote reference", () => {
    const original = makeArticle(
      [
        p("Before."),
        paragraph(
          run("A claim"),
          run("1", { type: "footnote-ref", footnoteId: "fn-1", occurrence: 1 }),
          run(" stands."),
        ),
      ],
      { footnotes: [{ id: "fn-1", content: [{ text: "The source.", marks: [] }] }] },
    );
    expect(availability(original, [1], { type: "code-block" })).toEqual({
      available: false,
      reason: SET_TYPE_REASONS.codeFootnote,
    });
    // …but a heading or a quotation can hold the reference.
    expect(availability(original, [1], H2)).toEqual({ available: true });
    expect(availability(original, [1], { type: "quotation" })).toEqual({ available: true });
    // Re-application refuses the same way.
    const forced: Correction = {
      ...setType(original, [1], H2),
      to: { type: "code-block" },
    } as Correction;
    expect(applyCorrections(original, [forced]).outcomes).toEqual([
      { status: "not-applied", reason: SET_TYPE_REASONS.codeFootnote },
    ]);
  });
});

describe("code blocks", () => {
  const SOURCE = "def tide(hour):\n    return hour  * 2\n\n  # spaced";
  const article = () =>
    makeArticle([p("Intro."), { kind: "code-block", language: "py", source: SOURCE }, p("Outro.")]);

  it("round trip code → paragraph → code keeps the text and spacing", () => {
    const original = article();
    const toParagraph = setType(original, [1], { type: "paragraph" });
    const asParagraph = applyCorrections(original, [toParagraph]);
    expect(asParagraph.article.blocks[1]).toEqual({
      kind: "paragraph",
      content: [{ text: SOURCE, marks: [] }],
    });
    const back = setType(original, [1], { type: "code-block" }, [toParagraph]);
    const result = applyCorrections(original, [toParagraph, back]);
    expect(result.outcomes.map((o) => o.status)).toEqual(["applied", "applied"]);
    expect(result.article.blocks[1]).toEqual({ kind: "code-block", source: SOURCE });
    expect(normalizeText(result.article)).toBe(normalizeText(original));
  });

  it("round trip paragraph → code → paragraph keeps the text", () => {
    const original = makeArticle([p("Intro."), p("x  =  1;  y = 2"), p("Outro.")]);
    const toCode = setType(original, [1], { type: "code-block" });
    const back = setType(original, [1], { type: "paragraph" }, [toCode]);
    const result = applyCorrections(original, [toCode, back]);
    expect(result.article.blocks[1]).toEqual(p("x  =  1;  y = 2"));
  });

  it("can become a heading", () => {
    const original = makeArticle([p("Intro."), { kind: "code-block", source: "Results" }]);
    expect(applyCorrections(original, [setType(original, [1], H2)]).article.blocks[1]).toEqual(
      heading(2, "Results"),
    );
  });
});

describe("quotations", () => {
  it("wraps a block in a quotation and lifts a quotation's blocks back out", () => {
    const original = makeArticle([
      p("He said:"),
      p("We sail at dawn."),
      { kind: "blockquote", children: [p("Never again."), p("Not in this weather.")] },
      p("And that was that."),
    ]);
    const wrap = setType(original, [1], { type: "quotation" });
    const wrapped = applyCorrections(original, [wrap]).article;
    expect(wrapped.blocks[1]).toEqual({ kind: "blockquote", children: [p("We sail at dawn.")] });

    const unwrap = setType(original, [2], { type: "paragraph" });
    const unwrapped = applyCorrections(original, [unwrap]).article;
    expect(unwrapped.blocks).toEqual([
      p("He said:"),
      p("We sail at dawn."),
      p("Never again."),
      p("Not in this weather."),
      p("And that was that."),
    ]);
    expect(normalizeText(unwrapped)).toBe(normalizeText(original));
  });

  it("changes the type of a block inside a quotation", () => {
    const original = makeArticle([
      p("Intro."),
      { kind: "blockquote", children: [p("Chorus"), p("Sing it twice.")] },
    ]);
    const result = applyCorrections(original, [
      setType(original, [1, 0], { type: "heading", level: 3 }),
    ]);
    expect(result.article.blocks[1]).toEqual({
      kind: "blockquote",
      children: [heading(3, "Chorus"), p("Sing it twice.")],
    });
  });

  it("refuses a quotation inside a quotation, and a quotation that is already one", () => {
    const original = makeArticle([
      p("Intro."),
      { kind: "blockquote", children: [p("Chorus"), p("Sing it twice.")] },
    ]);
    expect(availability(original, [1, 0], { type: "quotation" })).toEqual({
      available: false,
      reason: SET_TYPE_REASONS.insideQuotation,
    });
    expect(availability(original, [1], { type: "quotation" })).toEqual({
      available: false,
      reason: SET_TYPE_REASONS.alreadyQuotation,
    });
    expect(availability(original, [1], H2)).toEqual({
      available: false,
      reason: SET_TYPE_REASONS.quotationInto,
    });
  });
});

describe("captions", () => {
  it("makes a stray paragraph after a figure its caption (the text is unchanged)", () => {
    const original = makeArticle([
      p("Intro."),
      figure("A ferry at the quay"),
      p("The morning ferry, 1932."),
      p("The body goes on."),
    ]);
    const result = applyCorrections(original, [setType(original, [2], { type: "caption" })]);
    expect(result.outcomes).toEqual([{ status: "applied" }]);
    expect(result.article.blocks).toEqual([
      p("Intro."),
      figure("A ferry at the quay", ["The morning ferry, 1932."]),
      p("The body goes on."),
    ]);
    expect(normalizeText(result.article)).toBe(normalizeText(original));
  });

  it("uses the figure after the paragraph when none comes before it", () => {
    const original = makeArticle([p("Intro."), p("The quay at dusk."), figure("The quay")]);
    const result = applyCorrections(original, [setType(original, [1], { type: "caption" })]);
    expect(result.article.blocks).toEqual([p("Intro."), figure("The quay", ["The quay at dusk."])]);
  });

  it("joins a figure's existing caption with a space, keeping marks", () => {
    const original = makeArticle([
      p("Intro."),
      figure("Gulls", ["Gulls over the pier."]),
      paragraph(run("Photo: "), run("A. Lee", { type: "em" })),
    ]);
    const result = applyCorrections(original, [setType(original, [2], { type: "caption" })]);
    const fig = result.article.blocks[1]!;
    if (fig.kind !== "figure") throw new Error("expected a figure");
    expect(fig.caption).toEqual([
      { text: "Gulls over the pier.", marks: [] },
      { text: " ", marks: [] },
      { text: "Photo: ", marks: [] },
      { text: "A. Lee", marks: [{ type: "em" }] },
    ]);
    expect(words(result.article)).toEqual(words(original));
  });

  it("needs a figure next to the paragraph, and only a paragraph can become one", () => {
    const original = makeArticle([figure("Gulls"), p("Between."), p("Far away."), heading(2, "H")]);
    expect(availability(original, [2], { type: "caption" })).toEqual({
      available: false,
      reason: SET_TYPE_REASONS.noFigure,
    });
    expect(availability(original, [3], { type: "caption" })).toEqual({
      available: false,
      reason: SET_TYPE_REASONS.captionFromParagraph,
    });
    expect(availability(original, [1], { type: "caption" })).toEqual({ available: true });
  });

  it("takes a figure's caption out as a paragraph after it", () => {
    const original = makeArticle([
      p("Intro."),
      figure("Gulls", ["The body text that swallowed the caption."]),
    ]);
    const result = applyCorrections(original, [setType(original, [1], { type: "paragraph" })]);
    expect(result.article.blocks).toEqual([
      p("Intro."),
      figure("Gulls"),
      p("The body text that swallowed the caption."),
    ]);
    expect(normalizeText(result.article)).toBe(normalizeText(original));
  });

  it("a figure can't become a heading", () => {
    const original = makeArticle([p("Intro."), figure("Gulls", ["Over the pier."])]);
    expect(availability(original, [1], H2)).toEqual({
      available: false,
      reason: SET_TYPE_REASONS.figureInto,
    });
    expect(availability(original, [1], { type: "code-block" })).toEqual({
      available: false,
      reason: SET_TYPE_REASONS.figureInto,
    });
  });
});

describe("validity and ordering", () => {
  it("lists can only be hidden", () => {
    const original = makeArticle([
      p("Intro."),
      { kind: "bulleted-list", items: [{ content: [p("One")] }] },
    ]);
    for (const { to } of BLOCK_TYPE_CHOICES) {
      expect(availability(original, [1], to).available).toBe(false);
    }
  });

  it("a hidden block can't change type until it is unhidden", () => {
    const original = makeArticle([p("Intro."), p("Share this"), p("Body.")]);
    const { result, block } = viewBlock(original, [], [1]);
    const hide = blockCorrection("hide", result, block, meta())!;
    expect(availability(original, [1], H2, [hide])).toEqual({
      available: false,
      reason: SET_TYPE_REASONS.hidden,
    });
  });

  it("keeps an earlier hide in place when a later block moves (path keys re-keyed)", () => {
    const original = makeArticle([
      { kind: "blockquote", children: [p("Quoted one."), p("Quoted two.")] },
      p("Share this"),
      p("Body."),
    ]);
    const { result, block } = viewBlock(original, [], [1]);
    const hide = blockCorrection("hide", result, block, meta())!;
    const unwrap = setType(original, [0], { type: "paragraph" }, [hide]);
    const corrected = applyCorrections(original, [hide, unwrap]);
    expect(corrected.outcomes.map((o) => o.status)).toEqual(["applied", "applied"]);
    expect(corrected.article.blocks).toEqual([p("Quoted one."), p("Quoted two."), p("Body.")]);
    const hidden = corrected.view.allBlocks.filter((b) => b.hidden).map((b) => b.path.join("."));
    expect(hidden).toEqual(["2"]);
  });

  it("is not applied when its block's text is gone", () => {
    const original = makeArticle([p("Intro."), p("Open water"), p("Body.")]);
    const correction = setType(original, [1], H2);
    const changed = makeArticle([p("Intro."), p("Body.")]);
    expect(applyCorrections(changed, [correction]).outcomes).toEqual([
      { status: "not-applied", reason: "Its text is no longer in this article." },
    ]);
  });

  it("preserves the multiset of words for every conversion", () => {
    const original = makeArticle([
      heading(2, "Leaving port"),
      p("The ferry leaves at dawn."),
      figure("Gulls"),
      p("Gulls wheel over."),
      { kind: "blockquote", children: [p("Never again.")] },
      { kind: "code-block", source: "a = 1\nb  = 2" },
    ]);
    const all = original.blocks.flatMap((_, i) => BLOCK_TYPE_CHOICES.map((c) => ({ i, to: c.to })));
    for (const { i, to } of all) {
      if (!availability(original, [i], to).available) continue;
      const result = applyCorrections(original, [setType(original, [i], to)]);
      expect(result.outcomes[0]!.status).toBe("applied");
      expect(words(result.article)).toEqual(words(original));
      expect(() => ArticleSchema.parse(result.article)).not.toThrow();
    }
  });
});
