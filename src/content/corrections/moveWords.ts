// src/content/corrections/moveWords.ts
// Spec #68 / issue #73 — the selection corrections: move selected words to
// the next or previous block, and make a selection its own paragraph.
//
// The rule that makes these safe: the words never change, only block
// separators move. A move takes words from the END of a block to the START
// of the next one ("next"), or from the START of a block to the END of the
// previous one ("previous") — moving words from the middle would reorder
// the text, so it is unavailable with a reason. A moved span joins its new
// block with one space; the separator it leaves behind disappears. Every
// result is checked against that rule (same words, same order) before it
// is accepted, so no slicing edge case can ever alter the text.
//
// Inline marks (links, emphasis, strong, code, footnote references) travel
// with their words: runs are sliced by the one block-projection primitive
// pagination uses (splitInlineBlock), never re-flattened.
//
// Selections snap outward to whole words (a word glued to a footnote marker
// counts as one word), within the block's text region: a paragraph's or
// heading's runs, or a figure's caption.
//
// Validity lives here, used both by re-application (the handlers below,
// registered in the engine's KINDS) and by the Correction view's command
// surface (`selectionCommands`), so "unavailable because…" and "not applied
// because…" read the same.

import { findAllOccurrences, matchesContext } from "../../annotations/resolution";
import {
  articleGraphemeIndex,
  blockNormalizedText,
  deriveQuoteSelector,
  graphemeClusters,
  inlineText,
} from "../normalizeText";
import type { TextPositionSelector } from "../normalizeText";
import { splitInlineBlock } from "../../pagination/splitBlock";
import type { Correction } from "../schema";
import type { Block, CanonicalArticle, InlineRun } from "../types";
import { blockPathKey } from "../correctionView";
import {
  blockTargetFor,
  engineStateOf,
  isHiddenUnder,
  layoutOf,
  HIDE_REASONS,
  notFoundReason,
  resolveBlockTarget,
  type CorrectionsResult,
  type EngineState,
  type LaidBlock,
} from "./engine";
import { shiftHidden } from "./splitMerge";

export const MOVE_REASONS = {
  notText: "Words can only be moved out of a paragraph, a heading or a caption.",
  oneBlock: "Select words within one block.",
  hidden: "This block is hidden. Unhide it first.",
  notAtEnd:
    "Only words at the end of a block can move to the next block. Select through to the end of this block.",
  notAtStart:
    "Only words at the start of a block can move to the previous block. Select from the start of this block.",
  wholeBlock: "That is the whole block. Select only the words that belong elsewhere.",
  nothingAfter: "Nothing comes after this block to move into.",
  nothingBefore: "Nothing comes before this block to move into.",
  nextHidden: "The next block is hidden. Unhide it first.",
  previousHidden: "The previous block is hidden. Unhide it first.",
  nextKind: "The next block can't take words: only a paragraph or heading can.",
  previousKind: "The previous block can't take words: only a paragraph, heading or caption can.",
  alreadyParagraph: "This is already its own paragraph.",
  captionEnd: "Only words at the end of a caption can become their own paragraph.",
  wordsChanged: "These words can't be moved without changing the text.",
  wordsNotFound: "The selected words are no longer in this block.",
} as const;

/** Where the moved words are afterwards: a block path in the new view
 * article and the grapheme offset of their first word inside that block. */
export interface Landing {
  readonly path: readonly number[];
  readonly offset: number;
}

type Plan = { ok: true; state: EngineState; landing: Landing } | { ok: false; reason: string };

type MoveWords = Extract<Correction, { kind: "move-words" }>;
type OwnParagraph = Extract<Correction, { kind: "own-paragraph" }>;
type InlineBlock = Extract<Block, { kind: "paragraph" | "heading" }>;

// ── The block's text region ────────────────────────────────────────────────

interface Region {
  /** [start, end) — view-article grapheme offsets. */
  readonly start: number;
  readonly end: number;
  readonly runs: readonly InlineRun[];
}

function regionOf(laid: LaidBlock, lang: string): Region | null {
  const block = laid.block;
  if (block.kind === "paragraph" || block.kind === "heading") {
    return { start: laid.start, end: laid.end, runs: block.content };
  }
  if (block.kind === "figure") {
    const captionLen = graphemeClusters(inlineText(block.caption), lang).length;
    return { start: laid.end - captionLen, end: laid.end, runs: block.caption };
  }
  return null;
}

/** The leaf block (never a quotation) that holds `offset`. */
function leafAt(article: CanonicalArticle, offset: number): LaidBlock | undefined {
  return layoutOf(article).find(
    (b) => b.block.kind !== "blockquote" && b.start <= offset && offset < b.end,
  );
}

// ── Path editing ───────────────────────────────────────────────────────────

