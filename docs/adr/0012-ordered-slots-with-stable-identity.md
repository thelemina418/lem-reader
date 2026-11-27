# Highlight slots are an ordered list of 1–10 with stable identities; the default points at an identity

Highlight slots go from exactly five fixed presets to an ordered list the reader can add to (up to ten), remove from (down to one) and reorder. A slot's number is its position: the pill label, the digit that triggers slot hold and slot tap (`1`–`9`, then `0` for slot 10) and the toolbar order all follow position, because the reason to reorder is to change which number does what. The default slot is the exception. Until now it was stored as a position index (`defaultHighlightSlot`, 0..4), which would silently become a different slot after a move. So each slot gets a stable identity, and the default refers to that identity: it follows its slot when it moves, and removing it makes slot 1 the default. Highlights still copy a slot's color and tags at creation and never refer back to it, so adding, removing or moving slots never changes historical highlights.

## Considered options

- **Keep the default as a position index** (rejected): moving a slot would quietly change which slot plain creation (H, Enter, the Highlight button) uses. That is the kind of unpredictable change the product exists to avoid.
- **Fixed ten slots** (rejected): readers who want five would carry five unwanted pills in every picker. The variable count keeps existing libraries at five.
- **Have highlights refer to slots by identity** (rejected; unchanged from #195): a slot is configuration, not a live relation.

## Consequences

- The preferences schema and export bundle get a version bump. An older five-slot bundle imports as five slots with generated identities and the default mapped from its index. Importing replaces the whole slot list (count, order, default) and never merges.
- Every slot picker (selection toolbar, annotation panel, review color dialog) shows the current count in slot order and wraps onto more lines at narrow widths, instead of hiding any slots.
