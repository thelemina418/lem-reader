// Spec #68 / issue #73 — seam 1: the selection corrections in the engine.
// Move selected words to the next / previous block, make a selection its own
// paragraph. Pinned: the caption example from #51, marks (links, emphasis,
// footnote references) travelling with moved words, the words themselves
// never changing (same words, same order — only block separators move),
// every "unavailable because…" reason, and re-application by text.

import { describe, expect, it } from "vitest";
import type { Block, CanonicalArticle, InlineRun } from "../../../src/content/types";
import { ArticleSchema, CorrectionSchema, type Correction } from "../../../src/content/schema";
import { applyCorrections, blockCorrection } from "../../../src/content/corrections/engine";
import {
  MOVE_REASONS,
  selectionCommands,
  type SelectionCommandKind,
} from "../../../src/content/corrections/moveWords";
import { normalizeText } from "../../../src/content/normalizeText";

const run = (text: string, marks: InlineRun["marks"] = []): InlineRun => ({ text, marks });
const paragraph = (...runs: (string | InlineRun)[]): Block => ({
  kind: "paragraph",
  content: runs.map((r) => (typeof r === "string" ? run(r) : r)),
});
const heading = (text: string): Block => ({ kind: "heading", level: 2, content: [run(text)] });
const figure = (caption: InlineRun[], alt = ""): Block => ({
  kind: "figure",
  alt,
  src: "https://example.com/harbour.jpg",
  caption,
});

