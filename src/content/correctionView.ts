// src/content/correctionView.ts
// Spec #68 / issues #70, #71 — the correction-view model: what the
// Correction view renders. Every block of the article (hidden blocks
// included, marked hidden), each with its type in words and a stable
// identity for focus and selection within the view.
//
// The correction engine (src/content/corrections/engine.ts) is the one
// producer: it returns a corrected article AND a model of this shape, built
// by `buildCorrectionView` over the view article (every block) and the set
// of hidden block keys. An uncorrected article's model
// (`correctionViewFromArticle`) has exactly one entry per block, none
// hidden, and the view's coordinates ARE the reading coordinates.
//
// Coordinates: `article` is what the view renders, so offsets inside the
// view are D-05 grapheme offsets over `article`. Reading positions live in
// the corrected article's coordinates. The two maps translate between them
// for the enter/leave landing: a hidden block spends view offsets but no
// reading offsets. They are derived from the same block walk that defines
// the corrected article (hidden blocks and their separators drop out), so
// they agree with `articleGraphemeIndex(corrected)` exactly.

import { articleGraphemeIndex, blockNormalizedText, graphemeClusters } from "./normalizeText";
import type { Block, CanonicalArticle } from "./types";

export interface CorrectionViewBlock {
  /** Stable identity within the view (focus, selection, commands). */
  readonly id: string;
  /** Index into `model.article.blocks` (the top-level ancestor for a block
   * inside a quotation). */
  readonly index: number;
  /** Path into the view article: [top-level index, child index, …]. */
  readonly path: readonly number[];
  /** 0 = top level, 1 = inside one quotation, … */
  readonly depth: number;
  /** The block's type in words, e.g. "Paragraph", "Heading 2". */
  readonly label: string;
  /** A hidden block (itself, or inside a hidden quotation): shown dimmed
   * and labelled in the view, absent from reading. */
  readonly hidden: boolean;
  /** Hidden by its own hide correction (only these can be unhidden). */
  readonly hiddenDirectly: boolean;
  /** [viewStart, viewEnd) — D-05 offsets over the view article. */
  readonly viewStart: number;
  readonly viewEnd: number;
  /** [readingStart, readingEnd) over the corrected article; null when hidden. */
  readonly readingStart: number | null;
  readonly readingEnd: number | null;
  /** A quotation's children (correctable one by one); absent otherwise. */
  readonly children?: readonly CorrectionViewBlock[];
}

export interface CorrectionViewModel {
  /** The article the view renders (every block, hidden ones included). */
  readonly article: CanonicalArticle;
  /** One entry per `article.blocks[i]`, in order (quotation children nest). */
  readonly blocks: readonly CorrectionViewBlock[];
  /** Every block, top-level and nested, in document order. */
  readonly allBlocks: readonly CorrectionViewBlock[];
  /** Look a block up by its view identity. */
  blockById(id: string): CorrectionViewBlock | undefined;
  /** Reading-position offset → offset in the view's article. */
  viewOffsetFor(readingOffset: number): number;
  /** Offset in the view's article → reading-position offset. */
  readingOffsetFor(viewOffset: number): number;
}

/** A block's type in words — the label the view shows and announces. */
export function blockTypeLabel(block: Block): string {
  switch (block.kind) {
    case "heading":
      return `Heading ${block.level}`;
    case "paragraph":
      return "Paragraph";
    case "blockquote":
      return "Quotation";
    case "code-block":
      return "Code";
    case "figure":
      return block.caption.length > 0 ? "Figure with caption" : "Figure";
    case "bulleted-list":
      return "Bulleted list";
    case "numbered-list":
      return "Numbered list";
    case "footnote-reference":
      return "Footnote reference";
    case "unsupported":
      return "Unsupported content";
  }
}

/** The key a block path is known by (view ids and the engine's hidden set). */
export function blockPathKey(path: readonly number[]): string {
  return path.join(".");
}

/** The view identity of the block at `path`. */
export function correctionBlockId(path: readonly number[]): string {
  return `block-${blockPathKey(path)}`;
}

interface Segment {
  viewStart: number;
  length: number;
  readingStart: number | null;
}

/**
 * Build the view model for `article` (the view article — every block) with
 * the blocks whose path keys are in `hiddenKeys` hidden. A quotation whose
 * children are all hidden is itself absent from reading (the engine drops
 * it), so it reads as hidden here too.
 */
