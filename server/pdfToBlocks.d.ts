import { getDocumentProxy, type StructuredTextItem } from "unpdf";
import type { Block, InlineRun } from "../src/content/schema";
import { IngestionError } from "./errors";
/** The pdfjs document proxy type without importing pdfjs internals — derived
 * from unpdf's own public surface (the classes are NOT re-exported from the
 * unpdf index; `Awaited<ReturnType<…>>` keeps us on the public API). */
type PDFDocumentProxy = Awaited<ReturnType<typeof getDocumentProxy>>;
/** ProvenancePartial — same shape as `server/markdownToBlocks.ts` L48-53. The
 * orchestrator merges this into a full Provenance + computes the hash of the
 * raw PDF bytes. The adapter is filename-agnostic (D8-17 / D11-07 mirror):
 * `filename` never enters this module; the orchestrator owns the title
 * fallback chain. */
type ProvenancePartial = {
    sourceUrl?: string;
    title?: string;
    author?: string;
    publishedAt?: string;
};
export declare const PDF_THRESHOLDS: {
    /** y-tolerance for binning items into line bands, × modal line height. */
    readonly bandYToleranceRatio: 0.3;
    /** top/bottom text-extent fraction excluded as page furniture (Pitfall 4). */
    readonly marginBandRatio: 0.05;
    /** x-run span above this fraction of the page text extent = spanning
     * element (headers / pull quotes) — never votes, never splits regions. */
    readonly wideBandRatio: 0.55;
    /** x-bin granularity for the coverage vote histogram, × modal fontSize. */
    readonly xBinEm: 0.5;
    /** a bin is gutter when votes < this fraction of narrow x-run count. */
    readonly gutterVoteRatio: 0.2;
    /** minimum gutter width, × modal fontSize (≈ 1 body em). */
    readonly minGutterEm: 1;
    /** a separated region counts as a text column at ≥ this share of the
     * narrow-run (column-candidate) text mass. */
    readonly colTextShare: 0.15;
    /** page-weighted majority: columnar pages > this × text-bearing pages ⇒
     * document refuses pdf-multi-column (D11-03). */
    readonly columnarMajorityRatio: 0.5;
    /** text-bearing needs ≥ this many non-whitespace items. */
    readonly scannedItemFloor: 8;
    /** text-bearing needs ≥ this many non-whitespace chars. */
    readonly scannedCharFloor: 40;
    /** fewer non-whitespace items than this ⇒ near-empty page. */
    readonly nearEmptyItemFloor: 3;
    /** fewer non-whitespace chars than this ⇒ near-empty page. */
    readonly nearEmptyCharFloor: 15;
    /** page-weighted majority: near-empty pages > this × ALL pages ⇒ document
     * refuses pdf-scanned (D11-03). */
    readonly scannedMajorityRatio: 0.5;
    /** new paragraph when the baseline delta exceeds this × modal line delta. */
    readonly paragraphGapRatio: 1.35;
    /** insert a space between same-line items when the x-gap exceeds this × fontSize. */
    readonly itemGapRatio: 0.2;
    /** an intra-page vertical gap beyond this × modal line height is a
     * non-text region (figure/chart stand-in) — emit ONE unsupported block. */
    readonly figureGapLines: 5;
    /** heading when dominant fontSize ≥ body × this (char-weighted modal body).
     * 1.15 → 1.1 at 11-06 calibration: TRACE's section headings are 12pt over
     * a 10.9pt body (ratio 1.101) — 1.1 lands exactly AT the boundary (10.9091 × 1.1 =
     * 12.00001 > the 12pt headings), so 1.095; nothing in the corpus sits between body
     * and 11.49pt display operators, so 1.1 admits true headings safely. */
    readonly headingFontRatio: 1.095;
    /** Word ceiling for standalone/numbered-section heuristics, never a
     * veto on independently display-sized headings. */
    readonly headingMaxWords: 10;
    /** outline dest y matches a block top within this × the page's line delta. */
    readonly outlineYToleranceLines: 1.5;
    /** digit-normalized first/last-band text repeating on ≥ this many pages is
     * furniture (running head/foot). */
    readonly furnitureRepeatPages: 3;
    /** a furniture candidate band must be at most this many characters. */
    readonly furnitureMaxChars: 60;
    /** a band whose dominant font is smaller than an adjacent band's merges
     * into it when the y-distance is under this × the page's line delta. */
    readonly scriptBandRatio: 0.75;
    /** a band that is BOTH a tiny fragment (≤ scriptFragmentChars) AND
     * smaller-dominant-size than an adjacent band — a pure script decoration
     * such as a stacked ∑/∏ under-limit — merges within this × line delta.
     * TRACE's under-limits "𝑘=0" (7.97pt over a 10.91pt body) sit 11.88pt
     * below their equation band, outside the 0.75 window (10.16pt), and
     * orphaned as standalone paragraph blocks. The AND-qualification is the
     * safety: a body-SIZED short line (a paragraph's last line, "given by:")
     * is never size-qualified, and a math-heavy body LINE exceeds the char
     * cap, so both keep the 0.75 window and near-line-delta paragraph
     * spacing never fuses (11-06 continuation calibration). */
    readonly scriptFragmentGapRatio: 1;
    /** bold-section fallback: standalone ASCII title at body size becomes a
     * heading when at most this many words. */
    readonly sectionTitleMaxWords: 3;
    /** a band this many non-whitespace characters or fewer, sitting within
     * scriptBandRatio × line delta of a neighbor, is an equation fragment
     * (superscript sums/indices like "Õ∞", "𝑘𝑘", "𝑘=0") — merged into the
     * neighbor regardless of relative font size (some producers set display
     * operators LARGER than the base). 8 → 12 at calibration: merged fragment
     * chains ("\"#\"#∞∞ÕÕ𝑘𝑘" = 10 chars) must keep cascading into the base
     * band — an 8-char cap stalled the chain one band short. */
    readonly scriptFragmentChars: 12;
};
/**
 * stripPageFurniture — remove repeated running heads/feet and bare page
 * numbers from each page's items, BEFORE classification and assembly
 * (11-06 corpus calibration). Furniture is a FIRST-or-LAST band phenomenon:
 * a candidate must sit at a page edge, be short (≤ furnitureMaxChars), and
 * either be a bare page number or repeat (digit-normalized) on ≥
 * furnitureRepeatPages pages. Everything stripped here was breaking the
 * corpus three ways: furniture blocks polluted block agreement, section-end
 * gaps down to a lone page number manufactured unsupported "figure" regions,
 * and repeated head text made the SC#4a quote-resolution gate ambiguous.
 * Pages whose only content was furniture become empty — honestly blank
 * (not a "non-text region"), and still counted as near-empty for the
 * scanned verdict, which runs on the stripped pages.
 */
