// src/content/corrections/engine.ts
// Spec #68 / issue #71 — THE correction engine (ADR 0014: corrections are a
// layer over the preserved original). One pure function: the original
// article plus its ordered corrections in; out come
//   - the corrected article — a valid canonical article for reading (hidden
//     blocks absent), the coordinate substrate for everything the reader sees;
//   - the correction-view model — every block, hidden ones present and
//     marked, each with its type and a stable identity;
//   - an outcome per correction — applied, or not applied with a reason.
//
// Every consumer derives the corrected article through `applyCorrections`;
// no consumer re-implements correction logic. Per-kind validity lives HERE
// (`KINDS`), so the Correction view's "unavailable because…" and
// re-application's "not applied because…" come from one place.
//
// Targets are found by TEXT, never by block index alone: a block target is
// a quote selector whose `exact` is the block's whole normalized text over
// the view article as of the corrections before it (ordered application),
// narrowed by block kind + depth and then by prefix/suffix context. Only a
// confident match applies — the fuzzy prefix/suffix-only fallback that
// highlights use for changed words is deliberately NOT used (phase-1
// corrections never change words, so an exact match always exists when the
// target is still there).
//
// Pass-through: no applied corrections → the corrected article IS the
// original object (every grapheme/footnote cache hits, byte-identical
// behavior, no fingerprint). Results are memoized per (original,
// corrections) identity so the engine runs once per corrections change,
// never per layout pass.
//
// Adding a kind (#72–#76): add its schema member in src/content/schema.ts,
// a handler in `KINDS` (validity + state change), and — when it changes the
// view article's blocks — produce the new view article in the handler.

import { findAllOccurrences, matchesContext } from "../../annotations/resolution";
import { footnoteRefOf } from "../footnoteReferences";
import {
  articleGraphemeIndex,
  blockNormalizedText,
  deriveQuoteSelector,
  graphemeClusters,
  resolveQuoteSelector,
} from "../normalizeText";
import type { BlockTarget, Correction } from "../schema";
import type { TextQuoteSelector } from "../normalizeText";
import { fingerprintText, registerCorrectionsFingerprint } from "../sameText";
import { correctedStructure } from "./structure";
import { setTypeHandler } from "./setType";
import type { Block, CanonicalArticle, InlineRun } from "../types";
import {
  blockPathKey,
  buildCorrectionView,
  correctionBlockId,
  correctionViewFromArticle,
  type CorrectionViewBlock,
  type CorrectionViewModel,
} from "../correctionView";
import {
  mergeBlocks,
  mergeRefusal,
  nextSibling,
  replaceAt,
  shiftHidden,
  splitBlockAt,
  splitPoint,
  SPLIT_MERGE_REASONS,
} from "./splitMerge";

/** A mark a correction dropped (issue #74: a code block holds plain text
 * only), named by the words that carried it. */
export interface DroppedMark {
  readonly mark: "link" | "em" | "strong" | "code";
  readonly text: string;
}

export type CorrectionOutcome =
  | { readonly status: "applied"; readonly droppedMarks?: readonly DroppedMark[] }
  | { readonly status: "not-applied"; readonly reason: string };

export interface CorrectionsResult {
  /** The corrected article (hidden blocks absent). The original object when
   * nothing applies. */
  readonly article: CanonicalArticle;
  /** The correction-view model (every block, hidden ones marked). */
  readonly view: CorrectionViewModel;
  /** One outcome per input correction, in order. */
  readonly outcomes: readonly CorrectionOutcome[];
  /** Substrate fingerprint (src/content/sameText.ts); undefined = original. */
  readonly fingerprint: string | undefined;
}

// ── Engine state ────────────────────────────────────────────────────────────

export interface EngineState {
  /** The view article: every block, hidden ones included. Hide/unhide never
   * change it; later kinds (split, merge, move words…) do. */
  readonly article: CanonicalArticle;
  /** Path keys (into `article`) of directly hidden blocks. */
  readonly hidden: ReadonlySet<string>;
}

export type Step =
  | { ok: true; state: EngineState; dropped?: readonly DroppedMark[] }
  | { ok: false; reason: string };