function siblingsOf(article: CanonicalArticle, parent: readonly number[]): readonly Block[] {
  let blocks: readonly Block[] = article.blocks;
  for (const i of parent) {
    const block = blocks[i];
    if (!block || block.kind !== "blockquote") return [];
    blocks = block.children;
  }
  return blocks;
}

/** Replace the blocks at `parent`'s children [index, index + count) with
 * `replacement` (a new article; the original is never touched). */
function spliceAt(
  article: CanonicalArticle,
  parent: readonly number[],
  index: number,
  count: number,
  replacement: readonly Block[],
): CanonicalArticle {
  const splice = (blocks: readonly Block[], depth: number): Block[] => {
    if (depth === parent.length) {
      const out = blocks.slice();
      out.splice(index, count, ...replacement);
      return out;
    }
    return blocks.map((block, i) =>
      i === parent[depth] && block.kind === "blockquote"
        ? { ...block, children: splice(block.children, depth + 1) }
        : block,
    );
  };
  return { ...article, blocks: splice(article.blocks, 0) };
}

// ── Slicing runs (marks travel with their words) ───────────────────────────

/** The runs for [from, to) of a run stream (offsets relative to its start). */
function sliceRuns(runs: readonly InlineRun[], from: number, to: number, lang: string) {
  if (to <= from) return [];
  const asParagraph: InlineBlock = { kind: "paragraph", content: runs as InlineRun[] };
  return (splitInlineBlock(asParagraph, from, to, lang) as InlineBlock).content;
}

/** Join two run streams with exactly one space between their words (a
 * whitespace run also keeps a footnote marker from gluing to a word). */
function joinRuns(a: readonly InlineRun[], b: readonly InlineRun[]): InlineRun[] {
  if (a.length === 0) return b.slice();
  if (b.length === 0) return a.slice();
  return [...a, { text: " ", marks: [] }, ...b];
}

function withRuns(block: Block, runs: InlineRun[]): Block {
  if (block.kind === "paragraph" || block.kind === "heading") return { ...block, content: runs };
  if (block.kind === "figure") return { ...block, caption: runs };
  return block;
}

function wordsOf(texts: readonly string[]): string {
  return texts
    .join(" ")
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .join(" ");
}

/** The one guard: same words, same order — only separators moved. */
function sameWords(before: readonly Block[], after: readonly Block[]): boolean {
  return wordsOf(before.map(blockNormalizedText)) === wordsOf(after.map(blockNormalizedText));
}

// ── Snapping a selection to whole words ────────────────────────────────────

function snap(clusters: readonly string[], region: Region, start: number, end: number) {
  let s = Math.max(start, region.start);
  let e = Math.min(end, region.end);
  while (s < e && clusters[s] === " ") s++;
  while (e > s && clusters[e - 1] === " ") e--;
  if (s >= e) return null;
  while (s > region.start && clusters[s - 1] !== " ") s--;
  while (e < region.end && clusters[e] !== " ") e++;
  return { start: s, end: e };
}

// ── Plans (validity + state change, one place) ─────────────────────────────

function sourceRefusal(state: EngineState, laid: LaidBlock): string | null {
  if (state.hidden.has(laid.key) || isHiddenUnder(state.hidden, laid.path)) {
    return MOVE_REASONS.hidden;
  }
  return null;
}

