import { type FootnoteBodyT } from "../src/content/footnoteBody";
import type { Block } from "../src/content/schema";
/** A book-internal link target: a spine document path and an element id. */
export interface BookTarget {
    path: string;
    fragment: string;
}
/** Resolve a raw href written in the document at `fromPath` to a
 * book-internal target, or null (external, no fragment, unresolvable). */
export type BookHrefResolver = (rawHref: string, fromPath: string) => BookTarget | null;
/** Record the fragments `xhtml` (at `path`) links to in OTHER documents
 * into `out` (path → fragments) — a cheap string prefilter, before parsing. */
export declare function collectCrossFileTargets(xhtml: string, path: string, resolve: BookHrefResolver, out: Map<string, Set<string>>): void;
/** Can `document` hold a note at any of the linked `fragments`? A note-like
 * container that is declared (epub:type), sits in a notes section, or has a
 * link that could be a back-link. Documents that cannot (chapters an HTML
 * contents page links into) are not kept parsed as note sources. */
export declare function mayHoldNotes(document: Document, fragments: Iterable<string>): boolean;
/** The notes copied into one chapter document, in copy order. */
export interface CopiedNotes {
    wrapper: Element;
    copies: {
        element: Element;
        source: string;
        notePath: string;
    }[];
}
/**
 * copyReferencedNotes — copy into `doc` every note it references in another
 * spine document (`sources`, parsed separately and never mutated), and point
 * each reference at its copy. A cross-file link is a reference by the same
 * evidence the shared detection accepts: EPUB note semantics, a back-link
 * to the link, or a marker-like link into a notes section. The copies sit in
 * a trailing `epub:type="endnotes"` section, so the shared detection then
 * accepts every one of them. Links in `doc` that name `doc` itself
 * (`ch1.xhtml#n1` inside ch1.xhtml) become plain fragments, so in-chapter
 * notes linked that way are found too. Returns undefined when nothing was
 * copied.
 */
export declare function copyReferencedNotes(doc: {
    path: string;
    document: Document;
}, sources: ReadonlyMap<string, Document>, resolve: BookHrefResolver): CopiedNotes | undefined;
/**
 * settleCopiedNotes — after the shared detection ran on a document holding
 * copies: the source key of each detected note (undefined for the
 * document's own notes), and the leftover copies removed. Detected notes
 * are in document order and the copies trail the document, so the
 * extracted copies are the tail of the found notes; notes past the cap
 * (issue #60, `omittedCount`) leave the flow too but are not kept.
 */
export declare function settleCopiedNotes(copied: CopiedNotes | undefined, detectedCount: number, omittedCount?: number): (string | undefined)[];
/** One spine document's walked blocks and notes (local ids fn-1…fn-k). */
export interface DocumentNotes {
    blocks: Block[];
    footnotes: FootnoteBodyT[];
    /** Parallel to `footnotes`: the source note a copy came from. */
    sources: (string | undefined)[];
}
/**
 * numberChapterNotes — one chapter's notes from its documents: renumbered
 * fn-1…fn-N in document order, a copied note kept once per chapter, and
 * each reference occurrence recounted in document order. A note with no
 * text is dropped and its references read as plain text (never a dead
 * link).
 */
export declare function numberChapterNotes(docs: DocumentNotes[]): {
    blocks: Block[][];
    footnotes: FootnoteBodyT[];
};
