import { XMLParser } from "fast-xml-parser";
import { type FootnoteBodyT } from "../src/content/footnoteBody";
import type { Block } from "../src/content/schema";
import { type ImageAsset } from "./fetchImageAsset";
export declare const EPUB_THRESHOLDS: {
    /** D12-10 admission floor: a readerable chapter document walks to at least
     * this many blocks (the 11-07 relaxed algebra, document unit). Cover
     * plates and pure-image pages fail it; front matter with real paragraphs
     * passes. */
    readonly minChapterBlocks: 3;
    /** D12-09 fallback floor: fewer than this many distinct TOC entries
     * resolving to spine positions ⇒ one-chapter-per-readerable-spine-item. */
    readonly tocMergeMinEntries: 2;
    /** XML nesting cap (below the fast-xml-parser 100 default — OPF/NCX/nav
     * are shallow; hostile nesting is T-12-08). */
    readonly maxNestedXmlTags: 40;
};
/**
 * createEpubXmlParser — the ONE hardened parser configuration shared by the
 * container.xml, OPF, nav, NCX, and encryption.xml parses. Exported so unit
 * tests pin the removeNSPrefix key convention directly (assumption A7: with
 * removeNSPrefix:true, dc:title arrives as key "title" and the nav epub:type
 * attribute as "@_type").
 */
export declare function createEpubXmlParser(): XMLParser;
/**
 * normalizeEpubHref — map a raw TOC/manifest href onto a zip-root-relative
 * path: decode %XX (an undecodable sequence stays LITERAL — tolerant, a
 * non-matching href is simply ignored downstream, never a refusal), resolve
 * `../` and `./` against `baseDir` (the nav/NCX/OPF document's directory),
 * strip the #fragment, and posix-join. Comparison against entry names stays
 * case-sensitive (spec paths ARE case-sensitive). BOTH the TOC side and the
 * manifest side normalize through THIS function — the whole Pitfall 1
 * mitigation is that they cannot disagree.
 */
export declare function normalizeEpubHref(rawHref: string, baseDir: string): string;
/**
 * withEpubTimeout — race `op` against EPUB_EXTRACTION_TIMEOUT_MS; the timer
 * is ALWAYS cleared in `finally`. A timeout refuses `epub-unreadable` with a
 * message naming the timeout (the planner fold of a dedicated timeout
 * reason — mirrors the pdfToBlocks fold).
 */
export declare function withEpubTimeout<T>(op: () => Promise<T>): Promise<T>;
/** Refuse books over the chapter cap — `epub-too-large`. Exported so the
 * orchestrator can pre-check the same invariant. */
export declare function assertChapterCap(count: number): void;
/** One manifest item, href normalized to a zip-root-relative path. */
export interface EpubManifestItem {
    id: string;
    href: string;
    mediaType: string;
    /** Space-separated properties (e.g. "nav" on the EPUB 3 nav document). */
    properties?: string;
}
/** One spine position. `item` is undefined for a dangling idref (tolerated —
 * the position has no document and is structurally skipped). */
export interface EpubSpineItem {
    idref: string;
    /** "no" = purely supplemental per spec — a skip HINT only; the D12-10
     * readerability gate decides. */
    linear: "yes" | "no" | undefined;
    item: EpubManifestItem | undefined;
}
/** Book-level metadata extracted from the OPF (dc:title/dc:language are
 * spec-REQUIRED — a missing title falls back to "Untitled book" and a
 * missing language to "en" rather than refusing; spec-tolerance wins over
 * spec-strictness for the reader). */
export interface EpubBookMeta {
    title: string;
    authors: string[];
    language: string;
    publisher?: string;
    publishedDate?: string;
    identifier?: string;
}
/** The archive + DRM + container + OPF parse stage, exported pure for unit
 * testability (the pdfToBlocks precedent of pure exported helpers). */