const makeArticle = (blocks: Block[], footnotes: unknown[] = []): CanonicalArticle =>
  ArticleSchema.parse({
    id: "move-words",
    revision: 1,
    lang: "en",
    provenance: {
      sourceUrl: "https://example.com/move-words",
      title: "Move Words",
      retrievedAt: "2026-11-27T00:00:00Z",
      originalHtmlHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    blocks,
    footnotes,
  });

const STRAY = "The mayor said the ferry would keep running";
const REST = "through the winter, whatever the weather.";

// The caption example (#51): ingestion put the start of the next paragraph
// into the photo's caption — with a link and emphasis on the stray words.
const captionExample = () =>
  makeArticle([
    heading("Leaving port"),
    figure([
      run("The harbour at dawn. "),
      run("Photo: Ana Ruiz.", [{ type: "em" }]),
      run(" The "),
      run("mayor", [{ type: "link", href: "https://example.com/mayor" }]),
      run(" said the ferry would keep running"),
    ]),
    paragraph(REST),
    paragraph("Gulls follow it out past the breakwater."),
  ]);

let seq = 0;
const meta = () => ({ id: `m-${++seq}`, createdAt: "2026-11-27T10:00:00.000Z" });

/** View-coordinate range of `words` (first occurrence at or after `from`). */
function rangeOf(article: CanonicalArticle, words: string, from = 0) {
  const text = normalizeText(article);
  const at = text.indexOf(words, from);
  if (at < 0) throw new Error(`"${words}" not in article`);
  const start = [...text.slice(0, at)].length;
  return { start, end: start + [...words].length };
}

function command(
  article: CanonicalArticle,
  corrections: Correction[],
  words: string,
  kind: SelectionCommandKind,
) {
  const result = applyCorrections(article, corrections);
  const range = rangeOf(result.view.article, words);
  const cmds = selectionCommands(result, range, meta());
  return cmds.commands.find((c) => c.kind === kind)!;
}

function apply(article: CanonicalArticle, words: string, kind: SelectionCommandKind) {
  const cmd = command(article, [], words, kind);
  expect(cmd.reason).toBeUndefined();
  expect(cmd.available).toBe(true);
  return { correction: cmd.correction!, result: applyCorrections(article, [cmd.correction!]) };
}

const words = (text: string) => text.split(/\s+/).filter(Boolean);

describe("move words to the next block — the caption example", () => {
  it("leaves the caption a caption and makes the paragraph whole", () => {
    const article = captionExample();
    const { correction, result } = apply(article, STRAY, "move-next");
    expect(CorrectionSchema.safeParse(correction).success).toBe(true);
    expect(result.outcomes).toEqual([{ status: "applied" }]);
    const fig = result.article.blocks[1]!;
    expect(fig.kind).toBe("figure");
    expect(normalizeText(result.article)).toBe(
      [
        "Leaving port",
        "The harbour at dawn. Photo: Ana Ruiz.",
        `${STRAY} ${REST}`,
        "Gulls follow it out past the breakwater.",
      ].join("\n"),
    );
    expect(ArticleSchema.safeParse(result.article).success).toBe(true);
    // The original is never touched (ADR 0014).
    expect(article.blocks[1]).toEqual(captionExample().blocks[1]);
  });

  it("carries links and emphasis with the moved words, and keeps the caption's own", () => {
    const { result } = apply(captionExample(), STRAY, "move-next");
    const fig = result.article.blocks[1] as Extract<Block, { kind: "figure" }>;
    expect(fig.caption.some((r) => r.marks.some((m) => m.type === "em"))).toBe(true);
    expect(fig.caption.some((r) => r.marks.some((m) => m.type === "link"))).toBe(false);
    const para = result.article.blocks[2] as Extract<Block, { kind: "paragraph" }>;
    const link = para.content.find((r) => r.marks.some((m) => m.type === "link"));
    expect(link?.text.trim()).toBe("mayor");
  });

  it("snaps a selection that starts or ends mid-word out to whole words", () => {
    const article = captionExample();
    const result = applyCorrections(article, []);
    const exact = rangeOf(result.view.article, STRAY);
    const sloppy = { start: exact.start + 2, end: exact.end };
    const cmds = selectionCommands(result, sloppy, meta());
    expect(cmds.words).toBe(STRAY);
    expect(cmds.range).toEqual(exact);
  });

  it("lands on the moved words' block", () => {
    const article = captionExample();
    const cmd = command(article, [], STRAY, "move-next");
    expect(cmd.landing).toEqual({ path: [2], offset: 0 });
  });

  it("re-applies by text, and is not applied once its words are gone", () => {
    const article = captionExample();
    const { correction } = apply(article, STRAY, "move-next");
    // Same text, different neighbours: still found.
    const shifted = makeArticle([paragraph("A new opening paragraph."), ...article.blocks]);
    expect(applyCorrections(shifted, [correction]).outcomes).toEqual([{ status: "applied" }]);
    // The stray words were fixed upstream: nothing to move.
    const fixed = makeArticle([
      heading("Leaving port"),
      figure([run("The harbour at dawn. Photo: Ana Ruiz.")]),
      paragraph(`${STRAY} ${REST}`),
    ]);
    const outcome = applyCorrections(fixed, [correction]).outcomes[0]!;
    expect(outcome.status).toBe("not-applied");
  });
});

describe("move words to the previous block", () => {
  const split = () =>
    makeArticle([
      paragraph("The ferry leaves at dawn, before the fog"),
      paragraph("has lifted off the water. Gulls follow it out."),
      paragraph("By noon the far shore is in view."),
    ]);

  it("rejoins a sentence cut off at a block boundary", () => {
    const { result } = apply(split(), "has lifted off the water.", "move-previous");
    expect(normalizeText(result.article)).toBe(
      [
        "The ferry leaves at dawn, before the fog has lifted off the water.",
        "Gulls follow it out.",
        "By noon the far shore is in view.",
      ].join("\n"),
    );
  });

  it("lands on the first moved word inside the previous block", () => {
    const cmd = command(split(), [], "has lifted off the water.", "move-previous");
    expect(cmd.landing).toEqual({
      path: [0],
      offset: [..."The ferry leaves at dawn, before the fog "].length,
    });
  });

  it("can move words to the end of a figure's caption", () => {
    const article = makeArticle([
      figure([run("The harbour at dawn.")]),
      paragraph("Photo: Ana Ruiz. The ferry leaves at dawn."),
    ]);
    const { result } = apply(article, "Photo: Ana Ruiz.", "move-previous");
    expect(normalizeText(result.article)).toBe(
      "The harbour at dawn. Photo: Ana Ruiz.\nThe ferry leaves at dawn.",
    );
  });
});

describe("footnote references travel with their words", () => {
  const withNote = () =>
    makeArticle(
      [
        figure([
          run("The harbour at dawn. The mayor said it would run"),
          run("1", [{ type: "footnote-ref", footnoteId: "fn-1", occurrence: 1 }]),
        ]),
        paragraph("all winter."),
      ],
      [{ id: "fn-1", content: [run("Council minutes, 3 March.")] }],
    );

  it("moves a glued marker as part of its word and keeps the reference", () => {
    const article = withNote();
    // Selecting up to "run" snaps out to "run1" (the marker is glued).
    const result0 = applyCorrections(article, []);
    const range = rangeOf(result0.view.article, "The mayor said it would run");
    const cmds = selectionCommands(result0, range, meta());
    expect(cmds.words).toBe("The mayor said it would run1");
    const cmd = cmds.commands.find((c) => c.kind === "move-next")!;
    expect(cmd.available).toBe(true);
    const result = applyCorrections(article, [cmd.correction!]);
    const para = result.article.blocks[1] as Extract<Block, { kind: "paragraph" }>;
    const ref = para.content.find((r) => r.marks.some((m) => m.type === "footnote-ref"));
    expect(ref?.text).toBe("1");
    expect(normalizeText(result.article).split("\n").slice(0, 2)).toEqual([
      "The harbour at dawn.",
      "The mayor said it would run1 all winter.",
    ]);
  });
});

describe("make a selection its own paragraph", () => {
  it("splits a paragraph around the selection, keeping the words in order", () => {
    const article = makeArticle([
      paragraph("The ferry leaves at dawn. Share this article. Gulls follow it out."),
    ]);
    const { result } = apply(article, "Share this article.", "own-paragraph");
    expect(normalizeText(result.article)).toBe(
      "The ferry leaves at dawn.\nShare this article.\nGulls follow it out.",
    );
    expect(result.article.blocks.map((b) => b.kind)).toEqual([
      "paragraph",
      "paragraph",
      "paragraph",
    ]);
  });

  it("keeps the block's type around the selection (a heading stays a heading)", () => {
    const article = makeArticle([heading("Leaving port The ferry leaves at dawn.")]);
    const { result } = apply(article, "The ferry leaves at dawn.", "own-paragraph");
    expect(result.article.blocks.map((b) => b.kind)).toEqual(["heading", "paragraph"]);
  });

  it("turns the end of a caption into a paragraph after the figure", () => {
    const { result } = apply(captionExample(), STRAY, "own-paragraph");
    expect(result.article.blocks.map((b) => b.kind)).toEqual([
      "heading",
      "figure",
      "paragraph",
      "paragraph",
      "paragraph",
    ]);
    expect(normalizeText(result.article).split("\n")[2]).toBe(STRAY);
  });

  it("keeps a later hidden block hidden when blocks are inserted before it", () => {
    const article = makeArticle([
      paragraph("The ferry leaves at dawn. Share this article."),
      paragraph("Sign up for our newsletter"),
      paragraph("Gulls follow it out."),
    ]);
    const base = applyCorrections(article, []);
    const hide = blockCorrection("hide", base, base.view.blocks[1]!, meta())!;
    const cmd = command(article, [hide], "Share this article.", "own-paragraph");
    const result = applyCorrections(article, [hide, cmd.correction!]);
    expect(result.outcomes.every((o) => o.status === "applied")).toBe(true);
    expect(normalizeText(result.article)).toBe(
      "The ferry leaves at dawn.\nShare this article.\nGulls follow it out.",
    );
    expect(result.view.blocks.map((b) => b.hidden)).toEqual([false, false, true, false]);
  });
});

describe("unavailable commands say why (the engine's reasons)", () => {
  const article = () =>
    makeArticle([
      paragraph("The ferry leaves at dawn, before the fog."),
      { kind: "code-block", source: "npm run ferry" },
      paragraph("Gulls follow it out past the breakwater."),
    ]);

  it("nothing after the last block", () => {
    const cmd = command(article(), [], "past the breakwater.", "move-next");
    expect(cmd).toMatchObject({ available: false, reason: MOVE_REASONS.nothingAfter });
  });

  it("nothing before the first block", () => {
    const cmd = command(article(), [], "The ferry", "move-previous");
    expect(cmd).toMatchObject({ available: false, reason: MOVE_REASONS.nothingBefore });
  });

  it("words in the middle can't move (that would reorder the text)", () => {
    const a = article();
    expect(command(a, [], "before", "move-next")).toMatchObject({
      available: false,
      reason: MOVE_REASONS.notAtEnd,
    });
    expect(command(a, [], "before", "move-previous")).toMatchObject({
      available: false,
      reason: MOVE_REASONS.notAtStart,
    });
  });

  it("the next block must be able to take words", () => {
    const cmd = command(article(), [], "before the fog.", "move-next");
    expect(cmd).toMatchObject({ available: false, reason: MOVE_REASONS.nextKind });
  });

  it("a whole paragraph can't move, and is already its own paragraph", () => {
    const a = makeArticle([paragraph("One."), paragraph("Two words.")]);
    expect(command(a, [], "Two words.", "move-previous")).toMatchObject({
      available: false,
      reason: MOVE_REASONS.wholeBlock,
    });
    expect(command(a, [], "Two words.", "own-paragraph")).toMatchObject({
      available: false,
      reason: MOVE_REASONS.alreadyParagraph,
    });
  });

  it("code blocks and selections across blocks are not offered", () => {
    const a = article();
    expect(command(a, [], "npm run", "move-next").reason).toBe(MOVE_REASONS.notText);
    const result = applyCorrections(a, []);
    const across = {
      start: rangeOf(result.view.article, "the fog.").start,
      end: rangeOf(result.view.article, "Gulls").end,
    };
    const cmds = selectionCommands(result, across, meta());
    expect(cmds.range).toBeNull();
    expect(cmds.commands.every((c) => c.reason === MOVE_REASONS.oneBlock)).toBe(true);
  });

  it("a hidden neighbour can't take words", () => {
    const a = makeArticle([
      paragraph("The ferry leaves. Share this"),
      paragraph("Sign up for our newsletter"),
    ]);
    const base = applyCorrections(a, []);
    const hide = blockCorrection("hide", base, base.view.blocks[1]!, meta())!;
    expect(command(a, [hide], "Share this", "move-next")).toMatchObject({
      available: false,
      reason: MOVE_REASONS.nextHidden,
    });
  });
});

describe("the words never change — only block separators move", () => {
  // Property-style: every word position of every fixture, each command.
  const fixtures = [
    captionExample(),
    makeArticle([
      paragraph("Alpha ", run("beta", [{ type: "strong" }]), " gamma delta."),
      heading("Epsilon zeta"),
      paragraph("Eta ", run("theta iota", [{ type: "em" }]), " kappa."),
    ]),
  ];
  const kinds: SelectionCommandKind[] = ["move-next", "move-previous", "own-paragraph"];

  it("preserves the ordered words (and so their multiset) for every applicable command", () => {
    let applied = 0;
    for (const article of fixtures) {
      const before = words(normalizeText(article));
      const result = applyCorrections(article, []);
      const total = [...normalizeText(article)].length;
      for (let start = 0; start < total; start += 3) {
        for (const len of [1, 6, 15, 40]) {
          const cmds = selectionCommands(
            result,
            { start, end: Math.min(total, start + len) },
            meta(),
          );
          for (const kind of kinds) {
            const cmd = cmds.commands.find((c) => c.kind === kind)!;
            if (!cmd.available) continue;
            const after = applyCorrections(article, [cmd.correction!]);
            expect(after.outcomes).toEqual([{ status: "applied" }]);
            expect(words(normalizeText(after.article))).toEqual(before);
            expect(ArticleSchema.safeParse(after.article).success).toBe(true);
            applied++;
          }
        }
      }
    }
    expect(applied).toBeGreaterThan(20);
  });
});
