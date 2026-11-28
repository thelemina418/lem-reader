// Spec #68 / issues #71, #73, #74, #75 — the structure-changing kinds
// together. Hide keeps a block hidden by its path key; split / merge (#75)
// and own-paragraph (#73) shift the keys after them with shiftHidden,
// set-type (#74) re-keys them when it wraps, unwraps or moves a caption;
// move-words (#73) moves only a separator, so no key changes. Applied in sequence from the original,
// each step must see the keys the previous one left — so a block hidden
// first stays hidden (and only it) through every later change, and the
// words never change. (applyCorrections memoizes on list identity, so each
// call here passes a fresh copy of the growing list.)

import { describe, expect, it } from "vitest";
import type { Block, CanonicalArticle } from "../../../src/content/types";
import { ArticleSchema, type Correction } from "../../../src/content/schema";
import {
  applyCorrections,
  blockCorrection,
  mergeCorrection,
  splitCorrection,
} from "../../../src/content/corrections/engine";
import { setTypeCorrection } from "../../../src/content/corrections/setType";
import {
  MOVE_REASONS,
  selectionCommands,
  type SelectionCommand,
  type SelectionCommandKind,
} from "../../../src/content/corrections/moveWords";
import { blockNormalizedText, normalizeText } from "../../../src/content/normalizeText";

const p = (text: string): Block => ({ kind: "paragraph", content: [{ text, marks: [] }] });

const article: CanonicalArticle = ArticleSchema.parse({
  id: "combined-kinds",
  revision: 1,
  lang: "en",
  provenance: {
    sourceUrl: "https://example.com/combined",
    title: "Combined kinds",
    retrievedAt: "2026-11-27T00:00:00Z",
    originalHtmlHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  },
  blocks: [
    p("Opening words here."),
    p("Alpha beta. Gamma delta."),
    p("Quoted line to wrap."),
    p("Secret aside to hide."),
    p("Closing words there."),
  ],
  footnotes: [],
});

let seq = 0;
const meta = () => ({ id: `c-${++seq}`, createdAt: "2026-11-27T10:00:00.000Z" });

const SECRET = "Secret aside to hide.";
const words = (a: CanonicalArticle) => normalizeText(a).split(/\s+/).filter(Boolean).sort();

/** The view block (after `corrections`) whose text is `text`. */
function blockWith(corrections: readonly Correction[], text: string) {
  const result = applyCorrections(article, [...corrections]);
  const found = result.view.allBlocks.filter((b) => {
    const path = b.path;
    let list: readonly Block[] = result.view.article.blocks;
    let block: Block | undefined;
    for (const i of path) {
      block = list[i];
      list = block?.kind === "blockquote" ? block.children : [];
    }
    return block?.kind !== "blockquote" && block && blockNormalizedText(block) === text;
  });
  expect(found).toHaveLength(1);
  return { result, block: found[0]! };
}

function expectSecretHiddenOnly(corrections: readonly Correction[]) {
  const result = applyCorrections(article, [...corrections]);
  expect(result.outcomes.every((o) => o.status === "applied")).toBe(true);
  // Hidden in the view, absent from reading, and no other block hidden by
  // a correction (a quotation whose only child is hidden reads as hidden
  // too, without a hide of its own).
  const hidden = result.view.allBlocks.filter((b) => b.hiddenDirectly);
  expect(hidden).toHaveLength(1);
  expect(blockWith(corrections, SECRET).block.hidden).toBe(true);
  expect(normalizeText(result.article)).not.toContain("Secret");
  // Every word kept (the view's article holds hidden blocks too).
  expect(words(result.view.article)).toEqual(words(article));
  return result;
}

