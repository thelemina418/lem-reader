# PDF heading integrity and safe structural repair

Status: product scope confirmed through a design interview. Implemented since; see [PDF structure repair implementation](pdf-repair-implementation.md) and [PDF navigation verification](pdf-navigation-verification.md). This document remains the product-scope record.

Related: [collections and long works](collections-and-long-works.md), [domain language](../../GLOSSARY.md), [reading identity and collection ownership](../adr/0011-reading-identity-and-collection-ownership.md).

## Problem and confirmed evidence

The reader supplied `anti_duhring.pdf` (Friedrich Engels, 214 pages, approximately 3 MB). A read-only reproduction through the real `server/pdfToBlocks.ts` adapter returned 1,153 blocks, including 339 headings. Two ordinary body passages became level-3 headings:

- “The following work is by no means the fruit of any ‘inner urge’…”: 668 characters.
- “Nevertheless it was a year before I could make up my mind…”: 2,699 characters.

The PDF outline has a destination-less “Word Bookmarks” root with 500 mostly numeric child bookmarks. Their destinations point into body prose. The adapter's outline-first path promotes nearby assembled text drafts wholesale, without title reconciliation or independent heading qualification. The reproduced passages are approximately 11.04 pt body text; the genuine “Preface – London, 1878” title is 24 pt.

Canonical heading classification explains the enlarged/bold reader text and paragraph-length Contents labels. Heading-derived chapter boundaries can also give these entries completion controls. These are divisions within a saved work, not collection entries.

The exact reported involuntary page jumping has **not** been reproduced in browser layout. Atomic heading pagination is a plausible contributor, not a confirmed explanation. An earlier HTML-ingestion hypothesis was superseded by the actual PDF reproduction.

## 1. Conservative heading inference

- A PDF bookmark is structural evidence, not authority to classify its destination text as a heading.
- Heading promotion requires independent corroboration from meaningful title agreement or heading presentation cues. Destination geometry alone is insufficient.
- Arbitrary numeric bookmarks pointing into prose must not promote that prose. Numeric titles are not universally invalid: genuine numbered headings remain supported.
- Ignore unmatched or duplicate bookmark evidence rather than promote successive neighboring paragraphs or invent destinations.
- Preserve all reliably extracted text. Retain independently recognized headings and use honest generated reading parts when reliable chapters are unavailable.
- Length alone must never determine whether text is prose or a heading. Genuine long headings remain possible.
- Correct the canonical structure, not merely the displayed Contents label.
- Do not automatically reconstruct paragraph boundaries as part of this fix. Several paragraphs may currently be assembled into one draft; splitting requires separately established reliable boundaries and consideration of anchor compatibility.

## 2. Navigation resilience

- Malformed imported structure must not cause involuntary page jumping, independently of whether its Contents entries have been repaired.
- An oversized genuine heading may continue across pages while retaining heading semantics and one Contents destination.
- Keeping a heading together is a preference when it fits, not an unconditional atomic-layout requirement.
- Never truncate readable content or change its semantics solely to make it fit a page.
- Defensive layout improvements must benefit existing works without requiring structural repair first.
- Shortening Contents labels alone does not satisfy the structural or navigation requirements.

## 3. Repair of existing saved works

Fixing future intake is insufficient: persisted canonical headings and structure snapshots can retain the defect.

- Structural repair is an explicit, previewable action, not a silent change when opening a work.
- The preview explains affected headings and chapter boundaries, along with consequences for reader data.
- Preserve the saved work's identity, reading position, highlights, notes, and completion state wherever correspondence is reliable.
- Never silently discard reader data, guess annotation attachment, or reassign completion to a different chapter.
- If reliable preservation cannot be established, keep the proposed repair unapplied until the reader explicitly accepts the identified consequences. The original remains intact by default.
- Applying repair preserves a recoverable pre-repair version, including associated reader-state changes. Recovery must not depend on reimporting the source and losing local history.
- Collection references to affected chapters must be accounted for consistently with the existing identity and ownership contract; they must not silently retarget a different chapter.

This scope does not select a snapshot schema, repair mapping algorithm, retention policy, or interaction design. Those choices must satisfy the above guarantees and be verified before shipping repair.

## 4. Acceptance evidence

### Ingestion

- Exercise the real PDF adapter with the supplied work: both named prose passages remain paragraphs, while the genuine preface title remains a heading.
- Add a small synthetic numeric-bookmark-to-body regression fixture so coverage does not depend solely on the 214-page reference PDF.
- Cover unmatched and duplicate destinations without neighboring-prose promotion.
- Preserve legitimate numbered headings and genuinely long headings; no blanket numeric-title rejection or length-only demotion.
- Preserve extracted text without omissions, duplication, or invented paragraph breaks.

### Reader

- Reproduce the reported jumping using the affected work and record the triggering navigation/layout conditions before claiming it fixed.
- Verify oversized-heading page continuation and stable navigation separately from inference correctness.
- Exercise existing saved malformed content as well as newly imported corrected content.
- If the exact reported jumping cannot be reproduced, explicitly record the verification gap; do not equate an ingestion regression test with a navigation fix.

### Repair

- Verify preview, safe application, and recovery of the pre-repair work and associated reader state.
- Verify reliable preservation of positions, annotations, completion, and affected collection references.
- Verify that uncertain mappings remain unapplied without explicit acceptance and never silently reattach annotations.

## Non-goals

- A general manual chapter-boundary or Contents editor.
- Universal PDF paragraph reconstruction.
- HTML-specific extraction changes without separate evidence.
- Silent migrations, automatic reimport, or replacement of the work with newly identified readings.
- Merely truncating oversized Contents labels and declaring the issue solved.