// ── Calm reasons (shared by availability and re-application) ───────────────

export const REASONS = {
  notFound: "Its text is no longer in this article.",
  ambiguous: "Its text now appears in more than one place, so it can't be placed with confidence.",
  noText: "This block has no text to find it by, so the change couldn't be kept reliably.",
  alreadyHidden: "This block is already hidden.",
  insideHidden: "The quotation around this block is hidden. Unhide the quotation instead.",
  notHidden: "This block isn't hidden.",
  lastBlock: "Hiding this would leave nothing to read.",
  footnoteReference:
    "This block holds a footnote reference, and its note needs somewhere to return to.",
} as const;

// ── Block layout of the view article (memoized per article object) ─────────

export interface LaidBlock {
  readonly block: Block;
  readonly path: readonly number[];
  readonly key: string;
  readonly depth: number;
  readonly start: number;
  readonly end: number;
}

const layouts = new WeakMap<CanonicalArticle, readonly LaidBlock[]>();

function layoutOf(article: CanonicalArticle): readonly LaidBlock[] {
  let laid = layouts.get(article);
  if (laid) return laid;
  // The pass-through view model already walks every block with D-05 offsets.
  const view = correctionViewFromArticle(article);
  const blockAt = (path: readonly number[]): Block => {
    let block = article.blocks[path[0]!]!;
    for (const i of path.slice(1)) {
      if (block.kind !== "blockquote") break;
      block = block.children[i]!;
    }
    return block;
  };
  laid = view.allBlocks.map((b) => ({
    block: blockAt(b.path),
    path: b.path,
    key: blockPathKey(b.path),
    depth: b.depth,
    start: b.viewStart,
    end: b.viewEnd,
  }));
  layouts.set(article, laid);
  return laid;
}

/** Find a block target in `article` by text. */
export function resolveBlockTarget(
  article: CanonicalArticle,
  target: BlockTarget,
): LaidBlock | "orphan" | "ambiguous" {
  const { clusters } = articleGraphemeIndex(article);
  const exact = graphemeClusters(target.quote.exact, article.lang);
  const laid = layoutOf(article);
  const candidates: LaidBlock[] = [];
  for (const start of findAllOccurrences(clusters, exact)) {
    const end = start + exact.length;
    const block = laid.find(
      (b) =>
        b.start === start &&
        b.end === end &&
        b.block.kind === target.kind &&
        b.depth === target.depth,
    );
    if (block) candidates.push(block);
  }
  if (candidates.length === 0) return "orphan";
  if (candidates.length === 1) return candidates[0]!;
  const narrowed = candidates.filter((b) =>
    matchesContext(clusters, b.start, exact.length, target.quote, article.lang),
  );
  return narrowed.length === 1 ? narrowed[0]! : "ambiguous";
}

/** The text target for the block at `path` in `article`; null when the
 * block has no text to be found by (a figure with no alt or caption). */
export function blockTargetFor(
  article: CanonicalArticle,
  path: readonly number[],
): BlockTarget | null {
  const key = blockPathKey(path);
  const laid = layoutOf(article).find((b) => b.key === key);
  if (!laid || laid.end <= laid.start) return null;
  return {
    quote: deriveQuoteSelector(article, { start: laid.start, end: laid.end }),
    kind: laid.block.kind,
    depth: laid.depth,
  };
}

export function runsHoldReference(runs: readonly InlineRun[]): boolean {
  return runs.some((run) => footnoteRefOf(run) !== undefined);
}

/** Does this block hold a footnote reference (inline or legacy block)? */
export function holdsFootnoteReference(block: Block): boolean {
  switch (block.kind) {
    case "heading":
    case "paragraph":
      return runsHoldReference(block.content);
    case "blockquote":
      return block.children.some(holdsFootnoteReference);
    case "bulleted-list":
    case "numbered-list":
      return block.items.some((item) => item.content.some(holdsFootnoteReference));
    case "figure":
      return runsHoldReference(block.caption);
    case "footnote-reference":
      return true;
    case "code-block":
    case "unsupported":
      return false;
  }
}

