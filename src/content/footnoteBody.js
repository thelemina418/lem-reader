/** The note's paragraphs, in order (one entry for a one-paragraph note). */
export function footnoteParagraphs(fn) {
    return fn.laterParagraphs ? [fn.content, ...fn.laterParagraphs] : [fn.content];
}
/** The note as one block-shaped coordinate view (see the module comment). */
export function footnoteBodyAsBlock(fn) {
    if (!fn.laterParagraphs)
        return { kind: "paragraph", content: fn.content };
    return {
        kind: "blockquote",
        children: footnoteParagraphs(fn).map((content) => ({ kind: "paragraph", content })),
    };
}
/** The canonical Footnote body for a note's paragraphs — the ONE ingest
 * constructor (HTML, Markdown, and later EPUB): the first paragraph is
 * `content`, later ones ride `laterParagraphs`, which is absent for a
 * one-paragraph note (the pre-#59 shape, byte-identical). A note with no
 * paragraphs has empty `content`; callers decide whether to keep it. */
export function footnoteBodyFromParagraphs(id, paragraphs) {
    const [first = [], ...later] = paragraphs;
    return later.length > 0 ? { id, content: first, laterParagraphs: later } : { id, content: first };
}