function planMove(
  state: EngineState,
  laid: LaidBlock,
  region: Region,
  s: number,
  e: number,
  direction: "next" | "previous",
): Plan {
  const { article } = state;
  const lang = article.lang;
  const hiddenReason = sourceRefusal(state, laid);
  if (hiddenReason) return { ok: false, reason: hiddenReason };
  const isFigure = laid.block.kind === "figure";
  const whole = s === region.start && e === region.end;
  const parent = laid.path.slice(0, -1);
  const index = laid.path[laid.path.length - 1]!;
  const siblings = siblingsOf(article, parent);

  if (direction === "next") {
    if (e !== laid.end) return { ok: false, reason: MOVE_REASONS.notAtEnd };
    // A caption may move out whole (the figure keeps its image).
    if (whole && !isFigure) return { ok: false, reason: MOVE_REASONS.wholeBlock };
    const nextIndex = index + 1;
    const next = siblings[nextIndex];
    if (!next) return { ok: false, reason: MOVE_REASONS.nothingAfter };
    if (state.hidden.has(blockPathKey([...parent, nextIndex]))) {
      return { ok: false, reason: MOVE_REASONS.nextHidden };
    }
    if (next.kind !== "paragraph" && next.kind !== "heading") {
      return { ok: false, reason: MOVE_REASONS.nextKind };
    }
    const moved = sliceRuns(region.runs, s - region.start, e - region.start, lang);
    const kept = sliceRuns(region.runs, 0, s - region.start, lang);
    const replacement = [withRuns(laid.block, kept), withRuns(next, joinRuns(moved, next.content))];
    if (!sameWords([laid.block, next], replacement)) {
      return { ok: false, reason: MOVE_REASONS.wordsChanged };
    }
    return {
      ok: true,
      state: { article: spliceAt(article, parent, index, 2, replacement), hidden: state.hidden },
      landing: { path: [...parent, nextIndex], offset: 0 },
    };
  }

  if (s !== laid.start) return { ok: false, reason: MOVE_REASONS.notAtStart };
  if (whole && !isFigure) return { ok: false, reason: MOVE_REASONS.wholeBlock };
  const prevIndex = index - 1;
  const prev = prevIndex >= 0 ? siblings[prevIndex] : undefined;
  if (!prev) return { ok: false, reason: MOVE_REASONS.nothingBefore };
  if (state.hidden.has(blockPathKey([...parent, prevIndex]))) {
    return { ok: false, reason: MOVE_REASONS.previousHidden };
  }
  if (prev.kind !== "paragraph" && prev.kind !== "heading" && prev.kind !== "figure") {
    return { ok: false, reason: MOVE_REASONS.previousKind };
  }
  const prevRuns = prev.kind === "figure" ? prev.caption : prev.content;
  const moved = sliceRuns(region.runs, s - region.start, e - region.start, lang);
  const kept = sliceRuns(region.runs, e - region.start, region.end - region.start, lang);
  const replacement = [withRuns(prev, joinRuns(prevRuns, moved)), withRuns(laid.block, kept)];
  if (!sameWords([prev, laid.block], replacement)) {
    return { ok: false, reason: MOVE_REASONS.wordsChanged };
  }
  const prevText = graphemeClusters(blockNormalizedText(replacement[0]!), lang);
  const movedLen = e - s;
  return {
    ok: true,
    state: { article: spliceAt(article, parent, prevIndex, 2, replacement), hidden: state.hidden },
    landing: { path: [...parent, prevIndex], offset: prevText.length - movedLen },
  };
}

function planOwnParagraph(
  state: EngineState,
  laid: LaidBlock,
  region: Region,
  s: number,
  e: number,
): Plan {
  const { article } = state;
  const lang = article.lang;
  const hiddenReason = sourceRefusal(state, laid);
  if (hiddenReason) return { ok: false, reason: hiddenReason };
  const block = laid.block;
  const whole = s === region.start && e === region.end;
  if (whole && block.kind === "paragraph") {
    return { ok: false, reason: MOVE_REASONS.alreadyParagraph };
  }
  if (block.kind === "figure" && e !== region.end) {
    return { ok: false, reason: MOVE_REASONS.captionEnd };
  }
  const parent = laid.path.slice(0, -1);
  const index = laid.path[laid.path.length - 1]!;
  const rel = (n: number) => n - region.start;
  const len = region.end - region.start;
  const selected: Block = {
    kind: "paragraph",
    content: sliceRuns(region.runs, rel(s), rel(e), lang),
  };
  const before = sliceRuns(region.runs, 0, rel(s), lang);
  const after = sliceRuns(region.runs, rel(e), len, lang);
  const replacement: Block[] = [];
  // A figure always stays (its image), keeping the caption words before.
  if (before.length > 0 || block.kind === "figure") replacement.push(withRuns(block, before));
  const selectedAt = replacement.length;
  replacement.push(selected);
  if (after.length > 0) replacement.push(withRuns(block, after));
  if (!sameWords([block], replacement)) {
    return { ok: false, reason: MOVE_REASONS.wordsChanged };
  }
  return {
    ok: true,
    state: {
      article: spliceAt(article, parent, index, 1, replacement),
      // The same dot-path re-keying as split / merge / set-type: siblings
      // after the source block move down by the extra blocks inserted.
      hidden: shiftHidden(state.hidden, parent, index + 1, replacement.length - 1),
    },
    landing: { path: [...parent, index + selectedAt], offset: 0 },
  };
}

// ── Re-application: find the block, then the words in it ──────────────────

