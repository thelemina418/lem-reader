# Lem Reader

A calm, booklike reader for web articles and documents: long-form content is normalized once at ingest, then presented as responsive pages or a clean scrolling view — local-first, no accounts.

## Language

**Annotation panel**:
The controls for one highlight and its optional note and highlight tags, treated as one editing session. Closing saves the note and returns the reader to where they opened it.
_Avoid_: separate highlighter and note windows

**Annotations review**:
The cross-library destination listing highlights and article notes together, with All, Highlights, and Article notes type filters, search over quotes, notes, and annotation tags, combined counts labeled annotations, and per-row navigation — highlight rows jump to their passage; article-note rows carry an explicit Open article action at the saved reading position. Canonical route #/annotations; #/highlights and #/review remain legacy aliases.
_Avoid_: Highlights review (for the combined surface), highlights page

**Article note**:
An independent reflection attached to an article rather than a highlighted passage. An article can have multiple article notes, each editable and deletable.
_Avoid_: highlight note (when no passage is attached), article tag

**Annotation tag**:
A label attached to an individual highlight or article note, independent of the article's tags.
_Avoid_: article tag (when the label belongs to an annotation)

**Starter article**:
Getting Started with Lem Reader, the optional introductory article supplied with a new library.
_Avoid_: permanent fixture, mandatory tutorial

**Read-aloud**:
The reader feature that speaks an article's text while showing where speech is.
_Avoid_: TTS mode, text-to-speech, narrator

**Spoken word**:
The single moving indicator marking the word being spoken right now; it is position, not an annotation.
_Avoid_: TTS highlight, speech mark, cursor

**Follow level**:
How closely the reader can follow speech with a given voice — word, sentence, passage, or progress-only. Determined by the voice's timing capability, discovered per session; never promised by the platform.
_Avoid_: degradation ladder, fallback mode, capability tier

**Transport bar**:
The fixed reader control bar for read-aloud: play/pause, stop, skips, follow level, and rate.
_Avoid_: player, mini-player, audio controls

**No-content state**:
The surface's honest answer to "there is nothing here yet" — a title and one sentence, inviting the first action. Distinct from a filtered miss and from spare-chrome silence.
_Avoid_: blank state, placeholder

**Filtered miss**:
The surface's answer to "your filters matched nothing" — states the miss and offers the way back. A dead end with an escape hatch, never worded as if the library were empty.
_Avoid_: no results (when filters are the cause), empty state

**Spare-chrome silence**:
The deliberate choice to render nothing at zero for incidental chrome (rail, stats line, tag filter, nav destinations). Silence is the empty state; no backfill copy.
_Avoid_: hidden state, missing empty state

**Refusal**:
Ingest declining content it was offered — only when there is nothing reliable to show (no extractable text), the content cannot be reached, or safety forbids it — with a calm reason and the reader's input preserved. A no, not a failure. Readable text with rough edges is never refused; it is admitted flagged.
_Avoid_: error (for ingest declines), rejection

**Flagged**:
The third ingest outcome, between refusal and confident admission: an article whose text was read enters the library carrying a reader-visible limit — content that could not be processed, unreliable highlights — disclosed in place, never silently. "The article was admitted flagged."
_Avoid_: partial success, best-effort, degraded (as reader-facing words), warning-only admission

**Error**:
An operation that failed — loading, saving, importing. Named honestly as a failure of the reader, with a next step, never blamed on the content or the reader.
_Avoid_: refusal (for operation failures)

**Status region**:
The one polite, atomic live-region card that carries loading, error, and announcement copy on a surface. One per surface seam; it pre-exists so announcements are heard.
_Avoid_: toast, notification, alert (for non-urgent states)

**Article tag**:
A label attached to an article, used to organize the library and filter highlights by their article.
_Avoid_: highlight tag (when the label belongs to the article)

**Highlight tag**:
A label attached to an individual highlight; a kind of annotation tag, independent of the article's tags.
_Avoid_: article tag (when the label belongs to the highlight)

**Estimated reading time**:
A whole-article estimate of how long the text takes to read at a fixed typical pace, shown on library rows; a book row shows one total across its chapters. It counts the article's reading text (code included, images not). It describes the article, never the reader — it does not change as you read and is never learned from your sessions.
_Avoid_: time read, time left, reading speed (the accrued "read here" time is a different thing)