describe("hide + split + set-type + merge in sequence", () => {
  it("keeps the hidden block hidden and every word through each step", () => {
    const corrections: Correction[] = [];

    // 1. Hide block 3.
    {
      const { result, block } = blockWith(corrections, SECRET);
      corrections.push(blockCorrection("hide", result, block, meta())!);
    }
    expectSecretHiddenOnly(corrections);

    // 2. Split block 1 at "Gamma" (inserts a block before the hidden one).
    {
      const { result, block } = blockWith(corrections, "Alpha beta. Gamma delta.");
      const split = splitCorrection(result, block, 12, meta());
      expect(split).not.toBeNull();
      corrections.push(split!);
    }
    {
      const result = expectSecretHiddenOnly(corrections);
      expect(result.article.blocks.map((b) => blockNormalizedText(b))).toEqual([
        "Opening words here.",
        "Alpha beta.",
        "Gamma delta.",
        "Quoted line to wrap.",
        "Closing words there.",
      ]);
    }

    // 3. Wrap the (old) block 2 in a quotation — same sibling count, but the
    //    wrapped block's key moves under the quotation.
    {
      const { result, block } = blockWith(corrections, "Quoted line to wrap.");
      corrections.push(setTypeCorrection(result, block, { type: "quotation" }, meta())!);
    }
    {
      const result = expectSecretHiddenOnly(corrections);
      expect(result.article.blocks[3]?.kind).toBe("blockquote");
    }

    // 4. Merge the opening paragraph with "Alpha beta." (removes a block
    //    before the hidden one).
    {
      const { result, block } = blockWith(corrections, "Opening words here.");
      const merge = mergeCorrection(result, block, meta());
      expect(merge).not.toBeNull();
      corrections.push(merge!);
    }
    {
      const result = expectSecretHiddenOnly(corrections);
      expect(result.article.blocks.map((b) => b.kind)).toEqual([
        "paragraph",
        "paragraph",
        "blockquote",
        "paragraph",
      ]);
    }

    // 5. Unwrap the quotation again, then merge "Gamma delta." with the
    //    lifted paragraph: the hidden block, after both, still hidden.
    {
      const result = applyCorrections(article, [...corrections]);
      const quote = result.view.allBlocks.find((b) => b.path.join(".") === "2");
      expect(quote?.label.startsWith("Quotation")).toBe(true);
      corrections.push(setTypeCorrection(result, quote!, { type: "paragraph" }, meta())!);
    }
    expectSecretHiddenOnly(corrections);
    {
      const { result, block } = blockWith(corrections, "Gamma delta.");
      corrections.push(mergeCorrection(result, block, meta())!);
    }
    {
      const result = expectSecretHiddenOnly(corrections);
      expect(result.article.blocks.map((b) => blockNormalizedText(b))).toEqual([
        "Opening words here. Alpha beta.",
        "Gamma delta. Quoted line to wrap.",
        "Closing words there.",
      ]);
    }
  });

  it("keeps a block hidden inside a quotation hidden when splits shift the quotation", () => {
    const corrections: Correction[] = [];
    // Wrap the secret in a quotation first, then hide it inside the quotation.
    {
      const { result, block } = blockWith(corrections, SECRET);
      corrections.push(setTypeCorrection(result, block, { type: "quotation" }, meta())!);
    }
    {
      const { result, block } = blockWith(corrections, SECRET);
      expect(block.path).toEqual([3, 0]);
      corrections.push(blockCorrection("hide", result, block, meta())!);
    }
    // A split before the quotation shifts it (and the nested hidden key).
    {
      const { result, block } = blockWith(corrections, "Alpha beta. Gamma delta.");
      corrections.push(splitCorrection(result, block, 12, meta())!);
    }
    expect(blockWith(corrections, SECRET).block.path).toEqual([4, 0]);
    expectSecretHiddenOnly(corrections);
    // Merge before it, then unwrap — the hidden child lifts out still hidden.
    {
      const { result, block } = blockWith(corrections, "Opening words here.");
      corrections.push(mergeCorrection(result, block, meta())!);
    }
    expectSecretHiddenOnly(corrections);
    {
      const result = applyCorrections(article, [...corrections]);
      const quote = result.view.allBlocks.find((b) => b.path.join(".") === "3");
      expect(quote?.label.startsWith("Quotation")).toBe(true);
      corrections.push(setTypeCorrection(result, quote!, { type: "paragraph" }, meta())!);
    }
    // The quotation reads as hidden (its only child is) but has no hide of
    // its own, so unwrapping it applies and lifts the hidden child out —
    // still hidden, now at the quotation's place.
    const result = applyCorrections(article, [...corrections]);
    expect(result.outcomes.at(-1)).toEqual({ status: "applied" });
    expect(blockWith(corrections, SECRET).block.path).toEqual([3]);
    expectSecretHiddenOnly(corrections);
  });
});

/** The words of an article in reading order (the view's article holds the
 * hidden blocks too). */
const wordsInOrder = (a: CanonicalArticle) => normalizeText(a).split(/\s+/).filter(Boolean);

/** The selection command `kind` for `selected` inside the block whose text
 * is `text` (after `corrections`), selected the way the view captures it:
 * view coordinates. */