export interface EpubArchive {
    bookMeta: EpubBookMeta;
    /** Directory of the OPF inside the zip ("" when at the root). */
    opfDir: string;
    manifestItems: EpubManifestItem[];
    spine: EpubSpineItem[];
    /** The manifest item whose properties include "nav" (EPUB 3), if any. */
    navItem: EpubManifestItem | undefined;
    /** The spine@toc NCX manifest item (EPUB 2), if declared and present. */
    ncxItem: EpubManifestItem | undefined;
    /** Decoded UTF-8 text of a zip entry by root-relative path. */
    entryText(href: string): string | undefined;
    /** Raw bytes of a zip entry by root-relative path — the 20-06 container
     * extraction's ONLY read source (zero network by construction; the key
     * was slip-gated in unzipEpub before any entry byte exists). */
    entryBytes(href: string): Uint8Array | undefined;
}
/**
 * parseEpubArchive — the verified parse chain up through the OPF (Pattern 2):
 * unzip → slip gate → DRM gate → container.xml → OPF (metadata + manifest +
 * spine). Every refusal on this chain is a typed IngestionError; manifest
 * hrefs normalize through the ONE shared normalizeEpubHref so the manifest
 * side and the TOC side cannot disagree (Pitfall 1). Deprecated OPF
 * elements (bindings/tours/guide — EPUB 3.3 Appendix A) are simply never
 * read.
 */
export declare function parseEpubArchive(bytes: Uint8Array): EpubArchive;
/** One chapter, ready for stages 2+ of the ingestion pipeline. Carries the
 * SAME five per-article fields the other Stage-1 adapters emit, plus
 * sourceHtmlHash (sha256 of the chapter's concatenated spine-item XHTML —
 * the IngestionMeta.originalHtmlHash input, so the orchestrator never
 * re-reads bytes) and the 20-06 container-extraction outputs: accepted
 * chapter-figure assets + the per-figure refusal count for disclosure. */
export interface ChapterDraft {
    blocks: Block[];
    footnotes: FootnoteBodyT[];
    lang: string;
    title: string;
    /** First spine position of the chapter's content (debug/traceability). */
    spineIndex: number;
    sourceHtmlHash: string;
    /** 20-06: accepted chapter-figure assets (document order, deduped by
     * assetId) — ride the draft onto the book envelope. */
    assets: ImageAsset[];
    /** 20-06: per-figure refusals, disclosed through extractionWarnings
     * (D12-11 honesty mirror — refused figures are never silently dropped). */
    figureRefusedCount: number;
    /** Issue #60: notes past the cap left out of the chapter's documents,
     * disclosed through extractionWarnings (footnotesOmittedWarning). */
    omittedFootnoteCount: number;
}
/** The adapter output (12-RESEARCH Pattern 1 — planner-confirmed shape). */
export interface EpubToBooksResult {
    bookMeta: EpubBookMeta;
    /** Ordered, TOC-merged (D12-09), readerable (D12-10) chapters. */
    chapters: ChapterDraft[];
    /** D12-11 disclosure: spine documents that existed but did not admit. */
    skippedCount: number;
    /** sha256 of the EPUB bytes (book-id derivation + dedupe-refuse input). */
    originalFileHash: string;
    /** Whether the one-chapter-per-spine-item fallback partition fired (the
     * calibration warning sign — Pitfall 1: true on a book with a good TOC
     * means href normalization regressed). */
    fallbackUsed: boolean;
}
/**
 * epubToBooks — bytes in, book + chapter drafts out (pure: no I/O beyond
 * the bytes, no Dexie, no React — SC#4 adapter isolation). The whole parse
 * races the extraction timeout. A book whose spine yields ZERO readerable
 * documents refuses `epub-empty` here (the orchestrator separately refuses
 * when all chapters fail stages 2+ — D12-11).
 */
export declare function epubToBooks(bytes: Uint8Array): Promise<EpubToBooksResult>;
