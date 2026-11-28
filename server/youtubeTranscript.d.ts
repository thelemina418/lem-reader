import { type TranscriptChapter, type TranscriptSegment, type YouTubeTranscriptResult } from "../src/ingestion/youtube";
/**
 * parseCaptionXml — timedtext XML → segments. Two machine-generated shapes
 * are handled (both live-captured 2026-09-16 into the fixture set):
 *   srv1 (primary — what the &fmt=srv3-stripped URL serves):
 *     `<transcript><text start="1.36" dur="1.68">body</text>…` (seconds)
 *   srv3 (defensive — if YouTube serves the word-level form anyway):
 *     `<timedtext format="3"><p t="1360" d="1680">body</p>…` (ms)
 * Returns [] when neither shape matches (the caller refuses — no silent
 * garbage). Parsing is deliberately regex-based over the tightly-formed
 * machine output, exactly like the reference implementations recorded in
 * docs/spikes/0008 §3; a generic XML parser adds nothing here but
 * mixed-content fragility.
 */
export declare function parseCaptionXml(xml: string): TranscriptSegment[];
/**
 * parseChaptersFromNext — extract creator chapters from the WEB `next`
 * response. ONLY the description-chapters panel
 * (`engagement-panel-macro-markers-description-chapters`) counts: YouTube's
 * auto-chapters are the platform's guess, not the creator's, and honesty
 * means carrying the creator's own segmentation. Absence → [].
 */
export declare function parseChaptersFromNext(next: unknown): TranscriptChapter[];
/**
 * selectCaptionTrack — the caption-track selection policy (issue #59,
 * decision #57 resolution, tiers verbatim):
 *
 *   1. For each reader language, in the reader's stated order: EXACT BCP-47
 *      match (case-insensitive), then base-language match — within each tier,
 *      manual beats ASR.
 *   2. ANY match in a preferred language (including ASR) beats a manual track
 *      in a non-preferred language — the earlier tiers are exhausted first.
 *   3. No reader language matches any track (no preference, empty list, or
 *      garbage tags) → today's rule unchanged: manual over ASR, first track
 *      otherwise. Deterministic throughout: the sort is stable, so within a
 *      tier InnerTube's listed order breaks every tie.
 *
 * Honesty holds unchanged: an ASR track that wins on language keeps the
 * existing low-confidence disclosure (reading a language you speak with
 * disclosed machine captions beats silently reading a language you don't).
 * Pure + exported for the fixture-pinned tier suite
 * (tests/unit/server/youtube-transcript.spec.ts).
 */
export declare function selectCaptionTrack(tracks: Record<string, unknown>[], preferredLanguages?: string[]): Record<string, unknown> | undefined;
/**
 * fetchYouTubeTranscript — the entry point over an already-extracted videoId.
 * The id MUST be regex-valid (extractYouTubeVideoId produced it); a raw
 * non-YouTube URL is a caller dispatch error and throws server-error BEFORE
 * any request (issue #35: the videoId is regex-validated before any request).
 *
 * `preferredLanguages` (issue #59) is the reader's ordered BCP-47-ish tag
 * list (the request schema already bounded count/length); it rides NOTHING
 * on the wire — selection is purely client-side over the returned
 * captionTracks, so the InnerTube request surface is byte-unchanged.
 *
 * Returns the discriminated YouTubeTranscriptResult — ok:true with
 * transcript + metadata + chapters, or ok:false with one of the FOUR
 * structured refusal kinds. Transport failures throw IngestionError with the
 * existing honest catalog reasons (fetch-failed / response-too-large / …);
 * they are distinct from the four YouTube-state refusals. No retry, no cache.
 */
export declare function fetchYouTubeTranscript(videoId: string, preferredLanguages?: string[]): Promise<YouTubeTranscriptResult>;
/**
 * fetchYouTubeTranscriptFromUrl — the URL-form entry point (issue #35 AC:
 * watch / shorts / youtu.be forms). Extracts + validates the videoId BEFORE
 * any request; a non-YouTube URL is a caller dispatch error (server-error).
 */
export declare function fetchYouTubeTranscriptFromUrl(rawUrl: string, preferredLanguages?: string[]): Promise<YouTubeTranscriptResult>;
