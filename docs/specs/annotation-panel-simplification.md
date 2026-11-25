# Annotation panel simplification

Status: design confirmed through interview and implemented after explicit user confirmation. Targeted local verification is recorded below; cross-engine reference CI and live VoiceOver remain outstanding.

## Purpose and scope

Bring the selection toolbar's restrained visual language and simplicity to the reader annotation panel. Simplify hierarchy and immediate controls, not merely panel dimensions. Writing and reading remain primary; organization and utilities become secondary without removing capabilities.

Scope is creating/editing a reader highlight and its attached note through the existing annotation panel. The selection toolbar and cross-library annotation review experience are not redesigned. Preserve existing domain semantics and annotation state management.

See the 2026-11-25 rework below for the current footer and tag presentation. This brief supersedes the presentation decisions in `unified-annotation-panel.md` concerning always-visible tag entry, full-name slot pills, and directly exposed Copy/Delete actions.

## Confirmed hierarchy

- A highlight without a note starts compact with Add note, not an empty textarea.
- An existing note appears immediately. Ordinary highlight activation starts focus at controls and does not summon the mobile keyboard; explicit Add note focuses writing.
- Writing sits above one compact control row: numbered highlight slots and Tags. Color & tags remains the accessible group name, not a visible heading. Slot inspection labels float on demand rather than reserving an empty line.
- Tags opens an anchored flyout, not an inline expansion. The trigger shows a count when tags exist; existing names remain in a quiet summary independent of flyout state. With no tags, show only Tags—no plus sign or empty-state message. Entry/removal controls and Close tags live in the flyout. Opening does not automatically focus entry or summon the keyboard.
- Done remains plainly visible, but is not a large saturated call-to-action.
- Copy and Delete live in a labeled More actions menu.

## Visual and interaction treatment

Reuse the selection toolbar's theme surface, hairline border, corner treatment, numbered swatches, focus styling, and adequate touch targets. Avoid a panel title, prominent shadow, entrance animation, heavy input border, persistent Note heading, or separate Save button. Use spacing and a subtle separator to distinguish writing from controls.

The writing surface has an accessible label, quiet Write a note… placeholder when empty, and visible focus treatment. It starts at one 44px line rather than an 88px empty block, grows within available space, and scrolls internally for long notes. Clearing text keeps writing expanded for the current session; reopening an empty highlight starts compact.

Replace full-name slot pills with compact numbered swatches. Full names/actions remain accessible and inspectable on hover, keyboard focus, and touch inspection, following the selection toolbar's interaction vocabulary. Do not rely on color alone. Do not show a selected slot: applying a slot changes color and adds tags; it does not establish membership in a slot or remove existing tags. Slot application leaves the panel open, preserves writing, and does not change the explicit default slot. Keep application failure visible and announced.

## Placement and constrained space

Retain the native modal boundary, passage-adjacent placement on larger screens, and bottom sheet on narrow screens. Do not adopt the selection toolbar's non-modal creation behavior. Preserve passage visibility where possible, article geometry, pagination, and both reading modes.

Writing receives flexible space while compact controls and Done remain reachable. Bound note growth and permit scrolling; expanded tags, zoom, long names, and the mobile keyboard must not strand actions off-screen. No dragging or resizing controls. Preserve horizontal placement during typing and existing upward expansion where space permits. Note growth can move the panel's top edge while retaining its bottom controls; viewport bounds take precedence when upward headroom runs out. Once writing reaches its height cap, further typing scrolls internally without growing or repositioning the panel.

## Persistence and secondary actions

- Done, outside click, Escape, and Ctrl/Cmd+Enter retain guarded save-before-dismiss behavior, outstanding-write draining, IME safeguards, and draft recovery.
- Successful saves remain quiet: no permanent Saved badge or success toast. Show restrained pending feedback when saving delays dismissal. Failure retains the panel and writing with visible, announced Retry; never hide failures in More actions.
- Opening/dismissing More actions does not save, discard, or alter writing. Its menu floats above the trigger rather than expanding the footer. Copy leaves the panel open and gives brief accessible confirmation.
- Both flyouts are DOM descendants of the native modal, promoted to the native popover top layer to avoid overflow clipping. Placement is anchored, viewport/zoom-aware, and clamped to the visible viewport. Opening/closing either flyout must leave the panel, slot row, triggers, and Done in exactly the same positions.
- Delete retains current behavior: confirmation within the same dialog when note content, including unsaved writing, requires protection; Keep highlight restores intact writing. Empty-note deletion remains immediate. Drain writes before deletion.
- Tags retain explicit commitment; blur never commits. Escape first closes an open actions menu when applicable, then retains the existing suggestion dismissal → uncommitted tag text clearing → guarded panel dismissal sequence. New controls must not bypass the existing Escape ladder.
- Preserve passage/list focus restoration, including surviving-neighbor focus after list deletion; existing shortcuts and creation behavior remain unchanged.