export function isHiddenUnder(hidden: ReadonlySet<string>, path: readonly number[]): boolean {
  for (let n = 1; n < path.length; n++) {
    if (hidden.has(blockPathKey(path.slice(0, n)))) return true;
  }
  return false;
}

/** Would the article still have a block to read with `hidden`? */
function anythingLeftToRead(article: CanonicalArticle, hidden: ReadonlySet<string>): boolean {
  return buildCorrectedBlocks(article.blocks, [], hidden).length > 0;
}

// ── Per-kind handlers: validity + state change ─────────────────────────────

type Handler<K extends Correction["kind"]> = (
  state: EngineState,
  correction: Extract<Correction, { kind: K }>,
) => Step;

const KINDS: { [K in Correction["kind"]]: Handler<K> } = {
  hide(state, correction) {
    const found = resolveBlockTarget(state.article, correction.target);
    if (found === "orphan") return { ok: false, reason: REASONS.notFound };
    if (found === "ambiguous") return { ok: false, reason: REASONS.ambiguous };
    const reason = hideRefusal(state, found);
    if (reason) return { ok: false, reason };
    const hidden = new Set(state.hidden);
    hidden.add(found.key);
    return { ok: true, state: { article: state.article, hidden } };
  },
  unhide(state, correction) {
    const found = resolveBlockTarget(state.article, correction.target);
    if (found === "orphan") return { ok: false, reason: REASONS.notFound };
    if (found === "ambiguous") return { ok: false, reason: REASONS.ambiguous };
    if (!state.hidden.has(found.key)) {
      return {
        ok: false,
        reason: isHiddenUnder(state.hidden, found.path) ? REASONS.insideHidden : REASONS.notHidden,
      };
    }
    const hidden = new Set(state.hidden);
    hidden.delete(found.key);
    return { ok: true, state: { article: state.article, hidden } };
  },
  // #75 — split at a separator inside the block (./splitMerge.ts).
  split(state, correction) {
    const found = resolveBlockTarget(state.article, correction.target);
    if (found === "orphan") return { ok: false, reason: REASONS.notFound };
    if (found === "ambiguous") return { ok: false, reason: REASONS.ambiguous };
    if (isHiddenAt(state.hidden, found.path)) {
      return { ok: false, reason: SPLIT_MERGE_REASONS.hiddenBlock };
    }
    const halves = splitBlockAt(found.block, correction.at, state.article.lang);
    if (!halves) return { ok: false, reason: SPLIT_MERGE_REASONS.splitChanged };
    const parent = found.path.slice(0, -1);
    const index = found.path[found.path.length - 1]!;
    return {
      ok: true,
      state: {
        article: replaceAt(state.article, found.path, 1, halves),
        hidden: shiftHidden(state.hidden, parent, index + 1, 1),
      },
    };
  },
  // #75 — merge with the next block, which must still be the one merged.
  merge(state, correction) {
    const found = resolveBlockTarget(state.article, correction.target);
    if (found === "orphan") return { ok: false, reason: REASONS.notFound };
    if (found === "ambiguous") return { ok: false, reason: REASONS.ambiguous };
    if (isHiddenAt(state.hidden, found.path)) {
      return { ok: false, reason: SPLIT_MERGE_REASONS.hiddenBlock };
    }
    const next = nextSibling(state.article, found.path);
    if (
      next === null ||
      next.block.kind !== correction.next.kind ||
      blockNormalizedText(next.block) !== correction.next.quote.exact
    ) {
      return { ok: false, reason: SPLIT_MERGE_REASONS.mergeNextChanged };
    }
    const refusal = mergeRefusal(found.block, next.block, isHiddenAt(state.hidden, next.path));
    if (refusal) return { ok: false, reason: refusal };
    const merged = mergeBlocks(found.block, next.block);
    if (!merged) return { ok: false, reason: SPLIT_MERGE_REASONS.mergeKind };
    const parent = found.path.slice(0, -1);
    const index = found.path[found.path.length - 1]!;
    return {
      ok: true,
      state: {
        article: replaceAt(state.article, found.path, 2, [merged]),
        hidden: shiftHidden(state.hidden, parent, index + 2, -1),
      },
    };
  },
  "set-type": setTypeHandler,
};