**Highlight slot**:
One of one to ten ordered, numbered presets (short name, one color choice, zero or more highlight tags) that quick highlight creation copies from. The reader adds, removes, and reorders slots; a slot's number is its position, so reordering changes which number (and which digit) names it. A slot is configuration, not a live relation: editing, moving, or removing a slot never changes historical highlights. The default slot is an explicit choice of a particular slot — it follows that slot when it moves, applying another slot never rewrites it, and removing the default slot makes slot 1 the default. There is always at least one slot; an unnamed slot reads by its number and color ("Slot 6 · Neutral"). The color choice is either a named fill or a custom color snapshot — the reader-chosen hex stored verbatim on the slot and copied onto each highlight at creation — and the slot remembers its hex even while a named fill is active, dormant until Custom is chosen again; highlight records keep no dormant hex (a named pick on a highlight clears its snapshot — the slot is the memory home). The painted tint is always derived for the active theme (ADR 0008), so the snapshot stays independent of the mutable slot. The slots are THE color vocabulary everywhere a highlight's color is chosen: the annotation panel's color & tags row (the legend names both effects — applying a slot also joins its tags), the review color dialog, and the selection toolbar all render the same slot pills, in slot order — the default fill's label reads "Neutral" (the schema id stays "default"; slot 1's shipped name stays "Default"), so no pill and slot share a label.
_Avoid_: color preset, palette, quick color (the slot carries tags and a name, not only a color), color picker (the pills are the picker)

**Selection toolbar**:
The floating actions over a finished selection — framed as one save action ("Save highlight as:") across the slot pills, plus Highlight + note. It appears on pointer-up, never mid-sweep, and a fresh pointerdown dismisses it — chrome never survives into a new gesture. Enter from the reading context commits the default slot; a slot tap commits its slot.
_Avoid_: popover, annotation panel (that is the dialog on an existing highlight), highlight toolbar

**Slot hold**:
Holding a slot's digit (1–9, with 0 for slot 10) while sweeping a pointer selection; the slot arms and the release creates the highlight with it. Release order of digit and pointer does not matter; Escape during the sweep cancels. A release with no pointer gesture between press and keyup is not a hold — that is a slot tap.
_Avoid_: number shortcut, hotkey highlight (when meaning the pointer gesture)

**Slot tap**:
Pressing and releasing a slot's digit with no pointer gesture in between while the selection toolbar shows a valid selection: the highlight is created with that slot immediately, riding the same creation path as the pills. A modified release is not a tap; an Escape-cancelled hold never tap-creates.
_Avoid_: number shortcut, hotkey highlight

**Undo grace**:
The short window after a creation during which Escape deletes the just-created, unedited highlight. Retired by an edit, an open dialog, or a newer creation; it survives scrolling and new selections.
_Avoid_: undo timer, auto-dismiss (that is the toolbar leaving)

**Escape ladder**:
Escape acts on the topmost layer only: the open dialog dismisses (saving), then the undo grace fires, then the fresh selection toolbar clears its selection, then an armed slot hold cancels. Escape is never a blanket delete.
_Avoid_: Escape deletes the highlight (as an unqualified description)

**Footnote reference**:
The publisher's marker inside the text (such as "1", "[2]", "*") that leads to its footnote. The marker keeps the publisher's own wording and stays part of the article's text, but it is never spoken by read-aloud.
_Avoid_: citation (a footnote need not cite anything), superscript (a presentation, not the concept)

**Footnote**:
The note a footnote reference leads to, collected in the article's notes at its end, with a return to the reference.
_Avoid_: endnote (same thing to the reader), reference (that is the marker)

**Footnote excursion**:
A trip from a footnote reference to its footnote and back. Not reading progress: the reading position stays at the reference until the reader returns or reads on from the notes themselves, and reaching the notes never finishes the article.
_Avoid_: jump (as a noun), navigation (too general)

**Correction**:
One change the reader makes to how an article was processed — giving a block a different type, moving words across a block boundary, splitting, merging, or hiding a block. Corrections sit on top of the article as it was ingested, which is never overwritten: each can be undone on its own, and the original can always be restored.
_Avoid_: edit (that is changing a note or highlight), repair (that is the app reprocessing a PDF), fix. Distinct from marking an article finished or unfinished by hand, which older code also calls a correction.

**Correction view**:
The way of viewing an article while making corrections, entered and left like the reading-mode toggle without losing the reader's place. Always a scrolling column with block boundaries visible.
_Avoid_: edit mode, editor

**Hidden block**:
A block the reader has hidden by correction: gone from reading, read-aloud, and reading time, but still shown dimmed in the correction view so it can be brought back. Never deleted.
_Avoid_: deleted block, removed content

**Reprocessing**:
Running an existing article through ingestion again — re-fetching its address, or the reader choosing the original file again — so it gains what ingestion has since learned. Always the reader's explicit choice, previewed before it applies; never automatic. The reader's corrections are re-applied, and any that no longer fit are listed, never dropped silently.
_Avoid_: re-import (that is library import), refresh, sync

**Embed card**:
What the article shows in place of embedded content from another service — a video, a social post — captured when the article was added: what it is, who made it, its text or title, and a way to open the original. Nothing from the other service is loaded while reading. A card that could not capture the content says so on itself.
_Avoid_: embed (for what the reader sees), widget, player, preview
