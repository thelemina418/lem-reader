import type { Block, InlineRun } from "../src/content/schema";
import { type FootnoteBodyT as CanonicalFootnote } from "../src/content/footnoteBody";
/** Partial Provenance — the subset htmlToBlocks can extract from meta/link
 * tags. Structurally compatible with `Partial<Provenance>` (z.infer); the
 * orchestrator (07-05) merges this into a full Provenance + computes
 * originalHtmlHash from the raw HTML. */
type ProvenancePartial = {
    sourceUrl?: string;
    title?: string;
    author?: string;
    publishedAt?: string;
};
export declare const SANITIZE_CONFIG: {
    USE_PROFILES: {
        html: boolean;
    };
    ALLOWED_TAGS: string[];
    ALLOWED_ATTR: string[];
    FORBID_TAGS: string[];
    ALLOW_DATA_ATTR: boolean;
};
/**
 * sanitizeExtractedHtml — DOMPurify.sanitize under SANITIZE_CONFIG, then
 * clearWindow() to release the jsdom window state isomorphic-dompurify holds
 * internally. CRITICAL for long-running Node functions (isomorphic-dompurify
 * README): without clearWindow, the jsdom window leaks across requests.
 */
export declare function sanitizeExtractedHtml(html: string): string;
/** Phase 20 (Plan 20-02 Task 2) — the figure-src resolver hook (20-RESEARCH
 * Pattern 5, option (a)). Given a figure's extracted NON-http src, the
 * resolver answers whether it CLAIMS it (true = emit a FigureBlock carrying
 * that raw src string for later container resolution). The EPUB path
 * (20-06) passes a container-marker resolver; the url/paste default path
 * passes NOTHING and stays byte-stable — non-http srcs keep producing the
 * existing unsupported fallback below. */
export type FigureSrcResolver = (src: string) => boolean;
/** The result shape of htmlToBlocks + extractAndNormalize (minus isReaderable). */
export interface HtmlToBlocksResult {
    blocks: Block[];
    footnotes: CanonicalFootnote[];
    lang: string;
    provenancePartial: ProvenancePartial;
    /** Issue #236 — the source's own chapter index (nav fragment links whose
     * targets are headings), captured from the ORIGINAL DOM before Readability
     * or sanitization can drop it. Empty when no reliable index exists — the
     * honest default; structure.ts decides whether it reconciles. */
    outlineEvidence: string[];
}
/**
 * htmlToBlocks — walk a sanitized DOM and emit a 9-kind Block tree.
 *
 * Delegates to `visit` for the exhaustive block-kind mapping (Pattern F).
 * Returns blocks, footnotes, lang, and a partial Provenance extracted from the
 * given DOM. (When called from extractAndNormalize on the sanitized Readability
 * content fragment, lang/provenance are thin — extractAndNormalize overrides
 * them with the richer original-document values.)
 */
export declare function htmlToBlocks(sanitizedDom: Document, sourceUrl: string | undefined, figureSrcResolver?: FigureSrcResolver, noteNumbers?: ReadonlySet<number>): HtmlToBlocksResult;
/** The detected notes' raw HTML → each note's paragraphs of inline runs,
 * through the SHARED sanitizer and inline walk (the mXSS-suite surface — no
 * fork). One document parses every note in turn (its body is reset per
 * note), so a heavily annotated work (issue #60: up to ~1,000 notes) does
 * not build a jsdom per note. */
export declare function footnoteBodiesParagraphs(noteHtml: readonly string[], url: string | undefined): InlineRun[][][];
/** Bounds for the captured evidence: a real publisher index is tens of
 * chapters; these caps keep a hostile page from smuggling unbounded rows
 * into the ingest envelope (the feed-preview bound discipline). */
export declare const MAX_OUTLINE_ENTRIES = 200;
export declare const MAX_OUTLINE_TITLE_CHARS = 300;
/**
 * collectOutlineEvidence — the source's own table of contents, read from the
 * ORIGINAL source DOM while it is available (sanitization discards ids, so
 * the fragment→heading resolution must happen here; the captured titles are
 * plain validated strings — they are only ever COMPARED against canonical
 * heading text downstream, never rendered or trusted as markup).
 *
 * Evidence = the ordered (document order of the TARGET headings) titles of
 * same-page nav links (nav / [role="navigation"]) whose fragment resolves to
 * a heading element. Reliability gates:
 *   - only nav containers count — a stray same-page link list is not a
 *     publisher index;
 *   - targets must exist and be h1–h6; unresolvable/external/non-heading
 *     links are ignored;
 *   - repeated links to the same heading collapse to one entry;
 *   - at least TWO entries (one chapter divides nothing).
 * When no nav-channel evidence exists, the publisher's own index region — a
 * heading-declared "Index"/"Contents" card's list (issue #237, the
 * reference source's all-pages shape) — supplies the ordered entry titles
 * under the same caps and honesty rules.
 * Matching against canonical positions happens ONLY at derivation
 * (structure.ts), strictly and in source order — unreliable evidence simply
 * never reaches a chapter, it never invents one.
 */
export declare function collectOutlineEvidence(document: Document, finalUrl?: string): string[];
export interface ExtractAndNormalizeResult extends HtmlToBlocksResult {
    isReaderable: boolean;
    /** Notes past MAX_LINKED_FOOTNOTES that were left out (issue #60); the
     * orchestrator discloses them (footnotesOmittedWarning). Absent when none
     * were. */
    omittedFootnoteCount?: number;
}
/**
 * extractAndNormalize — the full pipeline stage.
 *
 * 1. Construct the original jsdom document (url passed so Readability resolves
 *    relative links AND img.src resolves against the document base).
 * 2. isProbablyReaderable — the cheap pre-check feeding deriveConfidence (07-03).
 * 3. Extract provenance + lang from the ORIGINAL document head (richer than the
 *    Readability content fragment, which has no <head>).
 * 4. Readability.parse on a CLONE (Readability mutates its input — RESEARCH L106).
 * 5. null extraction → empty blocks (orchestrator + confidence decide refusal).
 * 6. Else: sanitize article.content (DOMPurify + clearWindow), re-parse into a
 *    clean DOM, walk to Block tree.
 */
export declare function extractAndNormalize(html: string, finalUrl: string | undefined): Promise<ExtractAndNormalizeResult>;
export {};
