import { footnoteBodyAsBlock } from "./footnoteBody";
/** Separator between consecutive blocks (and between body and footnotes region). */
export const BLOCK_SEPARATOR = "\n";
/**
 * Collapse ASCII whitespace runs to a single space, then trim.
 *
 * Pitfall 2 rule: ONLY ASCII whitespace ([\t\n\f\r ]) is collapsed. Do NOT
 * touch Unicode whitespace (NBSP \u00A0, ZWJ \u200D, RTL marks) — these are
 * preserved verbatim because they are part of the readable text. Do NOT apply
 * Unicode normalization (no NFC/NFKC) — it would break Intl.Segmenter
 * reproducibility across revisions.
 */
export function normalizeRunText(text) {
    return text.replace(/[\t\n\f\r ]+/g, " ").trim();
}
/** Render an inline run array to its normalized text contribution.
 * Exported for the read-aloud speakable-channel walk (src/readaloud/chunks.ts),
 * which needs the caption sub-range of a figure block — the SAME function the
 * D-05 substrate uses, never a fork (Pitfall 3). */
export function inlineText(runs) {
    const separators = runSeparators(runs);
    let text = "";
    runs.forEach((run, i) => {
        const norm = normalizeRunText(run.text);
        if (norm.length > 0)
            text += (separators[i] === 1 ? " " : "") + norm;
    });
    return text;
}
const LEADING_ASCII_WS = /^[\t\n\f\r ]/;
const TRAILING_ASCII_WS = /[\t\n\f\r ]$/;
function isFootnoteRefRun(run) {
    return run.marks.some((mark) => mark.type === "footnote-ref");
}
const separatorCache = new WeakMap();
/**
 * runSeparators — THE inline run-join rule, per run: the separator graphemes
 * the D-05 stream places before that run's contribution (0 for a run with no
 * contribution, and for the first contributing run).
 *
 * Adjacent contributions join with one " " — except at a Footnote
 * reference's edge with no whitespace in the source: spec #66 keeps the
 * marker graphemes where the old flattened ingest had them ("Claim1 more."),
 * so a stored highlight quote that includes a marker is unchanged.
 * Whitespace-only runs between two contributions count as source
 * whitespace. Every walk over the stream (inlineText, the splitBlock
 * slicing family, footnoteReferenceSpans) reads its joins from here.
 */
export function runSeparators(runs) {
    const hit = separatorCache.get(runs);
    if (hit)
        return hit;
    const separators = new Array(runs.length).fill(0);
    let previous = null;
    let whitespaceBetween = false;
    runs.forEach((run, i) => {
        if (normalizeRunText(run.text).length === 0) {
            if (run.text.length > 0)
                whitespaceBetween = true;
            return;
        }
        if (previous !== null) {
            const glued = (isFootnoteRefRun(previous) || isFootnoteRefRun(run)) &&
                !whitespaceBetween &&
                !TRAILING_ASCII_WS.test(previous.text) &&
                !LEADING_ASCII_WS.test(run.text);
            separators[i] = glued ? 0 : 1;
        }
        previous = run;
        whitespaceBetween = false;
    });
    separatorCache.set(runs, separators);
    return separators;
}
/**
 * Walk a single block; return its normalized text contribution.
 *
 * Code-block source is returned VERBATIM (whitespace NOT collapsed — it IS
 * readable text). Footnote references contribute their visible marker (e.g.
 * "[1]") at their reading-order body position; footnote BODIES participate
 * later via normalizeText (see Pitfall 3 note there).
 */
function blockText(block) {
    switch (block.kind) {
        case "heading":
        case "paragraph":
            return inlineText(block.content);
        case "blockquote":
            return block.children.map(blockText).join(BLOCK_SEPARATOR);
        case "bulleted-list":
        case "numbered-list":
            return block.items
                .map((item) => item.content.map(blockText).join(BLOCK_SEPARATOR))
                .join(BLOCK_SEPARATOR);
        case "figure":
            return [block.alt, inlineText(block.caption)].filter(Boolean).join(BLOCK_SEPARATOR);
        case "code-block":
            return block.source; // verbatim — do NOT collapse whitespace in code
        case "footnote-reference":
            return block.marker; // e.g. "[1]"
        case "unsupported":
            // Disclosure summary text contributes to the stream (D-05: reading-order position)
            return block.plainDescription;
    }
}
/**
 * A Footnote body's normalized text contribution (issue #59): its block-shaped
 * view's text — one paragraph's inline text, or a multi-paragraph note's
 * paragraphs joined with BLOCK_SEPARATOR. A one-paragraph note's text is
 * byte-identical to the pre-#59 `inlineText(fn.content)`, so stored offsets
 * never move. The ONE derivation every footnote-text consumer reads.
 */