export function buildCorrectionView(
  article: CanonicalArticle,
  hiddenKeys: ReadonlySet<string>,
): CorrectionViewModel {
  const index = articleGraphemeIndex(article);
  const segments: Segment[] = [];
  const allBlocks: CorrectionViewBlock[] = [];
  const lang = article.lang;

  const walk = (
    children: readonly Block[],
    prefix: readonly number[],
    viewBase: number,
    readingBase: number,
    ancestorHidden: boolean,
  ): { nodes: CorrectionViewBlock[]; readingLen: number; anyVisible: boolean } => {
    let v = viewBase;
    let r = readingBase;
    let anyVisible = false;
    const nodes: CorrectionViewBlock[] = [];
    children.forEach((block, i) => {
      if (i > 0) v += 1;
      const path = [...prefix, i];
      const key = blockPathKey(path);
      const hiddenDirectly = hiddenKeys.has(key);
      const hiddenHere = ancestorHidden || hiddenDirectly;
      const viewLen =
        prefix.length === 0
          ? (index.perBlockLengths[i] ?? 0)
          : graphemeClusters(blockNormalizedText(block), lang).length;
      const rStart = r + (anyVisible ? 1 : 0);
      const depth = prefix.length;
      const placeholderIndex = allBlocks.length;
      allBlocks.push(undefined as unknown as CorrectionViewBlock); // document order
      let visible: boolean;
      let readingLen: number;
      let childNodes: CorrectionViewBlock[] | undefined;
      if (block.kind === "blockquote") {
        const sub = walk(block.children, path, v, rStart, hiddenHere);
        visible = !hiddenHere && sub.anyVisible;
        readingLen = sub.readingLen;
        childNodes = sub.nodes;
      } else {
        visible = !hiddenHere;
        readingLen = viewLen;
        segments.push({ viewStart: v, length: viewLen, readingStart: visible ? rStart : null });
      }
      const node: CorrectionViewBlock = {
        id: correctionBlockId(path),
        index: path[0]!,
        path,
        depth,
        label: blockTypeLabel(block),
        hidden: !visible,
        hiddenDirectly,
        viewStart: v,
        viewEnd: v + viewLen,
        readingStart: visible ? rStart : null,
        readingEnd: visible ? rStart + readingLen : null,
        ...(childNodes ? { children: childNodes } : {}),
      };
      allBlocks[placeholderIndex] = node;
      nodes.push(node);
      if (visible) {
        r = rStart + readingLen;
        anyVisible = true;
      }
      v += viewLen;
    });
    return { nodes, readingLen: r - readingBase, anyVisible };
  };

  const top = walk(article.blocks, [], 0, 0, false);
  // The notes region follows the body in both coordinate streams
  // (normalizeText's `[body, notes].filter(Boolean).join(SEP)`).
  const firstRow = index.footnoteRows[0];
  if (firstRow !== undefined) {
    segments.push({
      viewStart: firstRow.start,
      length: index.totalGraphemes - firstRow.start,
      readingStart: top.readingLen > 0 ? top.readingLen + 1 : 0,
    });
  }
  const readingTotal = segments.reduce(
    (end, s) => (s.readingStart === null ? end : Math.max(end, s.readingStart + s.length)),
    0,
  );
  const byId = new Map(allBlocks.map((b) => [b.id, b]));

  const noneHidden = segments.every((s) => s.readingStart === s.viewStart);
  return {
    article,
    blocks: top.nodes,
    allBlocks,
    blockById: (id) => byId.get(id),
    viewOffsetFor: noneHidden
      ? (offset) => offset
      : (readingOffset) => {
          for (const s of segments) {
            if (s.readingStart === null) continue;
            if (readingOffset <= s.readingStart + s.length) {
              return s.viewStart + Math.max(0, readingOffset - s.readingStart);
            }
          }
          return index.totalGraphemes;
        },
    readingOffsetFor: noneHidden
      ? (offset) => offset
      : (viewOffset) => {
          let pendingHidden = false;
          for (const s of segments) {
            if (s.readingStart === null) {
              if (viewOffset <= s.viewStart + s.length) pendingHidden = true;
              continue;
            }
            // A hidden block lands on the next passage that is still read.
            if (pendingHidden) return s.readingStart;
            if (viewOffset <= s.viewStart + s.length) {
              return s.readingStart + Math.max(0, viewOffset - s.viewStart);
            }
          }
          return readingTotal;
        },
  };
}

const passThroughViews = new WeakMap<CanonicalArticle, CorrectionViewModel>();

/** The model for an article with no corrections: its own blocks, none hidden. */
export function correctionViewFromArticle(article: CanonicalArticle): CorrectionViewModel {
  let model = passThroughViews.get(article);
  if (!model) {
    model = buildCorrectionView(article, new Set());
    passThroughViews.set(article, model);
  }
  return model;
}
