# Lem Reader

Language for organizing readings and dividing long works. Existing reader and annotation vocabulary lives in [CONTEXT.md](./CONTEXT.md).

## Language

**Collection**:
A reader-named, ordered grouping of references to whole readings or particular chapters, such as a playlist; a reading can belong to several collections. A collection does not own its readings or give them separate reading progress.
_Avoid_: book (when meaning a playlist), chapter (when meaning a separate reading in a collection)

**Collection entry**:
One place in a collection's order, referring to a whole reading or a particular chapter. Its completion is shared with other entries referring to the same reading or chapter, not a separate attempt.
_Avoid_: copy (membership does not duplicate the reading), reading part (a generated subdivision within a work)

**Chapter**:
A division within a single work, rather than an independent reading grouped into a collection.
_Avoid_: collection item (when meaning a division within a work)

**Chapter handoff**:
The reader's ordinary Next/Previous turn at a chapter's true end or start crossing to the neighboring existing chapter in book order — forward lands at the chapter start, backward at its end — while each chapter keeps its own article identity, annotations, and saved position, and the departing chapter's real position flushes before the swap. A layout window boundary is never a handoff; a handoff superseded by a newer reader action lands nowhere.
_Avoid_: chapter concatenation (chapters are never merged), merged article (no replacement article is created)

**Publisher outline evidence**:
The work's own chapter index, captured while the source document is available — same-page nav links whose targets are headings, or a heading-declared Index/Contents card's entries (by title text; hrefs are never fetched, so importing one URL never crawls chapter pages). It guides chapter boundaries only when it reconciles strictly with canonical headings in source order — the publisher's own occurrence ordinals corroborated by the document's occurrence count; otherwise honest heading-derived structure or generated reading parts take over, and captured titles are never rendered as markup.
_Avoid_: site adapter (per-source special cases), scraping (nothing beyond the offered document is fetched)

**Reading part**:
An automatically generated subdivision that makes a long work or chapter manageable to read, without claiming to be an author-written chapter.
_Avoid_: chapter (for a generated subdivision with no authorial basis)

**Reading plan**:
A self-paced use of a collection to follow readings in a chosen order, without an implied calendar, deadlines, or reminders.
_Avoid_: schedule, assignment calendar

## Channels

**Channel**:
A named, always-on place where readers use Lem Reader, each holding its own separate local library, settings, and annotations. Moving between channels never carries a library along; export and import do.
_Avoid_: environment (for the reader-facing place), instance, site

**Production**:
The channel readers rely on, showing the most recently published release.
_Avoid_: live, stable, prod site (when meaning a particular address)

**Next**:
The pre-release channel showing the latest merged work before it is released, marked as Next wherever it is shown so its library is never mistaken for the Production one.
_Avoid_: preview (a per-change deploy, which Lem Reader does not have), nightly (Next is not scheduled), beta, staging

**Legacy domain**:
The original Production address, kept serving Production so existing readers' libraries stay reachable, and nudging them once to carry their library to the primary address by export and import.
_Avoid_: old site, mirror (it is the same Production, not a copy)

**Release**:
A published, versioned decision that a specific build already proven on Next becomes Production.
_Avoid_: deploy (for the act of going live), tag (for the decision itself)