export function footnoteText(fn) {
    return blockText(footnoteBodyAsBlock(fn));
}
/**
 * Exported alias for `blockText` — Phase 4 Plan 04-04 anchor helpers
 * (src/pagination/anchor.ts) need per-block normalized text to compute
 * article-global grapheme offsets for the D4-10 mode-switch + D4-11
 * repagination anchors. Exporting the SAME function (rather than a parallel
 * implementation) honors Pattern 5 / Pitfall: never fork normalization —
 * any divergence would shift every passage anchor.
 */
export function blockNormalizedText(block) {
    return blockText(block);
}
/**
 * D-05 contract: ONE deterministic normalized-text string per article revision.
 *
 * Pitfall 3 rule: footnote BODY text participates AFTER the body blocks, in
 * footnotes-region order. The `[bodyText, footnoteText].filter(Boolean).join()`
 * form guarantees a footnote body's offset is always greater than its
 * reference marker's offset.
 */
export function normalizeText(article) {
    const bodyText = article.blocks.map(blockText).join(BLOCK_SEPARATOR);
    const notesText = article.footnotes.map(footnoteText).filter(Boolean).join(BLOCK_SEPARATOR);
    return [bodyText, notesText].filter(Boolean).join(BLOCK_SEPARATOR);
}
// ── Locale-keyed Intl.Segmenter cache (260819-tld) ───────────────────────────
// Constructing an Intl.Segmenter is expensive; the hot paths (scroll listeners,
// page turns, highlight resolution) used to pay it on EVERY graphemeClusters
// call. One instance per locale is constructed for the page lifetime. The
// exported signature and output of graphemeClusters are UNCHANGED.
/** Locale-keyed grapheme-granularity segmenter instances (one per locale). */
const segmenterCache = new Map();
function segmenterFor(locale) {
    let segmenter = segmenterCache.get(locale);
    if (!segmenter) {
        segmenter = new Intl.Segmenter(locale, { granularity: "grapheme" });
        segmenterCache.set(locale, segmenter);
    }
    return segmenter;
}
/**
 * Grapheme-offset substrate.
 *
 * CRITICAL (Pitfall 1): the canonical offset of the Nth grapheme cluster is N,
 * NOT segment.index (which is a UTF-16 code-unit offset into the source string).
 *
 * Returns: an array of grapheme cluster substrings in order, so callers can
 * derive offsets as array indices.
 */
export function graphemeClusters(text, locale) {
    return Array.from(segmenterFor(locale).segment(text), (s) => s.segment);
}
const articleIndexCache = new WeakMap();
const contentIndexCache = new WeakMap();
/**
 * The footnotes region's canonical rows: one per NON-EMPTY footnote body.
 *
 * normalizeText joins the region AFTER the body
 * (`[bodyText, footnoteText].filter(Boolean).join(BLOCK_SEPARATOR)`), so the
 * first row starts at the body's capped accumulation
 * (`blockStartOffsets[blocks.length]`) — EXCEPT when every body block
 * contributes zero clusters, where the dropped empty `bodyText` spends no
 * leading separator and the region starts at 0 (the exact predicate the
 * read-aloud speakable walk already uses). Rows are joined by ONE separator
 * each; empty bodies are filtered out of the join and occupy nothing. This
 * is the ONE derivation — windows, pagination entries, anchors, and the
 * spoken walk must all read it, never a parallel accumulation (Pitfall 3).
 */
function deriveFootnoteRows(article, blockStartOffsets, perBlockLengths) {
    const rows = [];
    const bodyEmpty = perBlockLengths.every((len) => len === 0);
    let cursor = bodyEmpty ? 0 : (blockStartOffsets[article.blocks.length] ?? 0);
    for (const [i, fn] of article.footnotes.entries()) {
        const length = graphemeClusters(footnoteText(fn), article.lang).length;
        if (length === 0)
            continue;
        rows.push({ index: i, start: cursor, length });
        cursor += length + BLOCK_SEPARATOR.length;
    }
    return rows;
}
/**
 * The canonical row covering footnote `footnoteIndex`, or undefined when the
 * footnote has no row (no text, or out of range). The ONE lookup — windows,
 * entries, anchors, the guard, and the renderers all read it; a missing row
 * is honest absence (the body contributes nothing), and each caller decides
 * its own miss behavior explicitly.
 */
export function footnoteRowFor(article, footnoteIndex) {
    return articleGraphemeIndex(article).footnoteRows.find((r) => r.index === footnoteIndex);
}
/**
 * The canonical row whose text contains article-global `offset`, or
 * undefined in the main text (issue #65 — which note a highlight lies in).
 */
export function footnoteRowAt(article, offset) {
    return articleGraphemeIndex(article).footnoteRows.find((r) => offset >= r.start && offset < r.start + r.length);
}
/**
 * The footnotes region's canonical rows for `article` (issue #235).
 *
 * Served by the per-article grapheme index — one derivation per parsed
 * article object, never a per-call accumulation. Consumers: bounded source
 * traversal (src/pagination/blockWindow.ts), the pagination engine's
 * footnote entries, and the page anchors.
 */