/** Hidden itself or inside a hidden quotation. */
function isHiddenAt(hidden: ReadonlySet<string>, path: readonly number[]): boolean {
  return hidden.has(blockPathKey(path)) || isHiddenUnder(hidden, path);
}

/** Engine-level validity of hiding `block` (holds for re-application too). */
function hideRefusal(state: EngineState, block: LaidBlock): string | null {
  if (state.hidden.has(block.key) || isHiddenUnder(state.hidden, block.path)) {
    return REASONS.alreadyHidden;
  }
  if (holdsFootnoteReference(block.block)) return REASONS.footnoteReference;
  const hidden = new Set(state.hidden);
  hidden.add(block.key);
  if (!anythingLeftToRead(state.article, hidden)) return REASONS.lastBlock;
  return null;
}

// ── Building the corrected article ─────────────────────────────────────────

function buildCorrectedBlocks(
  blocks: readonly Block[],
  prefix: readonly number[],
  hidden: ReadonlySet<string>,
): Block[] {
  const out: Block[] = [];
  blocks.forEach((block, i) => {
    const path = [...prefix, i];
    if (hidden.has(blockPathKey(path))) return;
    if (block.kind === "blockquote") {
      const children = buildCorrectedBlocks(block.children, path, hidden);
      // A quotation with every child hidden is absent from reading.
      if (children.length === 0) return;
      const unchanged =
        children.length === block.children.length &&
        children.every((c, j) => c === block.children[j]);
      out.push(unchanged ? block : { ...block, children });
      return;
    }
    out.push(block);
  });
  return out;
}

function finish(
  original: CanonicalArticle,
  state: EngineState,
  outcomes: CorrectionOutcome[],
): CorrectionsResult {
  if (state.article === original && state.hidden.size === 0) {
    return {
      article: original,
      view: correctionViewFromArticle(original),
      outcomes,
      fingerprint: undefined,
    };
  }
  const blocks = buildCorrectedBlocks(state.article.blocks, [], state.hidden);
  // The corrected article never carries the original's frozen structure
  // snapshot: its chapters are derived from the corrected blocks, keeping
  // unchanged chapters' ids and titles (./structure.ts, #72) — and nothing
  // is ever written back onto the original row (ADR 0014).
  const { structure: _frozen, ...rest } = state.article;
  void _frozen;
  const article: { -readonly [K in keyof CanonicalArticle]: CanonicalArticle[K] } = {
    ...rest,
    blocks,
  };
  // The fingerprint is a function of the corrected substrate itself, so two
  // correction lists that read the same (hide then unhide) share a stamp.
  // Over a PDF-repaired original (#78) the repair stamp is folded in, so the
  // same corrections over the repaired and the unrepaired original differ.
  const repaired = original.repairStamp === undefined ? "" : `${original.repairStamp}:`;
  const fingerprint = `c${fingerprintText(repaired + JSON.stringify(blocks))}`;
  registerCorrectionsFingerprint(article, fingerprint);
  // Set on the object itself (not a copy) so the fingerprint registration
  // and every per-object cache stay with the one corrected article.
  const structure = correctedStructure(original, article);
  if (structure !== undefined) article.structure = structure;
  const result: CorrectionsResult = {
    article,
    view: buildCorrectionView(state.article, state.hidden),
    outcomes,
    fingerprint,
  };
  resultsByArticle.set(article, result);
  return result;
}

/** Corrected article → the result that built it (for `isHiddenByCorrections`). */
const resultsByArticle = new WeakMap<CanonicalArticle, CorrectionsResult>();

/**
 * Is this quote (a highlight's words) inside a hidden block of the article
 * being read? Such a highlight is "hidden while its block is hidden": not
 * shown, not orphaned, and it matches again on unhide (spec #68). Accepts
 * the corrected article itself or its corrections result; false for an
 * article no correction built.
 */