function selectionCommand(
  corrections: readonly Correction[],
  text: string,
  selected: string,
  kind: SelectionCommandKind,
): SelectionCommand {
  const { result, block } = blockWith(corrections, text);
  const at = text.indexOf(selected);
  expect(at).toBeGreaterThanOrEqual(0);
  const start = block.viewStart + at;
  const commands = selectionCommands(result, { start, end: start + selected.length }, meta());
  return commands.commands.find((c) => c.kind === kind)!;
}

function run(corrections: Correction[], command: SelectionCommand) {
  expect(command.available, command.reason).toBe(true);
  corrections.push(command.correction!);
}

describe("hide + own-paragraph + move-words + split + set-type in sequence", () => {
  it("keeps the hidden block hidden and every word in order through each step", () => {
    const corrections: Correction[] = [];
    const order = wordsInOrder(article);
    const expectInOrder = () => {
      const result = expectSecretHiddenOnly(corrections);
      expect(wordsInOrder(result.view.article)).toEqual(order);
      return result;
    };
    const texts = () =>
      applyCorrections(article, [...corrections]).article.blocks.map((b) => blockNormalizedText(b));

    // 1. Hide block 3.
    {
      const { result, block } = blockWith(corrections, SECRET);
      corrections.push(blockCorrection("hide", result, block, meta())!);
    }
    expectInOrder();

    // 2. Make "words" its own paragraph (two blocks inserted before the
    //    hidden one: the words before, the words, the words after).
    run(
      corrections,
      selectionCommand(corrections, "Opening words here.", "words", "own-paragraph"),
    );
    expectInOrder();
    expect(texts()).toEqual([
      "Opening",
      "words",
      "here.",
      "Alpha beta. Gamma delta.",
      "Quoted line to wrap.",
      "Closing words there.",
    ]);

    // 3. Move "Gamma delta." to the next block (only the separator moves:
    //    no key changes, the hidden block stays put).
    run(
      corrections,
      selectionCommand(corrections, "Alpha beta. Gamma delta.", "Gamma delta.", "move-next"),
    );
    expectInOrder();
    expect(texts()).toEqual([
      "Opening",
      "words",
      "here.",
      "Alpha beta.",
      "Gamma delta. Quoted line to wrap.",
      "Closing words there.",
    ]);

    // 4. Next to the hidden block, moving into it is refused either way.
    expect(
      selectionCommand(corrections, "Gamma delta. Quoted line to wrap.", "to wrap.", "move-next"),
    ).toMatchObject({ available: false, reason: MOVE_REASONS.nextHidden });
    expect(
      selectionCommand(corrections, "Closing words there.", "Closing", "move-previous"),
    ).toMatchObject({ available: false, reason: MOVE_REASONS.previousHidden });

    // 5. Move "Alpha" up into the previous block.
    run(corrections, selectionCommand(corrections, "Alpha beta.", "Alpha", "move-previous"));
    expectInOrder();

    // 6. Split before "Quoted" (a block inserted before the hidden one),
    //    then wrap "Quoted line to wrap." in a quotation and make "line"
    //    its own paragraph inside it (keys shift inside the quotation only).
    {
      const text = "Gamma delta. Quoted line to wrap.";
      const { result, block } = blockWith(corrections, text);
      corrections.push(splitCorrection(result, block, text.indexOf(" Quoted"), meta())!);
    }
    expectInOrder();
    {
      const { result, block } = blockWith(corrections, "Quoted line to wrap.");
      corrections.push(setTypeCorrection(result, block, { type: "quotation" }, meta())!);
    }
    expectInOrder();
    run(
      corrections,
      selectionCommand(corrections, "Quoted line to wrap.", "line", "own-paragraph"),
    );
    {
      const result = expectInOrder();
      expect(result.view.allBlocks.find((b) => b.hiddenDirectly)?.path).toEqual([6]);
    }

    // 7. After the hidden block: own paragraph, then move words back up.
    run(
      corrections,
      selectionCommand(corrections, "Closing words there.", "Closing", "own-paragraph"),
    );
    expectInOrder();
    run(corrections, selectionCommand(corrections, "words there.", "words", "move-previous"));
    {
      const result = expectInOrder();
      expect(result.article.blocks.map((b) => b.kind)).toEqual([
        "paragraph",
        "paragraph",
        "paragraph",
        "paragraph",
        "paragraph",
        "blockquote",
        "paragraph",
        "paragraph",
      ]);
      expect(normalizeText(result.article).split("\n")).toEqual([
        "Opening",
        "words",
        "here. Alpha",
        "beta.",
        "Gamma delta.",
        "Quoted",
        "line",
        "to wrap.",
        "Closing words",
        "there.",
      ]);
    }
  });
});