export declare function stripPageFurniture(pages: StructuredTextItem[][]): StructuredTextItem[][];
/** The document-level detection verdict. `multiColumn` weighs columnar pages
 * against TEXT-BEARING pages (a stray figure page must not refuse a prose
 * document); `scanned` weighs near-empty pages against ALL pages. */
export interface DocumentVerdict {
    totalPages: number;
    textBearingPages: number;
    nearEmptyPages: number;
    columnarPages: number;
    multiColumn: boolean;
    scanned: boolean;
}
/** Classify per-page text-item arrays into page-weighted verdicts. Pure —
 * hand-buildable in tests; `pdfToBlocks` feeds it the real extraction. */
export declare function classifyDocument(pages: StructuredTextItem[][]): DocumentVerdict;
/** Map a pdfjs failure to a typed refusal by error NAME — the stable pattern:
 * the PasswordException / InvalidPDFException classes exist in unpdf's
// bundled types but are NOT re-exported from the index, so name-string
 * matching is the contract (verified against unpdf 1.8.1; A6). Returns null
 * for unknown errors — the caller rethrows and the orchestrator's catch maps
 * non-IngestionError throws to `server-error`. */
export declare function mapPdfjsError(err: unknown): IngestionError | null;
/** Refuse documents over the page cap BEFORE any extract call (Pitfall 9 —
 * `extractTextItems` processes ALL pages in one call; the cap must bound that
 * work). Exported so the orchestrator can pre-check the same invariant. */
