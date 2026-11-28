/** Captions are short — anything longer is body prose, never consumed. */
const CAPTION_MAX_CHARS = 200;
/** A caption opens with a media-noun keyword ("Figure 2: …", "Photo: …"). */
const CAPTION_KEYWORD = /^(?:figure|fig|image|photo|photograph|illustration|diagram|chart|graph|map|plate|table)\b/i;
/**
 * isCaptionLookingParagraph — the conservative caption heuristic. True only
 * for a SHORT paragraph that either opens with a caption keyword or is
 * entirely em-marked (publishers italicize standalone caption lines). A
 * single false negative just means the text stays a calm body paragraph; a
 * false positive would move one short line into the caption channel.
 */
export function isCaptionLookingParagraph(block) {
    if (block.kind !== "paragraph")
        return false;
    if (block.content.length === 0)
        return false;
    const text = block.content
        .map((r) => r.text)
        .join("")
        .replace(/\s+/g, " ")
        .trim();
    if (text.length === 0 || text.length > CAPTION_MAX_CHARS)
        return false;
    if (CAPTION_KEYWORD.test(text))
        return true;
    return block.content.every((r) => r.marks.some((m) => m.type === "em"));
}
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
export function withCaption(blocks, caption) {
    const trimmed = trimCaptionEdges(caption);
    const first = blocks[0];
    if (trimmed.length > 0 && first !== undefined && first.kind === "figure") {
        return [{ ...first, caption: trimmed }, ...blocks.slice(1)];
    }
    return blocks;
}
/** Trim edge whitespace off the caption runs' first/last text. Interior
 * spacing, run boundaries, and marks are untouched — only the caption's
 * outer edges, which the D-05 layer (normalizeRunText) trims anyway. */
function trimCaptionEdges(runs) {
    if (runs.length === 0)
        return runs;
    const out = runs.map((r) => ({ ...r }));
    out[0].text = out[0].text.replace(/^\s+/, "");
    const last = out[out.length - 1];
    last.text = last.text.replace(/\s+$/, "");
    return out.filter((r) => r.text.length > 0);
}
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
export function attachAdjacentCaptions(blocks) {
    const out = blocks.slice();
    for (let i = out.length - 1; i >= 0; i--) {
        const block = out[i];
        if (block.kind !== "paragraph" || !isCaptionLookingParagraph(block)) {
            continue;
        }
        const prev = out[i - 1];
        if (prev !== undefined && prev.kind === "figure" && prev.caption.length === 0) {
            out.splice(i, 1);
            out[i - 1] = { ...prev, caption: block.content };
        }
    }
    for (let i = 0; i < out.length; i++) {
        const block = out[i];
        if (block.kind !== "paragraph" || !isCaptionLookingParagraph(block)) {
            continue;
        }
        const next = out[i + 1];
        if (next !== undefined && next.kind === "figure" && next.caption.length === 0) {
            out.splice(i, 1);
            out[i] = { ...next, caption: block.content };
        }
    }
    return out;
}