function locate(
  state: EngineState,
  correction: MoveWords | OwnParagraph,
): { laid: LaidBlock; region: Region; s: number; e: number } | { reason: string } {
  const { article } = state;
  const found = resolveBlockTarget(article, correction.target);
  if (found === "orphan") return { reason: notFoundReason(article, correction.target) };
  if (found === "ambiguous") return { reason: HIDE_REASONS.ambiguous };
  const region = regionOf(found, article.lang);
  if (!region) return { reason: MOVE_REASONS.notText };
  const { clusters } = articleGraphemeIndex(article);
  const exact = graphemeClusters(correction.words.exact, article.lang);
  let candidates = findAllOccurrences(clusters, exact).filter(
    (at) => at >= region.start && at + exact.length <= region.end,
  );
  if (candidates.length > 1) {
    const narrowed = candidates.filter((at) =>
      matchesContext(clusters, at, exact.length, correction.words, article.lang),
    );
    if (narrowed.length > 0) candidates = narrowed;
  }
  if (candidates.length > 1 && correction.kind === "move-words") {
    const atEdge = candidates.filter((at) =>
      correction.direction === "next" ? at + exact.length === found.end : at === found.start,
    );
    if (atEdge.length > 0) candidates = atEdge;
  }
  if (candidates.length === 0) return { reason: MOVE_REASONS.wordsNotFound };
  if (candidates.length > 1) return { reason: HIDE_REASONS.ambiguous };
  const s = candidates[0]!;
  return { laid: found, region, s, e: s + exact.length };
}

function plan(state: EngineState, correction: MoveWords | OwnParagraph): Plan {
  const at = locate(state, correction);
  if ("reason" in at) return { ok: false, reason: at.reason };
  return correction.kind === "move-words"
    ? planMove(state, at.laid, at.region, at.s, at.e, correction.direction)
    : planOwnParagraph(state, at.laid, at.region, at.s, at.e);
}

/** Engine handler: move words to the next or previous block. */
export function moveWords(state: EngineState, correction: MoveWords) {
  const p = plan(state, correction);
  return p.ok ? { ok: true as const, state: p.state } : p;
}

/** Engine handler: make the selected words their own paragraph. */
export function ownParagraph(state: EngineState, correction: OwnParagraph) {
  const p = plan(state, correction);
  return p.ok ? { ok: true as const, state: p.state } : p;
}

// ── The Correction view's selection commands ───────────────────────────────

export type SelectionCommandKind = "move-next" | "move-previous" | "own-paragraph";

export interface SelectionCommand {
  readonly kind: SelectionCommandKind;
  readonly available: boolean;
  readonly reason?: string;
  /** The correction to preview and apply (when available). */
  readonly correction?: Correction;
  /** Where the moved words land in the corrected view (when available). */
  readonly landing?: Landing;
}

export interface SelectionCommands {
  /** The selection snapped to whole words (view coordinates); null when
   * the selection holds no words a command could act on. */
  readonly range: TextPositionSelector | null;
  /** The selected words (for announcements). */
  readonly words: string;
  readonly commands: readonly SelectionCommand[];
}

const ORDER: readonly SelectionCommandKind[] = ["move-next", "move-previous", "own-paragraph"];

/**
 * The selection commands for a view-coordinate selection, each available
 * or unavailable with the engine's reason. Availability is decided by
 * running the very correction the command would store through its engine
 * handler — so a command offered here applies, and re-applies, the same.
 */
export function selectionCommands(
  result: CorrectionsResult,
  selection: TextPositionSelector,
  meta: { id: string; createdAt: string },
): SelectionCommands {
  const state = engineStateOf(result);
  const article = state.article;
  const unavailable = (reason: string): SelectionCommands => ({
    range: null,
    words: "",
    commands: ORDER.map((kind) => ({ kind, available: false, reason })),
  });
  const startBlock = leafAt(article, selection.start);
  const endBlock = leafAt(article, Math.max(selection.start, selection.end - 1));
  if (!startBlock) return unavailable(MOVE_REASONS.notText);
  if (endBlock !== startBlock) return unavailable(MOVE_REASONS.oneBlock);
  const region = regionOf(startBlock, article.lang);
  if (!region) return unavailable(MOVE_REASONS.notText);
  const { clusters } = articleGraphemeIndex(article);
  const snapped = snap(clusters, region, selection.start, selection.end);
  if (!snapped) return unavailable(MOVE_REASONS.notText);
  const target = blockTargetFor(article, startBlock.path);
  if (!target) return unavailable(HIDE_REASONS.noText);
  const words = deriveQuoteSelector(article, snapped);
  const commands = ORDER.map((kind): SelectionCommand => {
    const correction: MoveWords | OwnParagraph =
      kind === "own-paragraph"
        ? { kind: "own-paragraph", ...meta, target, words }
        : {
            kind: "move-words",
            ...meta,
            target,
            words,
            direction: kind === "move-next" ? "next" : "previous",
          };
    const p = plan(state, correction);
    if (!p.ok) return { kind, available: false, reason: p.reason };
    // Re-application must find the same words the reader selected.
    const at = locate(state, correction);
    if ("reason" in at || at.s !== snapped.start) {
      return { kind, available: false, reason: HIDE_REASONS.ambiguous };
    }
    return { kind, available: true, correction, landing: p.landing };
  });
  return { range: snapped, words: words.exact, commands };
}