export function footnoteRows(article) {
    return articleGraphemeIndex(article).footnoteRows;
}
/**
 * The per-article grapheme index (built once per article object, then cached).
 *
 * CRITICAL: perBlockLengths are derived by segmenting blockText(block) per
 * block. Do NOT split the joined normalizedText on BLOCK_SEPARATOR — code-block
 * sources are verbatim and can themselves contain newline characters, so
 * separator positions in the joined string are not reliable block boundaries.
 */
export function articleGraphemeIndex(article) {
    let index = articleIndexCache.get(article);
    if (!index) {
        const shared = contentIndexCache
            .get(article.blocks)
            ?.find((e) => e.footnotes === article.footnotes && e.lang === article.lang);
        if (shared) {
            articleIndexCache.set(article, shared.index);
            return shared.index;
        }
        const normalizedText = normalizeText(article);
        const clusters = graphemeClusters(normalizedText, article.lang);
        const perBlockLengths = article.blocks.map((block) => graphemeClusters(blockText(block), article.lang).length);
        const blockStartOffsets = [];
        let accumulated = 0;
        for (const len of perBlockLengths) {
            blockStartOffsets.push(accumulated);
            accumulated += len + BLOCK_SEPARATOR.length;
        }
        // Sentinel entry: the capped accumulation for an out-of-range blockIndex.
        blockStartOffsets.push(accumulated);
        index = {
            normalizedText,
            clusters,
            perBlockLengths,
            blockStartOffsets,
            footnoteRows: deriveFootnoteRows(article, blockStartOffsets, perBlockLengths),
            totalGraphemes: clusters.length,
        };
        articleIndexCache.set(article, index);
        const siblings = contentIndexCache.get(article.blocks);
        const entry = { footnotes: article.footnotes, lang: article.lang, index };
        if (siblings)
            siblings.push(entry);
        else
            contentIndexCache.set(article.blocks, [entry]);
    }
    return index;
}
/** The canonical length of an article in grapheme clusters. */
export function graphemeLength(article) {
    return articleGraphemeIndex(article).totalGraphemes;
}
/**
 * Issue #58 — the canonical length of the article's MAIN TEXT: the
 * coordinate stream up to (not including) the notes region. The notes are
 * reference material, not reading: completion, progress, read-aloud's
 * continuous stop, and Estimated reading time all measure against this
 * end. Equals graphemeLength when there are no footnote rows. The body's
 * last block ends one separator before the first row
 * (normalizeText's `[body, notes].join(SEP)`); an all-empty body spends no
 * separator, so its main text is empty.
 */
export function mainTextLength(article) {
    const index = articleGraphemeIndex(article);
    const firstRow = index.footnoteRows[0];
    if (firstRow === undefined)
        return index.totalGraphemes;
    return Math.max(0, firstRow.start - BLOCK_SEPARATOR.length);
}
// ── Raw↔normalized cluster alignment (Pitfall 1 bridge) ─────────────────────
// The DOM renders run texts concatenated (InlineRenderer adds no separators),
// while the D-05 normalized text collapses whitespace AND joins runs with " ".
// Both streams carry the same non-whitespace clusters in the same order; they
// diverge only in whitespace. One alignment walk maps raw-cluster ordinals
// (DOM textContent, line boxes, capture Ranges) onto normalized-grapheme
// ordinals (the D-05 substrate) — shared by annotation capture and the
// pagination engine's line-box → grapheme conversion. Never fork this walk
// (Pitfall 3): a divergence would shift capture offsets against split points.
/**
 * A whitespace cluster: a grapheme cluster consisting solely of ASCII
 * [\t\n\f\r ] (the set normalizeRunText collapses). Unicode whitespace
 * (NBSP, ZWJ, RTL marks) is NOT in this set — those are readable text and
 * must NOT be collapsed (Pitfall 2 rule from normalizeText.ts). Shared by
 * the raw↔norm bridge and the paginated visible-window clip: separator
 * graphemes (BLOCK_SEPARATOR, the inlineText run join) are whitespace
 * clusters that render in no run piece.
 */
export function isWhitespaceCluster(cluster) {
    return /^[\t\n\f\r ]+$/.test(cluster);
}
/**
 * Build a map from raw-cluster offset → normalized-grapheme offset.
 *
 * `rawClusters` is the grapheme clustering of a block's raw concatenated
 * text (the DOM textContent projection). `normClusters` is the grapheme
 * clustering of blockNormalizedText(block). Both contain the same
 * non-whitespace clusters in the same order; whitespace may differ (raw has
 * extra spaces from non-collapsed runs / run-boundary concatenation that
 * normalizeRunText collapses + trims, or norm has separator spaces that raw
 * lacks at run boundaries).
 *
 * The returned array has length `rawClusters.length + 1`. `map[i]` is the
 * normalized-grapheme offset corresponding to raw-cluster offset `i`. The
 * extra trailing entry `map[rawClusters.length]` is the normalized length
 * (past-the-end), so an end-exclusive DOM offset maps cleanly.
 */
