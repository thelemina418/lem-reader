// src/content/correctionView.ts
// Spec #68 / issue #70 — the correction-view model: what the Correction view
// renders. Every block of the article (hidden blocks included, marked hidden
// once hiding exists), each with its type in words and a stable identity for
// focus and selection within the view.
//
// This is the seam the correction engine (#71) feeds: the engine returns a
// corrected article AND a model of this shape. Until corrections exist the
// view is built straight from the article's blocks by
// `correctionViewFromArticle` — the model then has exactly one entry per
// block, none hidden, and the view's coordinates ARE the reading
// coordinates (both offset maps are the identity).
//
// Coordinates: `article` is what the view renders, so offsets inside the
// view are D-05 grapheme offsets over `article`. Reading positions live in
// the corrected article's coordinates. The two maps translate between them
// for the enter/leave landing; once hidden blocks exist they differ (a
// hidden block spends view offsets but no reading offsets), and the engine
// supplies maps that resolve through text, not block index (ADR 0014).

import type { Block, CanonicalArticle } from "./types";

export interface CorrectionViewBlock {
  /** Stable identity within the view (focus, selection, commands). */
  readonly id: string;
  /** Index into `model.article.blocks`. */
  readonly index: number;
  /** The block's type in words, e.g. "Paragraph", "Heading 2". */
  readonly label: string;
  /** A hidden block: shown dimmed and labelled in the view, absent from reading. */
  readonly hidden: boolean;
}

export interface CorrectionViewModel {
  /** The article the view renders (every block, hidden ones included). */
  readonly article: CanonicalArticle;
  /** One entry per `article.blocks[i]`, in order. */
  readonly blocks: readonly CorrectionViewBlock[];
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

const identity = (offset: number) => offset;

/** The model for an article with no corrections: its own blocks, none hidden. */
export function correctionViewFromArticle(article: CanonicalArticle): CorrectionViewModel {
  return {
    article,
    blocks: article.blocks.map((block, index) => ({
      id: `block-${index}`,
      index,
      label: blockTypeLabel(block),
      hidden: false,
    })),
    viewOffsetFor: identity,
    readingOffsetFor: identity,
  };
}