export function isHiddenByCorrections(
  shown: CanonicalArticle | CorrectionsResult,
  quote: TextQuoteSelector,
): boolean {
  const result = "view" in shown ? shown : resultsByArticle.get(shown);
  if (!result) return false;
  const inView = resolveQuoteSelector(result.view.article, quote);
  if (typeof inView === "string") return false;
  return result.view.allBlocks.some(
    (b) => b.hidden && b.viewStart <= inView.start && inView.end <= b.viewEnd,
  );
}

function run(original: CanonicalArticle, corrections: readonly Correction[]): CorrectionsResult {
  let state: EngineState = { article: original, hidden: new Set() };
  const outcomes: CorrectionOutcome[] = [];
  for (const correction of corrections) {
    const handler = KINDS[correction.kind] as Handler<typeof correction.kind>;
    const step = handler(state, correction as never);
    if (step.ok) {
      state = step.state;
      outcomes.push(
        step.dropped && step.dropped.length > 0
          ? { status: "applied", droppedMarks: step.dropped }
          : { status: "applied" },
      );
    } else {
      outcomes.push({ status: "not-applied", reason: step.reason });
    }
  }
  return finish(original, state, outcomes);
}

const memo = new WeakMap<
  CanonicalArticle,
  { corrections: readonly Correction[]; result: CorrectionsResult }
>();
const EMPTY: readonly Correction[] = [];

/**
 * THE engine: the original article plus its ordered corrections → the
 * corrected article, the correction-view model and an outcome per
 * correction. Pure; memoized on (original, corrections) identity.
 */
export function applyCorrections(
  original: CanonicalArticle,
  corrections: readonly Correction[] = EMPTY,
): CorrectionsResult {
  const cached = memo.get(original);
  if (
    cached &&
    (cached.corrections === corrections ||
      (corrections.length === 0 && cached.corrections.length === 0))
  ) {
    return cached.result;
  }
  const result = run(original, corrections);
  memo.set(original, { corrections, result });
  return result;
}

/** Convenience: just the corrected article. */
export function correctedArticle(
  original: CanonicalArticle,
  corrections: readonly Correction[] | undefined,
): CanonicalArticle {
  if (!corrections || corrections.length === 0) return original;
  return applyCorrections(original, corrections).article;
}

// ── Command availability (the Correction view's Hide / Unhide) ─────────────

export type Availability =
  { readonly available: true } | { readonly available: false; readonly reason: string };

export function engineStateOf(result: CorrectionsResult): EngineState {
  const hidden = new Set<string>();
  for (const b of result.view.allBlocks) if (b.hiddenDirectly) hidden.add(blockPathKey(b.path));
  return { article: result.view.article, hidden };
}

function laidFor(result: CorrectionsResult, block: CorrectionViewBlock): LaidBlock | undefined {
  const key = blockPathKey(block.path);
  return layoutOf(result.view.article).find((b) => b.key === key);
}

/** Can the reader hide this block now? (Engine validity only: a hide with
 * side effects — a heading's chapter, a highlight in the block — is
 * available and goes through the consequences step first, #72.) */
export function hideAvailability(
  result: CorrectionsResult,
  block: CorrectionViewBlock,
): Availability {
  const laid = laidFor(result, block);
  if (!laid) return { available: false, reason: REASONS.notFound };
  if (laid.end <= laid.start) return { available: false, reason: REASONS.noText };
  const state = engineStateOf(result);
  const refusal = hideRefusal(state, laid);
  if (refusal) return { available: false, reason: refusal };
  // The target must be findable again: unique by text in this article.
  const target = blockTargetFor(result.view.article, block.path);
  if (!target || resolveBlockTarget(result.view.article, target) !== laid) {
    return { available: false, reason: REASONS.ambiguous };
  }
  return { available: true };
}

/** Can the reader unhide this block now? */
export function unhideAvailability(block: CorrectionViewBlock): Availability {
  if (block.hiddenDirectly) return { available: true };
  if (block.hidden) return { available: false, reason: REASONS.insideHidden };
  return { available: false, reason: REASONS.notHidden };
}

