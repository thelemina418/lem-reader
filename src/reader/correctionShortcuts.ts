// src/reader/correctionShortcuts.ts
// Spec #68 / issue #73 — THE list of Correction-view shortcuts, rendered in
// the view (spec story 25: "shortcuts listed in the view"). Each command
// that adds a shortcut registers its entry here, so the in-view list and
// the keys can never drift apart. Keys are chosen to avoid the reader's own
// (M mode toggle, page turns, highlight slot digits) and browser essentials
// (Ctrl/Cmd chords stay the browser's: Ctrl+C copies, Ctrl+X cuts).

export interface CorrectionShortcut {
  /** Key names as shown, e.g. ["Shift+←", "Shift+→"]. */
  readonly keys: readonly string[];
  /** What the shortcut does, in words. */
  readonly label: string;
}

export const CORRECTION_SHORTCUTS: readonly CorrectionShortcut[] = [
  { keys: ["C"], label: "Leave the Correction view" },
  { keys: ["Tab", "↑", "↓"], label: "Move between blocks" },
  { keys: ["X"], label: "Hide or unhide the current block" },
  { keys: ["Shift+←", "Shift+→"], label: "Select words in the current block, a word at a time" },
  { keys: ["Esc"], label: "Clear the selection" },
  { keys: ["]"], label: "Move the selected words to the next block" },
  { keys: ["["], label: "Move the selected words to the previous block" },
  { keys: ["P"], label: "Make the selected words their own paragraph" },
];

/** The selection commands' keys (event.key values). */
export const SELECTION_COMMAND_KEYS = {
  "move-next": "]",
  "move-previous": "[",
  "own-paragraph": "p",
} as const;
