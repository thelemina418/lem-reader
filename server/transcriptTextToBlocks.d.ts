import type { Block, TranscriptSegmentAnchor } from "../src/content/schema";
/** PastedTranscriptNormalization — the adapter's output. `anchors` and
 * `durationSeconds` are present ONLY for the timestamped shape (undefined
 * means "no timings existed in the paste" — honest absence). */
export interface PastedTranscriptNormalization {
    blocks: Block[];
    anchors: TranscriptSegmentAnchor[];
    warnings: string[];
    durationSeconds: number | undefined;
}
/**
 * pastedTranscriptToBlocks — parse pasted transcript text and group it with
 * the SAME normalization the fetched path uses. Timestamped pastes reuse
 * transcriptToBlocks verbatim (budget grouping + anchors); plain pastes
 * group lines into paragraphs under the same budgets with NO anchors.
 * `videoTitle` feeds only the chapter-restate heuristic of the timestamped
 * path (a pasted transcript never carries chapter markers — `chapters: []`
 * — so it is effectively inert); it is REQUIRED because callers pass the
 * reader-provided ingest-time title — no fabricated "Transcript" name can
 * leak anywhere.
 */
export declare function pastedTranscriptToBlocks(text: string, videoTitle: string): PastedTranscriptNormalization;
