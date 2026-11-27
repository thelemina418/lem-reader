// src/reader/footnoteExcursion.ts
// Spec #66 / issue #57 — the Footnote excursion (CONTEXT.md): a trip from a
// reference to its note and back. It is reader state, never persisted:
// following a reference records the occurrence it left from, and while the
// excursion lasts the saved reading position stays at that reference
// (useScrollSave's held offset). A return lands on the origin; any other
// deliberate move (a page turn, a reader scroll, a contents or highlight
// jump) ends it and saving resumes normally.
//
// This module is the pure routing decision for a clicked footnote link —
// both the paged surface and the scrolling handler ask it where to go.
import type { CanonicalArticle } from "../content/types";
import {
  footnoteReferenceSpans,
  parseFootnoteReferenceAnchorId,
} from "../content/footnoteReferences";
import { PLAIN_RETURN_ATTR } from "../content/render/FootnoteReturns";

export interface FootnoteExcursion {
  readonly footnoteId: string;
  /** The followed occurrence's anchor id (fn-ref-N / fn-ref-N-K). */
  readonly anchorId: string;
  /** Canonical start offset of that reference — the held save. */
  readonly offset: number;
  /** Scrolling mode only: the marker's viewport top when it was followed,
   * so the return brings it back to the same place on screen. */
  readonly viewportTop?: number;
}

export type FootnoteLinkRoute =
  /** Following a reference: go to the note and begin this excursion. */
  | { kind: "follow"; targetId: string; excursion: FootnoteExcursion }
  /** A return: go to this reference occurrence and end any excursion.
   * `origin` is set when the target is the excursion's own origin. */
  | { kind: "return"; targetId: string; origin?: FootnoteExcursion };

/**
 * Where a clicked footnote link leads. `anchor` is the clicked link; null
 * for anything that is not a footnote link of this article.
 *
 * - A reference (`#fn-N`, carrying its fn-ref id) follows to the note.
 * - The plain ↩ return of the note the reader is on an excursion to leads
 *   back to the reference actually followed; otherwise every return leads
 *   to the occurrence its href names.
 */
export function routeFootnoteLink(
  article: CanonicalArticle,
  anchor: Element,
  current: FootnoteExcursion | null,
): FootnoteLinkRoute | null {
  const href = anchor.getAttribute("href") ?? "";
  if (!href.startsWith("#fn-")) return null;
  const id = href.slice(1);
  const spans = footnoteReferenceSpans(article);
  if (/^fn-\d+$/.test(id)) {
    if (!article.footnotes.some((fn) => fn.id === id)) return null;
    const span = spans.find((s) => s.anchorId === anchor.id && s.footnoteId === id);
    if (!span) return null;
    return {
      kind: "follow",
      targetId: id,
      excursion: { footnoteId: id, anchorId: span.anchorId, offset: span.start },
    };
  }
  const parsed = parseFootnoteReferenceAnchorId(id);
  if (!parsed) return null;
  if (
    current !== null &&
    current.footnoteId === parsed.footnoteId &&
    (anchor.hasAttribute(PLAIN_RETURN_ATTR) || current.anchorId === id)
  ) {
    return { kind: "return", targetId: current.anchorId, origin: current };
  }
  return { kind: "return", targetId: id };
}
