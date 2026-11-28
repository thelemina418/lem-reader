// src/content/corrections/setType.ts
// Spec #68 / issue #74 — the "set-type" correction kind: give a block a
// different type. Validity and the state change both live here, so the
// Correction view's "unavailable because…" and re-application's "not applied
// because…" come from one place (the engine's `KINDS`).
//
// The conversions (the words never change; only what holds them does):
//   - paragraph ↔ heading (any level 1–6), heading level changes — the
//     inline runs move across untouched, marks included;
//   - → quotation wraps the block in a quotation of its own; a quotation
//     → paragraph lifts its blocks back out (ordinary paragraphs again);
//   - → code block keeps the text and drops the marks (a code block holds
//     plain text only) — the dropped marks are reported so the reader is
//     told first; a block holding a footnote reference can't become code
//     (the reference is part of the text and its note's return target);
//     code → paragraph / heading keeps the source verbatim as one run, so a
//     round trip keeps the text and its spacing;
//   - paragraph → caption: the paragraph becomes the caption of the figure
//     next to it (the one before it first); on a figure, "paragraph" takes
//     its caption out as a paragraph right after it. Either way the D-05
//     text is unchanged when the caption joins an empty one: the figure's
//     caption sits one separator after its alt text, exactly where the
//     paragraph sat.
//
// Structure-changing conversions (wrap, unwrap, caption in / out) move the
// path keys of the blocks after them; the hidden set is re-keyed so a block
// hidden earlier stays hidden. A hidden block itself can't change type.

import { normalizeRunText, inlineText } from "../normalizeText";
import { blockPathKey, type CorrectionViewBlock } from "../correctionView";
import type { Block, InlineRun } from "../types";
import type { BlockTypeChoice, Correction } from "../schema";
import {
  HIDE_REASONS,
  blockTargetFor,
  engineStateOf,
  isHiddenUnder,
  resolveBlockTarget,
  runsHoldReference,
  type DroppedMark,
  type EngineState,
  type Availability,
  type CorrectionsResult,
  type LaidBlock,
  type Step,
} from "./engine";

export const SET_TYPE_REASONS = {
  hidden: "This block is hidden. Unhide it first.",
  onlyHide: "This kind of block can only be hidden.",
  codeFootnote:
    "This block holds a footnote reference, and a code block can't keep it: its note needs somewhere to return to.",
  insideQuotation: "This block is already inside a quotation.",
  alreadyQuotation: "This block is already a quotation.",
  quotationInto: "Turn the quotation into paragraphs first.",
  figureInto: "A figure can't become that. Its caption can become a paragraph.",
  noCaption: "This figure has no caption to turn into a paragraph.",
  captionFromParagraph: "Only a paragraph can become a caption.",
  noFigure: "There's no figure right before or after this paragraph.",
  noCodeText: "This code block has no text to keep.",
} as const;

/** The type choices the Correction view offers, in menu order. */
export const BLOCK_TYPE_CHOICES: readonly {
  readonly to: BlockTypeChoice;
  readonly label: string;
}[] = [
  { to: { type: "paragraph" }, label: "Paragraph" },
  ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({
    to: { type: "heading", level } as BlockTypeChoice,
    label: `Heading ${level}`,
  })),
  { to: { type: "quotation" }, label: "Quotation" },
  { to: { type: "caption" }, label: "Caption" },
  { to: { type: "code-block" }, label: "Code block" },
];

/** The choice in words ("Heading 2", "Code block"). */
export function blockTypeChoiceLabel(to: BlockTypeChoice): string {
  return to.type === "heading"
    ? `Heading ${to.level}`
    : BLOCK_TYPE_CHOICES.find((c) => c.to.type === to.type)!.label;
}

// ── Sibling-list editing and hidden-key re-keying ──────────────────────────