/** The view block's laid entry when it is targetable: present, with text,
 * and found again uniquely by that text. A string is the reason not. */
function targetableLaid(result: CorrectionsResult, block: CorrectionViewBlock): LaidBlock | string {
  const laid = laidFor(result, block);
  if (!laid) return REASONS.notFound;
  if (laid.end <= laid.start) return REASONS.noText;
  const target = blockTargetFor(result.view.article, block.path);
  if (!target || resolveBlockTarget(result.view.article, target) !== laid) {
    return REASONS.ambiguous;
  }
  return laid;
}

/** Can the reader split this block at `caret` (an offset into the block's
 * own normalized text; null = no caret in it)? (#75) */
export function splitAvailability(
  result: CorrectionsResult,
  block: CorrectionViewBlock,
  caret: number | null,
): Availability {
  if (block.hidden) return { available: false, reason: SPLIT_MERGE_REASONS.hiddenBlock };
  const laid = targetableLaid(result, block);
  if (typeof laid === "string") return { available: false, reason: laid };
  const at = splitPoint(laid.block, caret, result.view.article.lang);
  if (typeof at === "string") return { available: false, reason: at };
  if (!splitBlockAt(laid.block, at, result.view.article.lang)) {
    return { available: false, reason: SPLIT_MERGE_REASONS.splitMidWord };
  }
  return { available: true };
}

/** Can the reader merge this block with the next one? (#75) */
export function mergeAvailability(
  result: CorrectionsResult,
  block: CorrectionViewBlock,
): Availability {
  if (block.hidden) return { available: false, reason: SPLIT_MERGE_REASONS.hiddenBlock };
  const laid = targetableLaid(result, block);
  if (typeof laid === "string") return { available: false, reason: laid };
  const next = nextSibling(result.view.article, laid.path);
  const nextHidden =
    next !== null && result.view.blockById(correctionBlockId(next.path))?.hidden === true;
  const refusal = mergeRefusal(laid.block, next?.block ?? null, nextHidden);
  if (refusal) return { available: false, reason: refusal };
  if (
    !next ||
    !blockTargetFor(result.view.article, next.path) ||
    !mergeBlocks(laid.block, next.block)
  ) {
    return { available: false, reason: SPLIT_MERGE_REASONS.mergeKind };
  }
  return { available: true };
}

/** Build the split correction for a view block at `caret` (null when it
 * isn't available there). */
export function splitCorrection(
  result: CorrectionsResult,
  block: CorrectionViewBlock,
  caret: number | null,
  meta: { id: string; createdAt: string },
): Correction | null {
  if (!splitAvailability(result, block, caret).available) return null;
  const target = blockTargetFor(result.view.article, block.path);
  const laid = laidFor(result, block);
  if (!target || !laid) return null;
  const at = splitPoint(laid.block, caret, result.view.article.lang);
  if (typeof at === "string") return null;
  return { kind: "split", id: meta.id, createdAt: meta.createdAt, target, at };
}

/** Build the merge-with-next correction for a view block (null when it
 * isn't available). */
export function mergeCorrection(
  result: CorrectionsResult,
  block: CorrectionViewBlock,
  meta: { id: string; createdAt: string },
): Correction | null {
  if (!mergeAvailability(result, block).available) return null;
  const target = blockTargetFor(result.view.article, block.path);
  const next = nextSibling(result.view.article, block.path);
  const nextTarget = next && blockTargetFor(result.view.article, next.path);
  if (!target || !nextTarget) return null;
  return { kind: "merge", id: meta.id, createdAt: meta.createdAt, target, next: nextTarget };
}

/** Build the hide / unhide correction for a view block (the caller checked
 * availability). Null when the block has no text to target. */
export function blockCorrection(
  kind: "hide" | "unhide",
  result: CorrectionsResult,
  block: CorrectionViewBlock,
  meta: { id: string; createdAt: string },
): Correction | null {
  const target = blockTargetFor(result.view.article, block.path);
  if (!target) return null;
  return { kind, id: meta.id, createdAt: meta.createdAt, target };
}
