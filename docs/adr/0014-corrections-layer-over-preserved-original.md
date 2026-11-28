# Reader corrections are a layer over the preserved original, not an overwrite

Ingestion sometimes gets an article's structure wrong: text from the body ends up in a photo caption, a heading becomes a paragraph, or site chrome survives extraction. Readers can fix this with **corrections** made in the **correction view**. We decided that the article as it was ingested is never overwritten. What the reader sees is the original with the reader's ordered list of corrections applied on top. Each correction can be undone on its own, the original can always be restored, and export/import carries both the original and the corrections.

We chose this because corrections have to survive **reprocessing**. Reprocessing an article (to pick up better footnote or embed handling, say) yields a new original, and each correction is then applied again by finding its text, the same way highlights are re-matched. A correction that no longer fits is listed as not applied, never silently dropped. If corrections were overwrites, reprocessing would either throw away the reader's work or be impossible.

## Considered options

- **Overwrite the article as a new revision** (rejected): simplest to store, but it loses the as-ingested original, makes "restore original" impossible, and leaves reprocessing to choose between the reader's fixes and the improved ingest.
- **Free-form editing of the article from the start** (deferred, not rejected): the first phase is structure only — changing a block's type (paragraph, heading, quotation, caption, code block), moving words across a block boundary, splitting, merging, and hiding a block. Under these the article's words barely change, so highlights almost always still match. Text fixes come in a later phase, and highlights they leave unmatched are shown as orphaned. Converting text to or from lists is also left for later.

## Consequences

- A **hidden block** stays in the original. It is gone from reading, read-aloud, and reading time, and shown dimmed in the correction view.
- A correction that would leave a highlight unmatched, or change chapters (and so collection entries), shows its consequences before it applies, following the PDF repair preview. Corrections with no consequences apply immediately.
- The reading position is carried across entering and leaving the correction view, adjusted for any corrections made (ADR 0001's single position stays the only answer to "where am I?").
- PDF repair stays distinct: it is the app reprocessing a PDF, not a reader correction.