export declare function assertPageCap(numPages: number): void;
/** Run `op` against ONE document proxy: `maxImageSize` caps image-bomb
 * decompression inside pdfjs, the page cap bounds extraction work, the whole
 * operation races the extraction timeout, and the proxy is ALWAYS destroyed
 * (`loadingTask.destroy()` — the caller owns the lifecycle; unpdf's own
 * `withDocument` helper is not used because it destroys ITS proxies only). */
export declare function withPdfDocument<T>(bytes: Uint8Array, op: (pdf: PDFDocumentProxy) => Promise<T>): Promise<T>;
/** Minimal outline-entry shape the flattener reads (pdfjs's OutlineNode minus
 * display-only fields — keeps the stub-injectable surface small for tests). */
export interface OutlineEntryLike {
    title: string;
    dest: string | Array<any> | null;
    url: string | null;
    items: OutlineEntryLike[];
}
/** The pdfjs surface outline resolution needs (the real proxy satisfies this
 * structurally; the unit suite injects a stub — Pitfall 10's two dest shapes
 * are provable without an extra fixture). */
export interface OutlineCapablePdf {
    getOutline(): Promise<OutlineEntryLike[] | null>;
    getDestination(id: string): Promise<Array<any> | null>;
    getPageIndex(ref: unknown): Promise<number>;
}
/** One resolved outline heading target. `level` is clamp(depth + 2, 2, 6) —
 * top-level bookmarks coerce to h2 because article bodies start at h2 (the
 * one-h1 rule; ArticleView renders the title from provenance). */
export interface OutlineTarget {
    title: string;
    pageIndex: number;
    /** XYZ top y in PDF user space (y-UP), or null for Fit/no-y dests —
     * treated as "top of page". */
    destY: number | null;
    level: 2 | 3 | 4 | 5 | 6;
}
/** Resolve the outline into flat heading targets. url-bearing entries are
 * external links, not headings; null dests have no target; string dests
 * resolve through getDestination (named destinations — many LaTeX/Word
 * exporters use them); explicit arrays pass through as-is (Pitfall 10). */
export declare function outlineHeadingTargets(pdf: OutlineCapablePdf): Promise<OutlineTarget[]>;
/** Producer-garbage Info-title patterns (RESEARCH Example 2; A1 — corpus-
 * verified during calibration). Matches run against the TRIMMED title. */
export declare const PDF_TITLE_GARBAGE: readonly RegExp[];
/** A sane Info title: trimmed length 2–200 and no garbage pattern. The
 * adapter copies the Info title into `provenancePartial.title` ONLY when
 * sane; the filename → neutral fallbacks live in the orchestrator (11-03). */
export declare function isSanePdfTitle(t: string): boolean;
/** Extract the sanity-checked Info title (PascalCase "Title" key — verified
 * against unpdf's getMeta info dict). Exported for unit testing the sane /
 * insane wiring without an Info-bearing fixture. */
export declare function saneInfoTitle(info: Record<string, unknown>): string | undefined;
/** PdfToBlocksResult — byte-identical shape to `MarkdownToBlocksResult`
 * (markdownToBlocks.ts L308-314). The orchestrator destructures every Stage-1
 * branch with the same code; a drift here breaks the fourth branch. */
export interface PdfToBlocksResult {
    blocks: Block[];
    footnotes: {
        id: string;
        content: InlineRun[];
    }[];
    lang: string;
    provenancePartial: ProvenancePartial;
    isReaderable: boolean;
}
/**
 * pdfToBlocks — the unpdf → Block tree adapter. One proxy runs getMeta +
 * extractTextItems + getOutline under the caps/timeout above; errors map via
 * mapPdfjsError BEFORE anything else; the scanned verdict refuses BEFORE the
 * multi-column verdict (a scanned doc has no columns to detect); only then
 * does assembly run: y-descending lines (Pitfall 1), paragraph grouping on
 * vertical gap / font regime, hyphenation joins, outline-first heading
 * coercion with the font-size fallback (D11-08), and honest unsupported
 * blocks for non-text regions (Task 2).
 */
export declare function pdfToBlocks(pdfBytes: Uint8Array): Promise<PdfToBlocksResult>;
export {};
