import { type Block, type CanonicalArticle } from "../src/content/schema";
import type { IngestionRequest, IngestionResponse } from "../src/ingestion/types";
/**
 * probeRoundTripAnchor — the SC#1 anchor probe (ADR-0003: a detector, not a
 * gate). Samples 5 grapheme offsets (0, 25%, 50%, 75%, near-end) on the
 * article's normalized text, derives a TextQuoteSelector at each, and resolves
 * it via the SHIPPED resolveQuoteSelector (Pitfall 2 — no fork). Runs AFTER
 * ArticleSchema.parse so the probe receives a validated article.
 *
 * Outcomes:
 *   - "pass"      every sample resolved confidently.
 *   - "ambiguous" some sample's quote text occurs more than once (e.g. a
 *                 repeated epigraph or opening) — the TEXT is fully readable;
 *                 the article is admitted with annotationsDegraded so the
 *                 reader sees "Highlights may be unreliable on this article."
 *   - "orphan"    a selector derived from the article itself resolved to
 *                 nothing — a derive/resolve asymmetry bug, not a content
 *                 property. Still refused (round-trip-anchor-failed) as a bug
 *                 canary; this should never fire for real input.
 */
export type AnchorProbeResult = "pass" | "ambiguous" | "orphan";
export declare function probeRoundTripAnchor(article: CanonicalArticle): AnchorProbeResult;
/**
 * footnotesOmittedWarning — the count-first extractionWarnings line for notes
 * cut by the note cap (spec #66 / issue #60, ADR-0003): the article is
 * admitted flagged, and the reader is told how many notes were left out.
 * Shared by the HTML and Markdown paths (one copy source).
 */
export declare function footnotesOmittedWarning(count: number): string[];
/**
 * looksLikePlainText — the 260821-ov7 reroute predicate. True when the
 * TRIMMED content contains no HTML tag opener, i.e. it cannot be HTML
 * markup. The direction is deliberately CONSERVATIVE: when in doubt (e.g.
 * prose MENTIONING a tag, like "you can use <br> in HTML"), the content
 * KEEPS the byte-stable html path — the reroute only admits content that
 * provably carries no markup at all.
 *
 * Security (T-OV7-01): why untrusted text through the markdown intake is
 * safe — the D8-16 boundary in server/markdownToBlocks.ts (§SECURITY
 * BOUNDARY, Pitfall 8-2) already holds for arbitrary untrusted .md uploads:
 * strict CommonMark escapes raw HTML to inert paragraph text by default (the
 * parser's raw-HTML pass-through is never enabled), the Block tree is pure
 * inert JSON, React escapes text children on render, and the repo-wide
 * eslint react/no-danger rule is the belt-and-suspenders structural
 * defense. The predicate itself only reroutes content with NO tag opener,
 * so real HTML never enters the markdown path via this route — and even if
 * it did, D8-16 holds regardless.
 */
export declare function looksLikePlainText(content: string): boolean;
/**
 * stripPdfExtension — pure string-only helper that strips a trailing `.pdf`
 * extension (case-insensitive). Implements the D11-07 filename channel of the
 * PDF title chain (mirrors stripMarkdownExtension's shape; the chain is
 * orchestrator-owned per 11-PATTERNS L129, so the helper lives here). Like
 * its markdown sibling it does NO path-basename logic — the File API returns
 * just the filename.
 *
 * Examples (mirrored in the unit suite):
 *   stripPdfExtension("Report.pdf")        === "Report"
 *   stripPdfExtension("report.PDF")        === "report"
 *   stripPdfExtension("no-extension")      === "no-extension"
 */
export declare function stripPdfExtension(filename: string): string;
/**
 * stripEpubExtension — pure string-only helper that strips a trailing `.epub`
 * extension (case-insensitive). The second arm of the book title chain
 * (Phase 12 Plan 12-04): OPF dc:title is spec-REQUIRED and the adapter
 * already falls back to "Untitled book" (never an empty string), so this arm
 * is reached only when a caller wants the filename channel to override the
 * tolerant fallback — the chain is deliberately short (mirrors
 * stripPdfExtension's shape; orchestrator-owned per the 11-PATTERNS L129
 * precedent).
 *
 * Examples (mirrored in the unit suite):
 *   stripEpubExtension("my-book.epub")   === "my-book"
 *   stripEpubExtension("MY-BOOK.EPUB")   === "MY-BOOK"
 *   stripEpubExtension("no-extension")   === "no-extension"
 */
export declare function stripEpubExtension(filename: string): string;
/**
 * consumeDuplicatedTitle (D11-09) — if the FIRST block is a heading whose
 * normalized text fuzzy-matches the final title (case/whitespace-insensitive
 * containment, either direction), drop it: the provenance header renders the
 * title and bodies start at h2 (the one-h1-per-page v1.0 discipline — the
 * body never repeats the title). Any other first block, or a non-matching
 * leading heading, is kept unchanged. Pure; returns a new array only when a
 * block is dropped.
 */
export declare function consumeDuplicatedTitle(blocks: Block[], title: string): Block[];
/** AssetEnvelope — the wire shape of one accepted image asset on the ingest
 * response (base64-in-JSON, mirroring the pdf/epub upload transport
 * decision). Task 3's AssetEnvelopeSchema in src/ingestion/types.ts is the
 * client-side Zod mirror of this shape; the MAX_ASSET_RESPONSE_BYTES budget
 * is already enforced inside the stage, so the envelope can never exceed the
 * base64 transport ceiling (20-RESEARCH Pitfall 1). */
export interface AssetEnvelope {
    assetId: string;
    contentType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "image/avif";
    byteLength: number;
    dataBase64: string;
}
/**
 * ingest — the 7-stage stateless pipeline orchestrator (RESEARCH.md §Pattern 1
 * L249-279). Runs safeFetch → extractAndNormalize → slugifyUrl →
 * ArticleSchema.parse → probeRoundTripAnchor → deriveConfidence, and returns
 * a typed IngestionResponse. Every refusal path produces a typed reason
 * (IngestionError is caught and serialized) so the edge function (07-06) can
 * map it to HTTP 400 cleanly.
 *
 * Input is input-source-agnostic (D7-03): exactly one of {url} | {html} |
 * {markdown} | {pdf} | {epub} | {transcript} | {feedUrl}. The url path runs
 * safeFetch (SSRF guard); the
 * html path synthesizes the pipeline input directly with finalUrl=undefined
 * (no fetch, no SSRF surface); the markdown + pdf paths mirror that shape
 * through their sibling adapters (Stage-1 extraction only — stages 2+ are
 * shared). The epub path (Phase 12 Plan 12-04, the fifth Stage-1 branch)
 * diverges after Stage 1: it runs stages 2+ PER CHAPTER inside
 * ingestEpubBook and returns the book ok-variant envelope — the single-
 * article stages below stay byte-stable for the four prior formats.
 *
 * Input validation (exactly one of url/html/markdown/pdf/epub) throws
 * IngestionError — the caller is expected to pass a Zod-validated
 * IngestionRequest, so reaching this throw is a programming error.
 */
export declare function ingest(input: IngestionRequest): Promise<IngestionResponse>;
