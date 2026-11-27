// src/content/render/InlineRenderer.tsx
// Inline mark renderer (D-04 locked set: link, code, strong, em). Mark-
// application order: iterate run.marks and wrap the text node in array order
// (strong, em, code, link). The link mark uses the schema-validated href
// directly — the scheme allow-list already ran at Zod parse time (Pitfall 5
// defense in depth at the boundary). Inline <code> is rendered as <code>
// (styling lives in app.css). NEVER use the React raw-HTML injection prop
// anywhere in this file (Pitfall 6 — react/no-danger enforces statically).
//
// Phase 5 Plan 05-02 (D5-15 — inline highlight rendering): InlineList accepts
// an optional `highlightSlices` prop (produced by sliceRunsForHighlights from
// Plan 05-01). When present, each slice whose highlightId !== null is wrapped
// in <mark class="highlight" tabindex=0 aria-…>. The existing `Inline` mark-
// wrapping loop is REUSED UNCHANGED inside each slice (a link inside a
// highlight stays active — D5-07). NO parallel renderer is forked (DOC-02
// reading order + D-05 offset integrity depend on reusing this same output).
import { createContext, useContext } from "react";
import type { Block, InlineRun } from "../types";
import { footnoteReferenceAnchorId } from "../footnoteReferences";
import { footnoteMarkerLabel } from "./FootnoteReturns";
import type { HighlightSlice } from "../../annotations/highlightRanges";
// Issue #118 — the shared mark-trait helpers (the ONE className + aria-label
// copy contract, shared with the code twin in BlockRenderer).
import { highlightAriaLabelForText, highlightClassName } from "../../annotations/highlightColors";
// Issue #42: the synthetic spoken-word marker rides the SAME slicer output
// as annotation marks, but branches on the reserved id into an aria-hidden,
// non-focusable <mark> — per-word updates never enter the accessibility
// tree, never take focus, and never open the annotation popover. The ONE
// mark anatomy lives in SpokenMark (shared with the code-block path).
import { isSpokenMarkerId } from "../../annotations/spokenMarker";
import { SpokenMark } from "./SpokenMark";
// Issue #196 — the ONE --highlight-custom inline-style spelling (the tint
// was derived at the mapping site; this just carries it onto the mark).
import { tintMarkStyle } from "../../settings/highlightTint";

/**
 * Spec #66 / issue #55 — TRUE inside a hidden measurement body. Inline
 * footnote references there render their marker as plain superscript text:
 * no fn-ref ids and no #fn links (issue #235 — the visible page is the only
 * place an exposed footnote identifier may exist). ArticleBody provides it
 * from its `measurementProjection` prop; everything else is visible.
 */
export const MeasurementProjectionContext = createContext(false);

/**
 * Spec #66 review H1 — the article's legacy block-level reference anchor ids
 * (legacyReferenceAnchorIds), provided by ArticleBody and the paged
 * fragment view so a legacy note cited twice renders `fn-ref-N-2` for its
 * second reference, never a duplicate `fn-ref-N`.
 */
export const LegacyReferenceAnchorsContext = createContext<ReadonlyMap<Block, string> | null>(null);

/**
 * Review H2 — a highlight boundary inside a marker splits its run into
 * pieces; only the first piece of an occurrence carries the anchor id
 * (the Phase 19 first-slice-only id precedent), every piece keeps the link.
 */
function Inline({ run, stampAnchorId = true }: { run: InlineRun; stampAnchorId?: boolean }) {
  const measurementProjection = useContext(MeasurementProjectionContext);
  let node: React.ReactNode = run.text;
  for (const mark of run.marks) {
    switch (mark.type) {
      case "footnote-ref":
        // The Footnote reference (issue #55): a superscript link to its note.
        // footnoteId is schema-locked to /^fn-\d+$/ and the anchor id derives
        // from it (fn-ref-N / fn-ref-N-K), so neither can clobber the DOM.
        node = measurementProjection ? (
          <sup>
            <span>{node}</span>
          </sup>
        ) : (
          <sup>
            <a
              id={
                stampAnchorId
                  ? footnoteReferenceAnchorId(mark.footnoteId, mark.occurrence)
                  : undefined
              }
              href={`#${mark.footnoteId}`}
              aria-label={footnoteMarkerLabel(run.text)}
            >
              {node}
            </a>
          </sup>
        );
        break;
      case "strong":
        node = <strong>{node}</strong>;
        break;
      case "em":
        node = <em>{node}</em>;
        break;
      case "code":
        node = <code>{node}</code>;
        break;
      case "link":
        // href was scheme-validated at Zod parse time (Pitfall 5)
        node = (
          <a href={mark.href} title={mark.title}>
            {node}
          </a>
        );
        break;
    }
  }
  return <>{node}</>;
}