## Acceptance states and checks

Cover these states explicitly: compact without note; writing with existing or new note; expanded tags with/without existing tags and suggestions; More actions; delete confirmation; pending save; failed save/Retry; long note and narrow screen with keyboard.

Acceptance requires:

- All existing annotation capabilities remain reachable by pointer, touch, and keyboard within the native modal boundary.
- Full action labels are available without relying on color; touch inspection does not accidentally apply a slot. Slot controls do not imply selected-category semantics.
- Visible focus, accessible disclosure/menu state, predictable menu focus return, calm status announcements, reduced motion, and zoom/reflow remain intact.
- Tag expansion and note entry do not unexpectedly summon the keyboard; explicit writing entry does focus the textarea.
- Save failure/retry, interrupted-draft recovery, unsaved-note deletion/cancel, and delayed-write deletion retain their guarantees.
- Both reading modes retain passage geometry, anchoring, and predictable passage/list focus return.
- Expanded content, long labels/notes, narrow viewports, zoom, and the mobile keyboard leave every action reachable.
- Target existing panel, slot, tags, focus, save-reliability, draft-recovery, and placement coverage. Existing tests enforcing permanently visible tag entry or full-name pills must be revised deliberately, not treated as unchanged contracts.
- Browser layout verification belongs to the implementation phase; live VoiceOver remains a manual verification requirement. The local verification below is targeted evidence, not a claim of comprehensive cross-engine or assistive-technology acceptance.

## Decision record

User agreed to all interview decisions: quieter hierarchy; permission to defer controls without removing capabilities; reading-first design; reader-panel scope; note-first surface; inspectable numbered slots; collapsed tag editing with visible summary; More actions for Copy/Delete; retained modality/placement; lightweight writing surface; no selected-slot marker; explicit tag expansion without auto-focus; shared restrained styling; preserved reliability/keyboard contracts; constrained-space accessibility; quiet success and truthful failure feedback; non-destructive menu behavior; documentation handoff before implementation.

No new domain terms or architectural decision record are needed: this changes reversible presentation and hierarchy, not the domain model.

## Compact flyout rework (2026-11-12)

Direct user feedback superseded the original visible heading, standalone Tags row, reserved inspection-label line, and inline expansions. The base panel now keeps the slots and Tags together; an empty writing surface starts at 44px. Both secondary surfaces use anchored native popovers without changing the parent panel's footprint. Flyouts can cover writing temporarily, but placement protects the slot row and footer; growth scrolls on the chosen side rather than covering Done. The centered fallback also clamps its width under effective page zoom so right-aligned controls stay reachable.

Impeccable was installed as user-level tooling outside the repository, with no hooks enabled. Its distill/craft guidance was applied to this refinement. The mechanical scan reported pre-existing palette/type advisories and an unrelated border warning; no broader visual-system refresh is part of this change. Desktop/mobile compact and flyout renders were inspected. Geometry regressions cover 320px, 390px, and desktop: slot inspection and opening/closing Tags or More actions must leave the panel and primary controls fixed. Browser checks also retain tag commitment, menu keyboard navigation, safe dismissal, deletion confirmation, long notes, and 400% zoom coverage.

Rework verification: 725 annotation unit tests, 56 targeted Chromium tests, and 23 targeted Firefox tests passed; production build and repository lint passed. Live VoiceOver and the Mac reference WebKit gate remain outstanding for this rework.

## Icon footer and inline tags rework (2026-11-25)

Direct user feedback, confirmed through interview, supersedes the More actions menu, the icon-less Add note action, and the Tags flyout above. Everything else in this brief — the native modal boundary, placement, guarded save-before-dismiss, draft recovery, the Escape ladder's existing layers, delete confirmation rules, and focus restoration — stands unchanged. Scope is the reader annotation panel only; the review dialogs keep their editors.

