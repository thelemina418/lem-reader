import type { CanonicalArticle } from "../content/types";
import { footnoteRowFor } from "../content/normalizeText";
import {
  footnoteReferenceSpans,
  parseFootnoteReferenceAnchorId,
} from "../content/footnoteReferences";

/** Resolve a note/return fragment to the reader's canonical position currency.
 * `#fn-N` is the note; `#fn-ref-N` / `#fn-ref-N-K` is a reference occurrence
 * (inline marks — including nested in quotations and lists — and the legacy
 * block form alike; issue #55). Missing IDs and empty note bodies have no
 * destination. */
export function footnoteAnchorOffset(article: CanonicalArticle, href: string): number | null {
  const id = href.slice(1);
  if (/^fn-\d+$/.test(id)) {
    const index = article.footnotes.findIndex((fn) => fn.id === id);
    return index < 0 ? null : (footnoteRowFor(article, index)?.start ?? null);
  }
  if (parseFootnoteReferenceAnchorId(id) === null) return null;
  return footnoteReferenceSpans(article).find((span) => span.anchorId === id)?.start ?? null;
}
