import { normalizeText } from "../src/content/normalizeText";
/** The unsupported-block ratio above which extraction is flagged low-confidence
 * even if blockCount + textLength would otherwise pass (Pitfall 1 — a high
 * unsupported ratio means extraction grabbed chrome, not article body). */
const HIGH_UNSUPPORTED_RATIO = 0.4;
/** The minimum block count for a confident extraction (title + 2 paragraphs). */
const MIN_CONFIDENT_BLOCKS = 3;
/** The minimum normalized-text length for a confident extraction. Matches
 * Readability's own charThreshold:500 default (07-RESEARCH.md L538). */
const MIN_CONFIDENT_TEXT_LENGTH = 500;
/**
 * deriveConfidence — the two-state formula (ADR-0003). Pure function; no I/O.
 * Call sites: /server/ingest.ts orchestrator (07-05) runs this AFTER extraction
 * + sanitize to stamp the article confident or low — both enter the library;
 * low surfaces the reader-visible fidelity note (ING-06, DOC-06 copy).
 */
export function deriveConfidence(article, signals) {
    // 1. Readability pre-check — a negative signal, not a veto (ADR-0003).
    if (!signals.isReaderable) {
        return { state: "low", reason: "page-not-readerable" };
    }
    // 2. Compute the three signals. textLength via the SHARED normalizer
    // (Pitfall 2 — no fork). unsupportedRatio = fraction of blocks that fell
    // through to UnsupportedBlock during the DOM walk.
    const blockCount = article.blocks.length;
    const textLength = normalizeText(article).length;
    const unsupportedCount = article.blocks.filter((b) => b.kind === "unsupported").length;
    const unsupportedRatio = unsupportedCount / Math.max(1, blockCount);
    // 3. Pitfall 1 — high unsupported ratio means extraction grabbed chrome.
    // Checked BEFORE the block/text threshold so a 50%-unsupported extraction
    // is flagged low even if it technically has enough text.
    if (unsupportedRatio > HIGH_UNSUPPORTED_RATIO) {
        return { state: "low", reason: "high-unsupported-ratio" };
    }
    // 4. Confident threshold (RESEARCH.md L538 — matches Readability charThreshold:500).
    if (blockCount >= MIN_CONFIDENT_BLOCKS && textLength >= MIN_CONFIDENT_TEXT_LENGTH) {
        return { state: "confident" };
    }
    // 5. Readerable but thin — honest low-confidence.
    return { state: "low", reason: "extraction-thin" };
}
