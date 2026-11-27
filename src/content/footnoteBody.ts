// src/content/footnoteBody.ts
// Issue #59 — the Footnote body model: a note is one or more paragraphs.
//
// The stored shape is additive (schema.ts FootnoteBody): `content` is the
// first paragraph, `laterParagraphs` the rest (absent for a one-paragraph
// note). Every consumer reads a note through this module, never the fields:
//
// - `footnoteParagraphs(fn)` — the note's paragraphs, in order.
// - `footnoteBodyAsBlock(fn)` — the note as ONE block-shaped value, the
//   input of the shared slicing machinery (src/pagination/splitBlock.ts
//   `footnoteBodyBlock` caches it) and of the D-05 text contribution
//   (normalizeText.ts `footnoteText`). A one-paragraph note is a paragraph
//   (byte-identical to the pre-#59 view); a multi-paragraph note is a
//   blockquote-shaped CONTAINER of paragraphs, so its normalized text joins
//   the paragraphs with BLOCK_SEPARATOR and it slices at paragraph and line
//   boundaries exactly like a body blockquote. The container is a coordinate
//   view only: renderers draw its children as plain <p> inside the note,
//   never as a <blockquote>.
import type { Block, CanonicalArticle, InlineRun } from "./types";

export type FootnoteBodyT = CanonicalArticle["footnotes"][number];

/** The note's paragraphs, in order (one entry for a one-paragraph note). */
export function footnoteParagraphs(fn: FootnoteBodyT): InlineRun[][] {
  return fn.laterParagraphs ? [fn.content, ...fn.laterParagraphs] : [fn.content];
}

/** The note as one block-shaped coordinate view (see the module comment). */
export function footnoteBodyAsBlock(fn: FootnoteBodyT): Block {
  if (!fn.laterParagraphs) return { kind: "paragraph", content: fn.content };
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
export function footnoteBodyFromParagraphs(id: string, paragraphs: InlineRun[][]): FootnoteBodyT {
  const [first = [], ...later] = paragraphs;
  return later.length > 0 ? { id, content: first, laterParagraphs: later } : { id, content: first };
}