/** Replace the sibling list under `parent` (a path of quotation indices). */
function editSiblings(
  blocks: readonly Block[],
  parent: readonly number[],
  edit: (siblings: Block[]) => Block[],
): Block[] {
  if (parent.length === 0) return edit([...blocks]);
  const [i, ...rest] = parent;
  const quote = blocks[i!]!;
  if (quote.kind !== "blockquote") return [...blocks];
  const copy = [...blocks];
  copy[i!] = { ...quote, children: editSiblings(quote.children, rest, edit) };
  return copy;
}

type PathMap = (path: readonly number[]) => readonly number[] | null;

function rekey(hidden: ReadonlySet<string>, map: PathMap): Set<string> {
  const out = new Set<string>();
  for (const key of hidden) {
    const mapped = map(key.split(".").map(Number));
    if (mapped !== null) out.add(blockPathKey(mapped));
  }
  return out;
}

/** Is `path` a sibling-or-descendant of position `index` under `parent`? */
function under(path: readonly number[], parent: readonly number[]): boolean {
  return path.length > parent.length && parent.every((p, n) => path[n] === p);
}

/** Sibling indices after `index` under `parent` shift by `delta`. */
function shiftAfter(parent: readonly number[], index: number, delta: number): PathMap {
  return (path) => {
    if (!under(path, parent)) return path;
    const at = path[parent.length]!;
    if (at <= index) return path;
    const out = [...path];
    out[parent.length] = at + delta;
    return out;
  };
}

// ── Conversions ─────────────────────────────────────────────────────────────

const MARK_NAMES = new Set(["link", "em", "strong", "code"]);

function droppedMarksOf(runs: readonly InlineRun[]): DroppedMark[] {
  const out: DroppedMark[] = [];
  for (const run of runs) {
    const text = normalizeRunText(run.text);
    if (text.length === 0) continue;
    for (const mark of run.marks) {
      if (MARK_NAMES.has(mark.type)) out.push({ mark: mark.type as DroppedMark["mark"], text });
    }
  }
  return out;
}

/** A code block's source for these runs: a lone run verbatim (so a code →
 * paragraph → code round trip keeps its spacing), otherwise the runs'
 * normalized text (the D-05 text, unchanged). */
function sourceOf(runs: readonly InlineRun[]): string {
  return runs.length === 1 ? runs[0]!.text : inlineText(runs);
}

/** The runs a code block's source becomes (one plain run, verbatim). */
function runsOf(source: string): InlineRun[] {
  return [{ text: source, marks: [] }];
}

/** Text-holding blocks a paragraph / heading / code conversion reads. */
function runsOrSource(block: Block): readonly InlineRun[] | null {
  if (block.kind === "paragraph" || block.kind === "heading") return block.content;
  if (block.kind === "code-block") return runsOf(block.source);
  return null;
}

/** A whitespace-only run between two run lists, so they read as two words
 * apart (never glued at a footnote reference's edge — runSeparators). */
const GAP: InlineRun = { text: " ", marks: [] };

function joinRuns(first: readonly InlineRun[], second: readonly InlineRun[]): InlineRun[] {
  if (first.length === 0) return [...second];
  if (second.length === 0) return [...first];
  return [...first, GAP, ...second];
}

interface Change {
  readonly blocks: Block[];
  readonly rekey?: PathMap;
  readonly dropped?: readonly DroppedMark[];
}

type Converted = Change | { readonly refusal: string };