export function buildRawToNormMap(rawClusters, normClusters) {
    const rawLen = rawClusters.length;
    const map = new Array(rawLen + 1);
    let r = 0; // raw-cluster index
    let n = 0; // norm-cluster index
    // Skip leading raw whitespace (normalizeRunText trims leading). These map to
    // norm offset 0 (before the first norm cluster).
    while (r < rawLen && isWhitespaceCluster(rawClusters[r])) {
        map[r] = 0;
        r++;
    }
    while (r < rawLen) {
        const rc = rawClusters[r];
        if (isWhitespaceCluster(rc)) {
            if (n < normClusters.length && isWhitespaceCluster(normClusters[n])) {
                // Aligned whitespace — map and advance both pointers.
                map[r] = n;
                r++;
                n++;
                // Collapse: skip any additional raw whitespace clusters that
                // normalizeRunText would have folded into this single space.
                while (r < rawLen && isWhitespaceCluster(rawClusters[r])) {
                    map[r] = n;
                    r++;
                }
            }
            else {
                // norm has no whitespace here — this raw whitespace was collapsed into
                // the previous norm space or trimmed. Map to the current norm offset
                // and advance only the raw pointer.
                map[r] = n;
                r++;
            }
        }
        else {
            // Non-whitespace raw cluster — must align with a non-ws norm cluster.
            if (n < normClusters.length && !isWhitespaceCluster(normClusters[n])) {
                map[r] = n;
                r++;
                n++;
            }
            else if (n < normClusters.length && isWhitespaceCluster(normClusters[n])) {
                // norm inserted a separator space here (inlineText joins runs with
                // " ") but raw concatenated without a separator. Skip the norm space
                // and align.
                n++;
                map[r] = n;
                r++;
                n++;
            }
            else {
                // norm exhausted (raw has trailing content not in the normalized
                // text — defensive; should not happen for well-formed blocks). Clamp.
                map[r] = normClusters.length;
                r++;
            }
        }
    }
    // Past-the-end: maps to the normalized length (end-exclusive DOM offset).
    map[rawLen] = normClusters.length;
    return map;
}
/**
 * Derive a TextQuoteSelector from a TextPositionSelector (used when saving an
 * annotation). `exact` round-trips through graphemeClusters(normalizeText(article)).
 */
export function deriveQuoteSelector(article, position, contextRadius = 32) {
    // Served by the per-article index — one segmentation per article object,
    // not one per capture (260819-tld).
    const clusters = articleGraphemeIndex(article).clusters;
    const exact = clusters.slice(position.start, position.end).join("");
    const prefix = clusters
        .slice(Math.max(0, position.start - contextRadius), position.start)
        .join("");
    const suffix = clusters
        .slice(position.end, Math.min(clusters.length, position.end + contextRadius))
        .join("");
    return { prefix, exact, suffix };
}
// ── Phase 5: resolveQuoteSelector (D5-02 re-anchoring) ─────────────────────
// Source: D5-02 in 05-CONTEXT.md (locked decision). Algorithm delegated to
// src/annotations/resolution.ts so this module stays focused on the D-05
// substrate; the contract signature stays here per the Phase 1 stub site
// (05-PATTERNS.md §normalizeText.ts). The import creates a benign module
// cycle (resolution.ts imports graphemeClusters/normalizeText from here — both
// are hoisted function declarations used only at call-time, so there is no
// temporal-dead-zone hazard).
import { resolveQuoteSelector as resolveQuoteSelectorImpl } from "../annotations/resolution";
/**
 * Re-resolve a stored TextQuoteSelector against the current revision's
 * normalized text (D5-02). Returns:
 *   - a TextPositionSelector when the passage is found confidently;
 *   - "ambiguous" when the exact text appears N>1 times even after
 *     prefix/suffix disambiguation (ANNO-07 — the reader is shown the
 *     ambiguous state, never a silent re-attach);
 *   - "orphan" when zero exact matches AND no confident prefix/suffix fallback.
 *
 * Pure function — no DOM, no React, no side effects. jsdom-safe.
 *
 * `positionHint` (the stored TextPositionSelector) is a nearness hint for the
 * zero-exact fallback only; it is IGNORED when the exact text matches uniquely
 * (the text IS the anchor). Never silently re-attaches to a wrong spot.
 */
export function resolveQuoteSelector(article, selector, positionHint) {
    return resolveQuoteSelectorImpl(article, selector, positionHint);
}
