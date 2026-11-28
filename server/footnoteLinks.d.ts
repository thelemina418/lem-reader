/** The most notes one article keeps (Markdown shares it). Notes past it are
 * left out and counted in `omittedCount` for the ingest disclosure. */
export declare const MAX_LINKED_FOOTNOTES = 1000;
/** The controlled reference href the rewrite emits for note `n` (1-based). */
export declare function footnoteHref(n: number): string;
/** Parse a controlled reference href back to its note number, or null. */
export declare function footnoteNumberFromHref(href: string): number | null;
export interface LinkedFootnotes {
    /** Raw (UNSANITIZED) inner HTML of each detected note, in note order:
     * index i is note `fn-(i+1)`. Back-links are already removed. */
    noteHtml: string[];
    /** Notes found past MAX_LINKED_FOOTNOTES and left out (issue #60). */
    omittedCount: number;
}
/** Is `target` the reference itself, an inline wrapper of it, or the empty
 * anchor placed just before it — the places a back-link may point? */
export declare function isReferencePoint(target: Element, reference: Element): boolean;
/** The note a reference's target sits in: its list item, else the nearest
 * block that holds the target (the target itself when it is a block). */
export declare function noteContaining(target: Element): Element | null;
export declare function isMarkerLike(link: Element): boolean;
/** Is `note` inside a structure the page declares as its notes — by DPUB
 * role or by a notes heading just before it or leading it? */
export declare function inNotesSection(note: Element, body: Element): boolean;
/** Does EPUB markup declare `link` → `note` a footnote reference? */
export declare function declaresEpubNote(link: Element, note: Element, body: Element): boolean;
/**
 * detectLinkedFootnotes — find Footnote references by their link graph and
 * rewrite `document` in place (see the module comment). Returns the detected
 * notes' raw HTML in note order.
 */
export declare function detectLinkedFootnotes(document: Document, options?: {
    epubSemantics?: boolean;
}): LinkedFootnotes;
