// src/annotations/highlightSlots.ts
// Issue #195 — the ONE pure highlight-slot vocabulary. A slot is a reusable
// preset (name + color + tags) stored on ReaderSettings; this module owns
// the seams that turn slot configuration into highlight-record fields:
//
//   - slotPreset: a slot → the {color, tags} creation payload, with the
//     slot's tags run through the ONE tag normalization (tagText
//     .normalizeTags — trim, drop empties, case-insensitive dedupe) so a
//     created record carries exactly the tags vocabulary the rest of the
//     annotation stack expects.
//
//   - defaultSlotIndex: the settings' EXPLICIT default-slot identity → its
//     current position (issue #41). Every ordinary creation route resolves
//     the default through it; applying another slot never rewrites it.
//
//   - mergeSlotTags: the additive tag union for applying a slot to an
//     EXISTING highlight — the highlight's existing tags keep both their
//     values and their order (first-seen casing wins the case-insensitive
//     dedupe); the slot's tags join the end. Applying a slot never removes
//     a tag the reader added by hand.
//
//   - Issue #41 (ADR 0012) — the ordered-list operations behind the
//     settings editor (addSlot / removeSlot / moveSlot), the identity →
//     position lookup (defaultSlotIndex), and the ONE label an unnamed slot
//     reads by (slotDisplayName — "Slot 6 · Neutral").
//
// Pure data + pure functions — no DOM, no React, no persistence. jsdom-safe.
import { MAX_HIGHLIGHT_SLOTS, MIN_HIGHLIGHT_SLOTS } from "../content/schema";
import type { HighlightSlot } from "../content/schema";
import { normalizeTags } from "../ingestion/library/tagText";
import { highlightStateLabel } from "./highlightColors";

/** The creation payload copied onto a new highlight record (issue #195;
 * issue #196 adds the optional custom-color snapshot). */
export interface HighlightSlotPreset {
  color: HighlightSlot["color"];
  /** Issue #196 — present only when the slot carries a custom color; the
   * record snapshot keys mirror this (absent, never undefined-valued). */
  customColor?: string;
  tags: string[];
}

/**
 * Issue #222 — the ONE gate every consumer reads a slot's custom hex
 * through: the remembered hex is visible only while Custom is the slot's
 * ACTIVE source (`customColorActive`). A dormant hex — retained while a
 * named fill is active — reads as undefined here, so creation payloads,
 * swatches, and checked states all tell the same truth about what the slot
 * will actually paint.
 */
export function activeCustomColor(slot: HighlightSlot): string | undefined {
  return slot.customColorActive && slot.customColor !== undefined ? slot.customColor : undefined;
}

/**
 * Slot → creation payload. Tags are normalized here (the ONE normalizeTags
 * seam) so every consumer — creation and the apply-to-existing union —
 * starts from the same clean array. Issue #196: a slot's customColor rides
 * the payload verbatim when present (strict hex — the schema already
 * validated it); absent stays absent so the created record's JSON
 * round-trips byte-stably (JSON.stringify drops undefined values).
 * Issue #222: the hex rides only while Custom is the slot's ACTIVE source
 * (activeCustomColor) — a dormant hex never copies onto a record.
 */
export function slotPreset(slot: HighlightSlot): HighlightSlotPreset {
  const customColor = activeCustomColor(slot);
  return {
    color: slot.color,
    ...(customColor !== undefined ? { customColor } : {}),
    tags: normalizeTags(slot.tags),
  };
}

/**
 * Issue #41 — the position of the slot the default identity names; an
 * identity that names no slot (defence in depth — the schema already
 * requires it to exist) reads slot 1.
 */
export function defaultSlotIndex(
  slots: readonly HighlightSlot[],
  defaultHighlightSlotId: string,
): number {
  const index = slots.findIndex((slot) => slot.id === defaultHighlightSlotId);
  return index === -1 ? 0 : index;
}

/**
 * Issue #41 — the ONE label a slot reads by: its name, or — for an unnamed
 * slot — its number and ACTIVE color ("Slot 6 · Neutral", "Slot 3 ·
 * Custom"). `index` is the slot's 0-based position (its number is index+1).
 */
export function slotDisplayName(slot: HighlightSlot, index: number): string {
  if (slot.name.trim().length > 0) return slot.name;
  return `Slot ${index + 1} · ${highlightStateLabel(slot.color, activeCustomColor(slot))}`;
}

/** Issue #41 — the "Slot N: name" control label, folded to the bare
 * display name for an unnamed slot (whose display name already carries its
 * number — never "Slot 6: Slot 6 · Neutral"). */