function convert(state: EngineState, laid: LaidBlock, to: BlockTypeChoice): Converted {
  const { block, path } = laid;
  const parent = path.slice(0, -1);
  const index = path[path.length - 1]!;
  const replace = (next: Block): Change => ({
    blocks: editSiblings(state.article.blocks, parent, (siblings) => {
      siblings[index] = next;
      return siblings;
    }),
  });
  const already = (label: string) => ({ refusal: `This block is already ${label}.` });

  switch (to.type) {
    case "paragraph": {
      if (block.kind === "paragraph") return already("a paragraph");
      if (block.kind === "heading") return replace({ kind: "paragraph", content: block.content });
      if (block.kind === "code-block") {
        if (normalizeRunText(block.source).length === 0) {
          return { refusal: SET_TYPE_REASONS.noCodeText };
        }
        return replace({ kind: "paragraph", content: runsOf(block.source) });
      }
      if (block.kind === "blockquote") {
        const n = block.children.length;
        return {
          blocks: editSiblings(state.article.blocks, parent, (siblings) => {
            siblings.splice(index, 1, ...block.children);
            return siblings;
          }),
          rekey: (p) => {
            if (!under(p, parent)) return p;
            const at = p[parent.length]!;
            if (at < index) return p;
            if (at === index) {
              // A child of the quotation moves up a level.
              if (p.length === parent.length + 1) return null;
              return [...parent, index + p[parent.length + 1]!, ...p.slice(parent.length + 2)];
            }
            const out = [...p];
            out[parent.length] = at + n - 1;
            return out;
          },
        };
      }
      if (block.kind === "figure") {
        if (block.caption.length === 0) return { refusal: SET_TYPE_REASONS.noCaption };
        const caption = block.caption;
        return {
          blocks: editSiblings(state.article.blocks, parent, (siblings) => {
            siblings.splice(
              index,
              1,
              { ...block, caption: [] },
              {
                kind: "paragraph",
                content: caption,
              },
            );
            return siblings;
          }),
          rekey: shiftAfter(parent, index, 1),
        };
      }
      return { refusal: SET_TYPE_REASONS.onlyHide };
    }
    case "heading": {
      if (block.kind === "heading" && block.level === to.level) {
        return already(`Heading ${to.level}`);
      }
      if (block.kind === "blockquote") return { refusal: SET_TYPE_REASONS.quotationInto };
      if (block.kind === "figure") return { refusal: SET_TYPE_REASONS.figureInto };
      const runs = runsOrSource(block);
      if (runs === null) return { refusal: SET_TYPE_REASONS.onlyHide };
      if (block.kind === "code-block" && normalizeRunText(block.source).length === 0) {
        return { refusal: SET_TYPE_REASONS.noCodeText };
      }
      return replace({ kind: "heading", level: to.level, content: [...runs] });
    }
    case "quotation": {
      if (block.kind === "blockquote") return { refusal: SET_TYPE_REASONS.alreadyQuotation };
      if (block.kind === "figure") return { refusal: SET_TYPE_REASONS.figureInto };
      if (block.kind !== "paragraph" && block.kind !== "heading" && block.kind !== "code-block") {
        return { refusal: SET_TYPE_REASONS.onlyHide };
      }
      if (laid.depth > 0) return { refusal: SET_TYPE_REASONS.insideQuotation };
      return {
        ...replace({ kind: "blockquote", children: [block] }),
        rekey: (p) => {
          if (!under(p, parent) || p[parent.length] !== index) return p;
          return [...p.slice(0, parent.length + 1), 0, ...p.slice(parent.length + 1)];
        },
      };
    }
    case "code-block": {
      if (block.kind === "code-block") return already("a code block");
      if (block.kind === "blockquote") return { refusal: SET_TYPE_REASONS.quotationInto };
      if (block.kind === "figure") return { refusal: SET_TYPE_REASONS.figureInto };
      if (block.kind !== "paragraph" && block.kind !== "heading") {
        return { refusal: SET_TYPE_REASONS.onlyHide };
      }
      if (runsHoldReference(block.content)) return { refusal: SET_TYPE_REASONS.codeFootnote };
      const dropped = droppedMarksOf(block.content);
      return {
        ...replace({ kind: "code-block", source: sourceOf(block.content) }),
        ...(dropped.length > 0 ? { dropped } : {}),
      };
    }
    case "caption": {
      if (block.kind === "figure") return already("a figure");
      if (block.kind !== "paragraph") return { refusal: SET_TYPE_REASONS.captionFromParagraph };
      // A hidden figure isn't "next to" anything the reader sees.
      const siblingAt = (i: number): Block | undefined =>
        state.hidden.has(blockPathKey([...parent, i]))
          ? undefined
          : siblingsAt(state.article.blocks, parent)[i];
      const before = siblingAt(index - 1);
      const after = siblingAt(index + 1);
      const figureIndex =
        before?.kind === "figure" ? index - 1 : after?.kind === "figure" ? index + 1 : null;
      if (figureIndex === null) return { refusal: SET_TYPE_REASONS.noFigure };
      return {
        blocks: editSiblings(state.article.blocks, parent, (siblings) => {
          const figure = siblings[figureIndex]!;
          if (figure.kind !== "figure") return siblings;
          const caption =
            figureIndex < index
              ? joinRuns(figure.caption, block.content)
              : joinRuns(block.content, figure.caption);
          siblings[figureIndex] = { ...figure, caption };
          siblings.splice(index, 1);
          return siblings;
        }),
        rekey: (p) =>
          under(p, parent) && p[parent.length] === index ? null : shiftAfter(parent, index, -1)(p),
      };
    }
  }
}

