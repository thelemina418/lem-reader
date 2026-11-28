// src/content/corrections/splitMerge.ts
// Spec #68 / issue #75 — split a block at the caret, merge a block with the
// next one. The pure block transforms and their validity rules; the engine
// (./engine.ts) finds targets by text and wires these into `KINDS`, so the
// Correction view's "unavailable because…" and re-application's "not
// applied because…" share these reasons.
//
// The words never change; only block separators move:
//   - split turns one whitespace grapheme inside the block (a space; a line
//     break in a code block) into the block boundary — two blocks of the
//     same type, marks kept on both sides (splitParagraphRuns);
//   - merge turns the boundary into a single space and takes the first
//     block's type; both blocks' runs keep their marks.
//
// Every transform is checked against the normalized text it promises (a
// split's halves are exactly the text either side of the separator; a
// merge reads "first next"), and refuses rather than produce anything else.

import { splitParagraphRuns } from "../../pagination/splitBlock";
import { blockNormalizedText, graphemeClusters, inlineText } from "../normalizeText";
import type { Block, CanonicalArticle, InlineRun } from "../types";
import { BLOCK_KIND_NOUN, blockPathKey } from "../correctionView";

export const SPLIT_MERGE_REASONS = {
  hiddenBlock: "This block is hidden. Unhide it first.",
  splitKind: "Only paragraphs, headings and code blocks can be split.",
  splitQuotation: "Split a paragraph inside the quotation instead.",
  splitNoCaret: "Put the caret where this block should split.",
  splitEdge: "Put the caret between two words, not at the start or end of the block.",
  splitMidWord: "Splitting here would break a word. Put the caret between two words.",
  splitCodeLine: "A code block splits only between lines. Put the caret at a line break.",
  splitChanged: "The place it split is no longer between two words.",
  mergeKind: "Only paragraphs and headings can be merged.",
  mergeNothingNext: "Nothing comes after this block to merge with.",
  mergeNextKind: (noun: string) =>
    `The block after this one is ${/^[aeiou]/.test(noun) ? "an" : "a"} ${noun}; only paragraphs and headings can be merged.`,
  mergeNextHidden: "The block after this one is hidden. Unhide it first.",
  mergeNextChanged: "The block it was merged with no longer follows it.",
} as const;
const R = SPLIT_MERGE_REASONS;

/** A block of the view article with its path (what the engine lays out). */
export interface PlacedBlock {
  readonly block: Block;
  readonly path: readonly number[];
}

/** The block kinds whose text is inline runs (can merge; can split at a space). */
type InlineBlock = Extract<Block, { kind: "paragraph" | "heading" }>;
const isInline = (block: Block): block is InlineBlock =>
  block.kind === "paragraph" || block.kind === "heading";

// ── Split ──────────────────────────────────────────────────────────────────

/**
 * The separator a caret splits at: the whitespace grapheme the caret
 * touches (on either side). A string is the reason it can't split there.
 */
export function splitPoint(block: Block, caret: number | null, lang: string): number | string {
  if (block.kind === "blockquote") return R.splitQuotation;
  if (!isInline(block) && block.kind !== "code-block") return R.splitKind;
  if (caret === null) return R.splitNoCaret;
  const text = graphemeClusters(blockNormalizedText(block), lang);
  const separator = block.kind === "code-block" ? "\n" : " ";
  if (caret <= 0 || caret >= text.length) return R.splitEdge;
  const at = text[caret] === separator ? caret : text[caret - 1] === separator ? caret - 1 : -1;
  if (at <= 0 || at >= text.length - 1) {
    if (at < 0) return block.kind === "code-block" ? R.splitCodeLine : R.splitMidWord;
    return R.splitEdge;
  }
  return at;
}

/** The two halves of `block` split at separator `at`; null when the text
 * there isn't a separator any more, or the halves wouldn't read exactly as
 * the text either side of it. */
