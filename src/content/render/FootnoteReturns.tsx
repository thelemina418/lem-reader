// src/content/render/FootnoteReturns.tsx
// Spec #66 / issue #57 — the return chrome beside a note, shared by the
// scrolling footnotes section (BlockRenderer) and the paged note entry
// (fragmentRenderer) so the two never drift.
//
//   - A note cited once: one ↩ "Return to reference N".
//   - A note cited K ≥ 2 times: the plain ↩ ("Return from note N", which the
//     footnote excursion routes back to the reference the reader actually
//     followed) plus one return per reference — a, b, c — each labelled with
//     its reference ("Return to reference Na") and leading to its own
//     occurrence.
//   - A note with no reference in the body (an unreferenced note, or one
//     whose only marker was lost at ingest) gets no return at all — never a
//     link that leads nowhere (issue #60).
//
// The hidden measurement projection renders the SAME text as aria-hidden
// spans (no links, no identifiers) so measured line boxes match the page.
// Every href derives from schema-locked fn-N ids (digits only); React
// escapes attributes and text.
import { Fragment } from "react";
import type { CanonicalArticle } from "../types";
import { footnoteReferenceSpans } from "../footnoteReferences";

/** a, b, …, z, aa, ab, … — the K-th (1-based) return's letter. */
export function footnoteReturnLetter(occurrence: number): string {
  let k = occurrence;
  let out = "";
  while (k > 0) {
    k -= 1;
    out = String.fromCharCode(97 + (k % 26)) + out;
    k = Math.floor(k / 26);
  }
  return out;
}

/** Issue #57 / story 9 — a reference marker is announced as a footnote link
 * with its number. The publisher's marker text stays in the name
 * (label-in-name), so "1" reads "Footnote 1" and "[2]" reads "Footnote [2]". */
export function footnoteMarkerLabel(marker: string): string {
  return `Footnote ${marker.trim()}`;
}

/** Marks the plain ↩ return; the excursion redirects it to its origin. */
export const PLAIN_RETURN_ATTR = "data-footnote-return";

export function FootnoteReturns({
  article,
  footnoteId,
  measurementProjection = false,
}: {
  article: CanonicalArticle;
  footnoteId: string;
  measurementProjection?: boolean;
}): React.ReactElement {
  const n = footnoteId.replace(/^fn-/, "");
  const refs = footnoteReferenceSpans(article).filter((s) => s.footnoteId === footnoteId);
  if (refs.length === 0) return <></>;
  const several = refs.length > 1;
  const items: { key: string; text: string; href: string; label: string; plain: boolean }[] = [
    {
      key: "plain",
      text: "↩",
      href: `#${refs[0]!.anchorId}`,
      label: several ? `Return from note ${n}` : `Return to reference ${n}`,
      plain: true,
    },
  ];
  if (several) {
    for (const ref of refs) {
      const letter = footnoteReturnLetter(ref.occurrence);
      items.push({
        key: ref.anchorId,
        text: letter,
        href: `#${ref.anchorId}`,
        label: `Return to reference ${n}${letter}`,
        plain: false,
      });
    }
  }
  return (
    <>
      {items.map((item, i) => (
        <Fragment key={item.key}>
          {i > 0 ? " " : null}
          {measurementProjection ? (
            <span aria-hidden="true">{item.text}</span>
          ) : (
            <a
              href={item.href}
              aria-label={item.label}
              {...(item.plain ? { [PLAIN_RETURN_ATTR]: "" } : {})}
            >
              {item.text}
            </a>
          )}
        </Fragment>
      ))}
    </>
  );
}
