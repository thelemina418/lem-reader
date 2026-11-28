import type { Block, InlineRun } from "../src/content/schema";
/**
 * isCaptionLookingParagraph — the conservative caption heuristic. True only
 * for a SHORT paragraph that either opens with a caption keyword or is
 * entirely em-marked (publishers italicize standalone caption lines). A
 * single false negative just means the text stays a calm body paragraph; a
 * false positive would move one short line into the caption channel.
 */
export declare function isCaptionLookingParagraph(block: Block): boolean;
/**
 * withCaption — attach caption runs to the FIRST figure of a figureBlock()
 * result (a bare img yields [figure] or [unsupported]; the caption only
 * belongs to the figure arm). Edge whitespace is trimmed off the first/last
 * run (mirroring normalizeRunText's trim — the caption segment after an img
 * typically opens with the source's inter-node space) and empty results
 * leave the blocks byte-stable.
 *
 * Unlike the adjacent-paragraph pass below, the same-paragraph path applies
 * NO length cap: the signal is the publisher's own structure (the text lives
 * INSIDE the image's paragraph, after the img), and attaching restores the
 * source reading order — the uncapped alternative is the exact issue #19 bug
 * (that text rendered as a body paragraph above the image). The length cap
 * earns its keep where the signal is weak: cross-paragraph adjacency.
 */
export declare function withCaption(blocks: Block[], caption: InlineRun[]): Block[];
/**
 * attachAdjacentCaptions — the adjacent-paragraph pass, run over a flattened
 * sibling list at every container level (root, blockquote children, list
 * items, recursed containers) in both adapters. Idempotent: a consumed
 * paragraph is removed and an attached figure's caption becomes non-empty,
 * so no paragraph feeds two figures and no figure gains two captions.
 *
 * Pass A (below-convention, scanned right-to-left): a caption-looking
 * paragraph AFTER a caption-empty figure binds to the figure ABOVE it —
 * captions sit below images in published output, so a paragraph sandwiched
 * between two figures is claimed by the upper figure first.
 *
 * Pass B (the issue #19 bug): a caption-looking paragraph BEFORE a
 * caption-empty figure binds to the figure BELOW it, moving caption text
 * that rendered as a body paragraph above the image into the figcaption.
 */
export declare function attachAdjacentCaptions(blocks: Block[]): Block[];