export function splitBlockAt(block: Block, at: number, lang: string): [Block, Block] | null {
  const text = graphemeClusters(blockNormalizedText(block), lang);
  const left = text.slice(0, at).join("");
  const right = text.slice(at + 1).join("");
  if (left.length === 0 || right.length === 0) return null;
  if (block.kind === "code-block") {
    if (text[at] !== "\n") return null;
    return [
      { ...block, source: left },
      { ...block, source: right },
    ];
  }
  if (!isInline(block) || text[at] !== " ") return null;
  const before = splitParagraphRuns(block.content, at, lang).before;
  const after = splitParagraphRuns(block.content, at + 1, lang).after;
  if (inlineText(before) !== left || inlineText(after) !== right) return null;
  return [
    { ...block, content: before },
    { ...block, content: after },
  ];
}

// ── Merge ──────────────────────────────────────────────────────────────────

const TRAILING_WS = /[\t\n\f\r ]$/;
const LEADING_WS = /^[\t\n\f\r ]/;

/** `first` and `next` as one block of `first`'s type, joined by a single
 * space (a plain whitespace run when neither side carries one, so the
 * rendered text shows the space the normalized text has). */
export function mergeBlocks(first: Block, next: Block): Block | null {
  if (!isInline(first) || !isInline(next)) return null;
  const last = first.content[first.content.length - 1];
  const head = next.content[0];
  const spaced =
    (last !== undefined && TRAILING_WS.test(last.text)) ||
    (head !== undefined && LEADING_WS.test(head.text));
  const content: InlineRun[] = [
    ...first.content,
    ...(spaced ? [] : [{ text: " ", marks: [] }]),
    ...next.content,
  ];
  const expected = [inlineText(first.content), inlineText(next.content)].filter(Boolean).join(" ");
  if (inlineText(content) !== expected) return null;
  return { ...first, content };
}

/** Why `first` can't merge with `next` (its following sibling, or null). */
export function mergeRefusal(first: Block, next: Block | null, nextHidden: boolean): string | null {
  if (!isInline(first)) return R.mergeKind;
  if (next === null) return R.mergeNothingNext;
  if (!isInline(next)) return R.mergeNextKind(BLOCK_KIND_NOUN[next.kind]);
  if (nextHidden) return R.mergeNextHidden;
  return null;
}

// ── Rebuilding the view article ────────────────────────────────────────────

/** The sibling list at `parent` (top level for []), and a setter that
 * rebuilds the article with a replacement list. */
function siblingsAt(
  article: CanonicalArticle,
  parent: readonly number[],
): { list: readonly Block[]; rebuild: (list: Block[]) => CanonicalArticle } {
  if (parent.length === 0) {
    return { list: article.blocks, rebuild: (blocks) => ({ ...article, blocks }) };
  }
  const outer = siblingsAt(article, parent.slice(0, -1));
  const index = parent[parent.length - 1]!;
  const quotation = outer.list[index]!;
  if (quotation.kind !== "blockquote") throw new Error("not a quotation");
  return {
    list: quotation.children,
    rebuild: (children) => {
      const list = [...outer.list];
      list[index] = { ...quotation, children };
      return outer.rebuild(list);
    },
  };
}

/** The block after `path` among its siblings (null at the end). */
export function nextSibling(
  article: CanonicalArticle,
  path: readonly number[],
): PlacedBlock | null {
  const { list } = siblingsAt(article, path.slice(0, -1));
  const i = path[path.length - 1]! + 1;
  const block = list[i];
  return block === undefined ? null : { block, path: [...path.slice(0, -1), i] };
}

/** Replace `count` siblings at `path` with `blocks`. */
export function replaceAt(
  article: CanonicalArticle,
  path: readonly number[],
  count: number,
  blocks: readonly Block[],
): CanonicalArticle {
  const { list, rebuild } = siblingsAt(article, path.slice(0, -1));
  const i = path[path.length - 1]!;
  const next = [...list];
  next.splice(i, count, ...blocks);
  return rebuild(next);
}

/**
 * Hidden-block keys after siblings shift: every key under `parent` whose
 * index there is ≥ `from` moves by `delta` (descendants move with it).
 */
export function shiftHidden(
  hidden: ReadonlySet<string>,
  parent: readonly number[],
  from: number,
  delta: number,
): Set<string> {
  const out = new Set<string>();
  const depth = parent.length;
  for (const key of hidden) {
    const path = key.split(".").map(Number);
    const under =
      path.length > depth && parent.every((p, i) => path[i] === p) && path[depth]! >= from;
    if (under) path[depth] = path[depth]! + delta;
    out.add(blockPathKey(path));
  }
  return out;
}