- **Footer.** Copy, Delete, and Add note are 44px icon buttons with accessible names ("Copy highlight", "Delete highlight", "Add note"). Their names float on hover, keyboard focus, and touch-and-hold through the same inspection vocabulary as the numbered slots; a hold inspects without activating. The footer has two fixed groups: Copy and Delete pinned to the inline start, Add note and Done pinned to the inline end. Add note still appears only while writing is hidden; when it leaves, the gap stays empty and no other control moves. The More actions menu, its arrow/Home/End navigation, and its Tab hand-off are removed. Delete keeps the quiet button register, and still confirms only when the note (including unsaved writing) has content; an undo affordance is out of scope.
- **Tags.** The Tags trigger and flyout become a + Tag button in the control row. Activating it replaces the numbered slot row, in the same footprint, with the tag field, and focuses its input (an explicit writing action, like Add note, so the mobile keyboard may appear). The field stays open after each commit for chaining. It closes — restoring the slot row — through Escape, a "Done adding tags" × button, or focus leaving the field while it holds no uncommitted text. Uncommitted text keeps the field open on blur: blur never commits and never discards. + Tag stays beside the open field (it reports `aria-expanded`; activating it again returns focus to the field's input), so the tab order below holds while tagging. Escape peels one layer per press: suggestions → uncommitted text → close the tag field → guarded panel dismissal. Closing the field returns focus to + Tag when focus was in the field; an Escape pressed while writing the note closes the field and leaves the caret in the note.
- **Tag pills.** Existing highlight tags render as pills in their own row below the control row (slots or tag field, + Tag) and above the footer, replacing the comma summary and the picker's own chip list. The row renders nothing when there are no tags. Each pill carries a 44px "Remove tag ‹name›" × that removes the tag immediately; a failed removal keeps the pill and is announced ("Couldn't remove tag. Try again."); focus moves to the next pill, else the previous, else + Tag (or the open tag input). Long names wrap; none are truncated.
- **Writing surface.** Reopening a highlight with a long note restores the content-sized writing surface (grown to its cap, then scrolling), matching creation. The autosize previously measured the field while the dialog was still closed and collapsed it to its minimum.
- Tab order: writing → slots or tag field → + Tag → pills → Copy → Delete → Add note → Done.
- Supporting behavior (implementation, not new product scope): the tag suggestion list floats (`position: fixed`) so the panel's scroll area cannot clip it; a footer icon's name floats on `:focus-visible` focus only, so the icon focused when the panel opens doesn't show its name beside a hover label; the panel opens with focus on Add note, or Done when writing is visible.

## Implementation and targeted local verification

- Reader panel uses compact slots; review dialogs retain full-name pills. Selection toolbar and panel share the same hover/focus/touch inspection behavior through `useActionInspection`.
- More actions remains inside the native dialog, with arrow/Home/End navigation, Escape focus return, and Tab continuation to Done. Initial menu focus is synchronous so rapid arrow input cannot be overwritten by a queued focus callback.
- Placement observes inner content as well as the dialog box: a placement-derived height cap must not conceal growth of disclosed tags and strand the footer. Repositioning is coalesced outside ResizeObserver delivery to avoid resize-loop errors.
- 723 annotation unit tests passed.
- 84 targeted Chromium tests passed across unified-panel, copy, deletion, note creation/editing, draft recovery, placement, tags, save reliability, and highlight slots. Coverage includes narrow screens, 400% zoom, both reading modes, failure/retry, focus restoration, and menu keyboard behavior.
- Production build and repository lint passed. Existing bundle-size/dynamic-import build warnings remain.
- Firefox/WebKit reference CI and live VoiceOver were not run for the initial refinement. Automated desktop/mobile screenshot artifacts are captured by targeted tests; they do not establish manual assistive-technology acceptance.

### PR #292 review follow-up (2026-11-12)

- Fixed textarea sizing after Delete → Keep: confirmation unmounts the writing view, so returning must rerun autosizing even when note text and expanded state are unchanged. A new real-browser placement regression failed before the fix (280px → 88px) and passed afterward in Chromium, Firefox, and Linux WebKit.
- Ran the nine targeted annotation specs listed above in the supported rootless container lane with Node 22.23.4 and Playwright 1.61.1. Chromium + Firefox: 168 passed, 2 existing engine-specific skips. Linux WebKit: 82 passed, 2 existing engine-specific skips, 1 deletion-focus failure (focus observed on body). This is not an all-green three-engine acceptance claim.
- WebKit also exhibited article-setup timeouts before reaching annotation controls. A serial three-repeat deletion run on the pre-fix PR code reproduced those setup failures (21 passed, 3 setup failures); the corresponding fixed-code run had 20 passed and 4 setup failures. The deletion-focus failure did not recur in that fixed-code repeat run, but remains recorded rather than dismissed as a clean result.
- Targeted annotation unit tests: 21 passed. Repository lint and TypeScript checks passed. The Mac reference CI gate remains authoritative for Safari behavior; live VoiceOver verification remains outstanding.
- Reference CI on `4d8de6b0` exposed a repeatable macOS WebKit menu-exit failure: Tab closed More actions but did not focus Done. Menu Tab and Shift+Tab now explicitly hand focus to Done and More actions respectively, rather than depending on native sequential navigation. Two unit regressions failed before this change; afterward 10 targeted unit tests and 61 browser tests across all three Linux engines passed (2 existing Chromium-only clipboard skips). The menu contract also passed three repeats per engine before the final callback-only wiring adjustment. macOS confirmation belongs to the next reference CI run.