export function slotLabel(slot: HighlightSlot, index: number): string {
  const display = slotDisplayName(slot, index);
  return display === slot.name ? `Slot ${index + 1}: ${display}` : display;
}

/** Issue #41 — a fresh identity for a slot the reader adds. A different
 * spelling from the legacy positional ids (`slot-N`), so the two never
 * collide. getRandomValues (not randomUUID) — it works outside secure
 * contexts too. */
export function newSlotId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `s-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Issue #41 — append an unnamed Neutral slot with no tags. At the
 * ten-slot bound the SAME list returns (nothing to add). */
export function addSlot(slots: HighlightSlot[]): HighlightSlot[] {
  if (slots.length >= MAX_HIGHLIGHT_SLOTS) return slots;
  const taken = new Set(slots.map((s) => s.id));
  let id = newSlotId();
  while (taken.has(id)) id = newSlotId();
  return [...slots, { id, name: "", color: "default", customColorActive: false, tags: [] }];
}

/**
 * Issue #41 — remove one slot. Removing the default makes (the new) slot 1
 * the default and reports `defaultFellBack` so the editor can say so. The
 * last slot is never removed (the SAME list returns).
 */
export function removeSlot(
  slots: HighlightSlot[],
  id: string,
  defaultHighlightSlotId: string,
): {
  slots: HighlightSlot[];
  defaultHighlightSlotId: string;
  defaultFellBack: boolean;
} {
  const next = slots.filter((s) => s.id !== id);
  if (next.length < MIN_HIGHLIGHT_SLOTS || next.length === slots.length) {
    return { slots, defaultHighlightSlotId, defaultFellBack: false };
  }
  const fellBack = id === defaultHighlightSlotId;
  return {
    slots: next,
    defaultHighlightSlotId: fellBack ? next[0]!.id : defaultHighlightSlotId,
    defaultFellBack: fellBack,
  };
}

/** Issue #41 — move one slot by `delta` positions (−1 up, +1 down). A move
 * past either end returns the SAME list. The default needs no rewrite: it
 * names the identity, which travels with the slot. */
export function moveSlot(slots: HighlightSlot[], id: string, delta: number): HighlightSlot[] {
  const from = slots.findIndex((s) => s.id === id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= slots.length || delta === 0) return slots;
  const next = [...slots];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/**
 * The additive tag union behind "applying a slot adds its tags without
 * removing existing tags": existing tags first (their casings win the
 * case-insensitive dedupe and their order is preserved), slot tags after —
 * both sides through the ONE normalization.
 */
export function mergeSlotTags(existing: readonly string[], incoming: readonly string[]): string[] {
  return normalizeTags([...existing, ...incoming]);
}

/**
 * Issue #222 — the ONE write order + compensating rollback both slot-
 * application surfaces share (the reader's applyHighlightSlot + the review
 * dialog's applySlot): the additive tag union lands FIRST, then the color
 * write; a color failure after landed tags restores the previous tags
 * (best-effort — its own failure is swallowed, the tag write's own rollback
 * contract governs) and the ORIGINAL error RETHROWS so the host surfaces its
 * inline failure copy. The observable outcome is "applied" or "nothing
 * changed", never a half application. The writes are injected — the reader
 * surface passes its hook paths (its newer-edit guard rides mayRestoreTags),
 * the review surface its store seams.
 */
export async function applySlotWrites(args: {
  /** The highlight's tags BEFORE the application (the restore's target). */
  existingTags: readonly string[];
  slot: HighlightSlot;
  /** The tag write — receives the merged union (existing first, slot's
   * tags appended, both through the ONE normalization). */
  writeTags: (tags: string[]) => Promise<unknown>;
  /** The color write — the caller resolves the payload (the slot's named
   * color + its ACTIVE hex through activeCustomColor). */
  writeColor: () => Promise<void>;
  /** Gate on the compensating restore — the reader's newer-edit guard (a
   * later manual tag edit takes precedence over compensation). Absent: the
   * restore may run. */
  mayRestoreTags?: () => boolean;
}): Promise<void> {
  const merged = mergeSlotTags(args.existingTags, args.slot.tags);
  await args.writeTags(merged);
  try {
    await args.writeColor();
  } catch (e) {
    try {
      if (args.mayRestoreTags?.() ?? true) {
        await args.writeTags([...args.existingTags]);
      }
    } catch {
      // The compensation failed too — the tags field already rolled its
      // own optimistic value back to what the disk kept; the routed
      // StorageBanner + the host's inline copy stay the honest surface.
    }
    throw e;
  }
}
