import type { Block, TranscriptSegmentAnchor } from "../src/content/schema";
import type { TranscriptSuccess } from "../src/ingestion/youtube";
/** Paragraph TARGET length in characters. Accumulated caption segments keep
 * joining a paragraph until it reaches this target; the NEXT segment then
 * starts a fresh paragraph (the budget is a target, not a clamp — a segment
 * is never split to hit it exactly). */
export declare const TRANSCRIPT_PARAGRAPH_TARGET_CHARS = 380;
/** Paragraph HARD CAP in characters. A segment that would push a non-empty
 * paragraph past this cap forces a break BEFORE it (the cap forces a break —
 * it never splits a segment). A lone segment longer than the cap still forms
 * ONE unsplit paragraph (never split a segment across paragraphs — decision
 * #26); pagination's fragment splitter owns that pathological case. */
export declare const TRANSCRIPT_PARAGRAPH_CAP_CHARS = 600;
/** TranscriptNormalization — the adapter's output, byte-aligned with the
 * orchestrator's Stage-1 shape. `anchors` indexes into `blocks` (blockIndex
 * is the array position at emit time — the persisted blocks array and these
 * anchors are stable per revision together); the orchestrator persists them
 * as ingestionMeta.transcript.segments (the decision-#26 name). Named
 * `anchors` here so the block-keyed times never share a name with the CAPTION
 * segments (TranscriptSuccess.segments) this module groups. */
export interface TranscriptNormalization {
    blocks: Block[];
    anchors: TranscriptSegmentAnchor[];
    warnings: string[];
}
/**
 * transcriptToBlocks — group caption segments into paragraph blocks under the
 * char budgets, emit chapter `h2` boundaries, and produce the block-keyed
 * timestamp anchors. The SAME policy applies to manual and ASR tracks
 * (per-line manual cues merge into print-like paragraphs exactly like ASR
 * lines — decision #26).
 *
 * Grouping policy (deterministic):
 *   - segments join their paragraph with a single space while the paragraph
 *     is below the ~380 target;
 *   - once at/above the target, the NEXT segment starts a new paragraph;
 *   - a segment that would push a non-empty paragraph past the ~600 hard cap
 *     starts a new paragraph instead (never splitting a segment);
 *   - a chapter boundary always forces a break, and the chapter's first
 *     segment begins the new paragraph (rule 4) — the `h2` joins the anchor
 *     map with the chapter's own startMs (heading blocks participate).
 */
export declare function transcriptToBlocks(transcript: TranscriptSuccess): TranscriptNormalization;