function siblingsAt(blocks: readonly Block[], parent: readonly number[]): readonly Block[] {
  let list = blocks;
  for (const i of parent) {
    const quote = list[i];
    if (quote?.kind !== "blockquote") return [];
    list = quote.children;
  }
  return list;
}

/** The engine handler for "set-type" (validity + state change). */
export function setTypeHandler(
  state: EngineState,
  correction: Extract<Correction, { kind: "set-type" }>,
): Step {
  const found = resolveBlockTarget(state.article, correction.target);
  if (found === "orphan") return { ok: false, reason: HIDE_REASONS.notFound };
  if (found === "ambiguous") return { ok: false, reason: HIDE_REASONS.ambiguous };
  if (state.hidden.has(found.key) || isHiddenUnder(state.hidden, found.path)) {
    return { ok: false, reason: SET_TYPE_REASONS.hidden };
  }
  const change = convert(state, found, correction.to);
  if ("refusal" in change) return { ok: false, reason: change.refusal };
  const hidden = change.rekey ? rekey(state.hidden, change.rekey) : new Set(state.hidden);
  return {
    ok: true,
    state: { article: { ...state.article, blocks: change.blocks }, hidden },
    ...(change.dropped ? { dropped: change.dropped } : {}),
  };
}

// ── Command availability and building (the Correction view's Change type) ──

/** Can the reader give this view block the type `to` now? (Engine validity:
 * a change with side effects — a new or lost chapter, dropped marks, a
 * highlight that no longer matches — is available and goes through the
 * consequences step first.) */
export function setTypeAvailability(
  result: CorrectionsResult,
  block: CorrectionViewBlock,
  to: BlockTypeChoice,
): Availability {
  const correction = setTypeCorrection(result, block, to, {
    id: "availability",
    createdAt: new Date(0).toISOString(),
  });
  if (!correction) return { available: false, reason: HIDE_REASONS.noText };
  const state = engineStateOf(result);
  const found = resolveBlockTarget(state.article, correction.target);
  if (found === "orphan") return { available: false, reason: HIDE_REASONS.notFound };
  if (found === "ambiguous" || found.key !== blockPathKey(block.path)) {
    return { available: false, reason: HIDE_REASONS.ambiguous };
  }
  const step = setTypeHandler(state, correction);
  return step.ok ? { available: true } : { available: false, reason: step.reason };
}

/** Build the set-type correction for a view block (the caller checked
 * availability). Null when the block has no text to target. */
export function setTypeCorrection(
  result: CorrectionsResult,
  block: CorrectionViewBlock,
  to: BlockTypeChoice,
  meta: { id: string; createdAt: string },
): Extract<Correction, { kind: "set-type" }> | null {
  const target = blockTargetFor(result.view.article, block.path);
  if (!target) return null;
  return { kind: "set-type", id: meta.id, createdAt: meta.createdAt, target, to };
}
