import type { Block, CanonicalArticle, InlineRun } from "./types";
export type FootnoteBodyT = CanonicalArticle["footnotes"][number];
/** The note's paragraphs, in order (one entry for a one-paragraph note). */
export declare function footnoteParagraphs(fn: FootnoteBodyT): InlineRun[][];
/** The note as one block-shaped coordinate view (see the module comment). */
export declare function footnoteBodyAsBlock(fn: FootnoteBodyT): Block;
/** The canonical Footnote body for a note's paragraphs — the ONE ingest
 * constructor (HTML, Markdown, and later EPUB): the first paragraph is
 * `content`, later ones ride `laterParagraphs`, which is absent for a
 * one-paragraph note (the pre-#59 shape, byte-identical). A note with no
 * paragraphs has empty `content`; callers decide whether to keep it. */
export declare function footnoteBodyFromParagraphs(id: string, paragraphs: InlineRun[][]): FootnoteBodyT;