/** The per-slice aria-label: the shared §Copywriting derivation (the ONE
 * copy in highlightColors.ts) fed from the slice's bundled traits. */
function highlightAriaLabel(slice: HighlightSlice): string {
  return highlightAriaLabelForText(slice.runs.map((r) => r.text).join(""), {
    color: slice.color ?? "default",
    customColor: slice.customColor,
    hasNote: slice.hasNote,
    status: slice.status,
  });
}

export function InlineList({
  runs,
  highlightSlices,
}: {
  runs: InlineRun[];
  /**
   * Optional: the run slices produced by sliceRunsForHighlights (Plan 05-01).
   * When present, each slice whose highlightId !== null is wrapped in
   * <mark class="highlight"> with tabindex=0 + aria-label.
   * When absent (no highlights in this block), InlineList renders exactly as
   * before — the existing `runs` prop maps to <Inline> components directly.
   */
  highlightSlices?: HighlightSlice[];
}): React.ReactElement {
  // When no highlight slices are provided, render the runs directly (the
  // pre-Phase-5 path — byte-unchanged so existing tests regress nothing).
  if (!highlightSlices || highlightSlices.length === 0) {
    return (
      <>
        {runs.map((r, i) => (
          <Inline key={i} run={r} />
        ))}
      </>
    );
  }

  // Review H2 — first piece of each reference occurrence stamps its id.
  const stamped = new Set<string>();
  const run = (r: InlineRun, key: number) => {
    let stamp = true;
    for (const mark of r.marks) {
      if (mark.type !== "footnote-ref") continue;
      const id = footnoteReferenceAnchorId(mark.footnoteId, mark.occurrence);
      stamp = !stamped.has(id);
      stamped.add(id);
    }
    return <Inline key={key} run={r} stampAnchorId={stamp} />;
  };

  // Highlight-aware path: render each slice. Highlighted slices (highlightId
  // !== null) wrap in <mark class="highlight"> with ARIA. The Inline mark-
  // wrapping loop is reused UNCHANGED inside each slice (D5-07 — a link inside
  // a highlight stays active). React escapes text children + attributes — no
  // injection surface (Pitfall 8 / T-05-06 mitigation).
  return (
    <>
      {highlightSlices.map((slice, i) => {
        if (slice.highlightId === null) {
          // Un-highlighted gap slice — render its runs directly.
          return <span key={i}>{slice.runs.map((r, j) => run(r, j))}</span>;
        }
        if (isSpokenMarkerId(slice.highlightId)) {
          return <SpokenMark key={i}>{slice.runs.map((r, j) => run(r, j))}</SpokenMark>;
        }
        // Highlighted slice — wrap in <mark class="highlight">. The modifiers
        // reflect the D5-02 tri-state (Plan 05-04): confident → bare fill;
        // hasNote → dotted underline; ambiguous/orphan → dashed outline
        // (.unresolved — Pitfall 7 never silent re-attach). Issue #118 adds
        // the named-color modifier (`color-<name>`; Default renders bare).
        // Issue #196 — a custom color snapshot swaps the named modifier for
        // `color-custom` and paints the derived readable tint under the
        // mark's own --highlight-custom (the tint was derived at the mapping
        // site against the active theme — preview = render by construction).
        // The states stay distinguishable by SHAPE alone (A11Y-05
        // forced-colors safety — color is never the sole identifier). Both
        // modifiers ride the ONE shared traits helpers (the code-twin mark
        // in BlockRenderer uses them verbatim).
        const className = highlightClassName({
          color: slice.color ?? "default",
          customColor: slice.customColor,
          hasNote: slice.hasNote,
          status: slice.status,
        });
        const markStyle = tintMarkStyle(slice.tint);
        return (
          <mark
            key={i}
            // Phase 19 (Pitfall 2 — first-slice-only DOM id): the id stamps
            // ONLY the highlight's document-order first slice (slice.isFirst,
            // set by the slicer when the highlight's global start lies within
            // this block). data-highlight-id below stays on EVERY slice, so
            // activation/controls targeting + the shared identity are
            // unaffected; the jump focus target (ArticleView's
            // getElementById) lands at the span's start by construction.
            id={slice.isFirst === true ? `hl-${slice.highlightId}` : undefined}
            className={className}
            data-highlight-id={slice.highlightId}
            tabIndex={0}
            aria-label={highlightAriaLabel(slice)}
            style={markStyle}
          >
            {slice.runs.map((r, j) => run(r, j))}
          </mark>
        );
      })}
    </>
  );
}

export { Inline };
