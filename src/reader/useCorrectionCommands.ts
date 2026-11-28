// src/reader/useCorrectionCommands.ts
// Spec #68 — every command the Correction view offers, in one hook: the
// block commands (Hide / Unhide #71, Split / Merge #75), Change type (#74),
// the selection commands (#73), the corrections list's undo and Restore
// original (#76), Ctrl+Z / Ctrl+Shift+Z while the view is up, the status
// announcements, and where the view lands after a command. ArticleView only
// wires it to the view.
//
// Availability comes from the correction engine (one place for every
// "unavailable because…"); every change takes the one preview →
// consequences → apply path with the session undo history
// (useCorrectionChanges): a preview with no consequences applies at once,
// one with consequences opens the consequences dialog first, and Cancel
// leaves everything untouched.

import { useCallback, useEffect, useRef, useState } from "react";
import type { CorrectionViewBlock } from "../content/correctionView";
import {
  blockCorrection,
  hideAvailability,
  mergeAvailability,
  mergeCorrection,
  splitAvailability,
  splitCorrection,
  unhideAvailability,
  HIDE_REASONS,
  type Availability,
  type CorrectionsResult,
} from "../content/corrections/engine";
import {
  selectionCommands,
  type SelectionCommand,
  type SelectionCommands,
} from "../content/corrections/moveWords";
import {
  BLOCK_TYPE_CHOICES,
  blockTypeChoiceLabel,
  setTypeAvailability,
  setTypeCorrection,
} from "../content/corrections/setType";
import { describeCorrection } from "../content/corrections/describe";
import type { TextPositionSelector } from "../content/normalizeText";
import type { BlockTypeChoice, Correction } from "../content/schema";
import type {
  BlockAction,
  BlockCaret,
  BlockCommand,
  CorrectionLanding,
  TypeChoiceCommand,
} from "./CorrectionView";
import { isFormField } from "./PageTurnControls";
import { useCorrectionChanges } from "./useCorrectionChanges";

/** Each block command's words: its button, its consequences dialog title,
 * and what the status region says once it is done. */
const CORRECTION_COPY: Record<
  BlockAction,
  { label: string; title: string; done: (label: string) => string }
> = {
  hide: {
    label: "Hide block",
    title: "Hide this block?",
    done: (label) =>
      `${label} hidden. It stays here, dimmed; press X to unhide it, or Ctrl+Z to undo.`,
  },
  unhide: {
    label: "Unhide block",
    title: "Unhide this block?",
    done: (label) => `${label} unhidden. Press Ctrl+Z to undo.`,
  },
  split: {
    label: "Split block",
    title: "Split this block?",
    done: (label) => `${label} split in two. Press Ctrl+Z to undo.`,
  },
  merge: {
    label: "Merge with next",
    title: "Merge these blocks?",
    done: (label) => `${label} merged with the next block. Press Ctrl+Z to undo.`,
  },
};

/** Issue #74 — what the status region says once a Change type applied. */
function setTypeDone(blockLabel: string, to: BlockTypeChoice, label: string): string {
  if (to.type === "caption") return `${blockLabel} is now the figure's caption.`;
  if (to.type === "paragraph" && blockLabel === "Quotation") {
    return "The quotation's blocks are ordinary blocks again.";
  }
  if (to.type === "paragraph" && blockLabel.startsWith("Figure")) {
    return "The caption is now a paragraph after the figure.";
  }
  return `${blockLabel} is now ${to.type === "quotation" ? "a quotation" : label}.`;
}

const UNAVAILABLE = "That isn't available here.";

const newMeta = () => ({ id: crypto.randomUUID(), createdAt: new Date().toISOString() });

interface Options {
  /** The original article's id (null while none is open). */
  readonly articleId: string | null;
  /** The engine's result for the open article and its corrections. */
  readonly result: CorrectionsResult | null;
  /** The open article's ordered corrections. */
  readonly corrections: readonly Correction[];
  /** A change applied: the new corrections list. */
  readonly onApplied: (next: readonly Correction[]) => void;
  /** Is the Correction view up (Ctrl+Z / Ctrl+Shift+Z are live)? */
  readonly viewUp: boolean;
}

export function useCorrectionCommands({
  articleId,
  result,
  corrections,
  onApplied,
  viewUp,
}: Options) {
  const [announcement, setAnnouncement] = useState<string | null>(null);
  // Where the view lands after a selection command (#73): the moved words.
  const [landing, setLanding] = useState<CorrectionLanding | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const changes = useCorrectionChanges({
    articleId,
    corrections,
    onApplied,
    announce: setAnnouncement,
  });

  const commandsFor = useCallback(
    (block: CorrectionViewBlock, caret: BlockCaret): readonly BlockCommand[] => {
      if (!result) return [];
      const command = (
        action: BlockAction,
        shortcut: string,
        availability: Availability,
      ): BlockCommand => ({
        action,
        label: CORRECTION_COPY[action].label,
        shortcut,
        ...(availability.available
          ? { available: true }
          : { available: false, reason: availability.reason }),
      });
      return [
        block.hidden
          ? command("unhide", "X", unhideAvailability(block))
          : command("hide", "X", hideAvailability(result, block)),
        command("split", "S", splitAvailability(result, block, caret)),
        command("merge", "J", mergeAvailability(result, block)),
      ];
    },
    [result],
  );

  const onCommand = useCallback(
    (block: CorrectionViewBlock, command: BlockCommand, caret: BlockCaret) => {
      if (!command.available) {
        setAnnouncement(command.reason ?? UNAVAILABLE);
        return;
      }
      if (!result) return;
      const meta = newMeta();
      const correction =
        command.action === "split"
          ? splitCorrection(result, block, caret, meta)
          : command.action === "merge"
            ? mergeCorrection(result, block, meta)
            : blockCorrection(command.action, result, block, meta);
      if (!correction) {
        setAnnouncement(HIDE_REASONS.noText);
        return;
      }
      const copy = CORRECTION_COPY[command.action];
      const described = describeCorrection(correction);
      void changes.run({
        next: [...corrections, correction],
        title: copy.title,
        confirmLabel: copy.label,
        announce: copy.done(block.label),
        undoAnnounce: `Undone: ${described}.`,
        redoAnnounce: `Redone: ${described}.`,
      });
    },
    [result, corrections, changes],
  );

  // #73 — the selection commands; applying lands the view on the moved words.
  const selectionCommandsFor = useCallback(
    (range: TextPositionSelector): SelectionCommands =>
      selectionCommands(result!, range, newMeta()),
    [result],
  );
  const onSelectionCommand = useCallback(
    (command: SelectionCommand) => {
      if (!command.available || !command.correction) {
        setAnnouncement(command.reason ?? UNAVAILABLE);
        return;
      }
      const described = describeCorrection(command.correction);
      const moved = command.landing ?? null;
      const own = command.kind === "own-paragraph";
      void changes.run({
        next: [...corrections, command.correction],
        title: own
          ? "Make these words their own paragraph?"
          : `Move these words to the ${command.kind === "move-next" ? "next" : "previous"} block?`,
        confirmLabel: own ? "Make paragraph" : "Move words",
        announce: `${described}. Press Ctrl+Z to undo.`,
        undoAnnounce: `Undone: ${described}.`,
        redoAnnounce: `Redone: ${described}.`,
        applied: moved ? () => setLanding({ ...moved }) : undefined,
      });
    },
    [corrections, changes],
  );

  // #74 — Change type: every choice with the engine's availability.
  const typeChoicesFor = useCallback(
    (block: CorrectionViewBlock): readonly TypeChoiceCommand[] =>
      BLOCK_TYPE_CHOICES.map(({ to, label }) => {
        if (!result) return { to, label, available: false };
        const availability = setTypeAvailability(result, block, to);
        return availability.available
          ? { to, label, available: true }
          : { to, label, available: false, reason: availability.reason };
      }),
    [result],
  );
  const onChangeType = useCallback(
    (block: CorrectionViewBlock, choice: TypeChoiceCommand) => {
      if (!choice.available) {
        setAnnouncement(choice.reason ?? UNAVAILABLE);
        return;
      }
      if (!result) return;
      const correction = setTypeCorrection(result, block, choice.to, newMeta());
      if (!correction) {
        setAnnouncement(HIDE_REASONS.noText);
        return;
      }
      const label = blockTypeChoiceLabel(choice.to);
      const described = describeCorrection(correction);
      void changes.run({
        next: [...corrections, correction],
        title: `Change this block to ${label}?`,
        confirmLabel: `Change to ${label}`,
        announce: `${setTypeDone(block.label, choice.to, label)} Press Ctrl+Z to undo.`,
        undoAnnounce: `Undone: ${described}.`,
        redoAnnounce: `Redone: ${described}.`,
      });
    },
    [result, corrections, changes],
  );

  // #76 — the corrections list: undo (or remove) one, and Restore original.
  const undoListed = useCallback(
    (correction: Correction, applied: boolean) => {
      const described = describeCorrection(correction);
      void changes.run({
        next: corrections.filter((c) => c.id !== correction.id),
        title: applied ? "Undo this correction?" : "Remove this correction?",
        confirmLabel: applied ? "Undo correction" : "Remove",
        announce: applied
          ? `Undone: ${described}. Press Ctrl+Z to bring it back.`
          : `Removed from the list: ${described}. Press Ctrl+Z to bring it back.`,
        undoAnnounce: `Brought back: ${described}.`,
        redoAnnounce: applied ? `Undone: ${described}.` : `Removed from the list: ${described}.`,
        reinstate: true,
      });
    },
    [corrections, changes],
  );
  const restoreOriginal = useCallback(() => {
    void changes.run({
      next: [],
      title: "Restore the original?",
      confirmLabel: "Restore original",
      announce:
        "Original restored. The article reads exactly as it was added. Press Ctrl+Z to undo.",
      undoAnnounce: "Undone: Restore original. Your corrections are back.",
      redoAnnounce: "Original restored.",
      reinstate: true,
    });
  }, [changes]);

  // Ctrl+Z / Ctrl+Shift+Z (Cmd on macOS) while the view is up — never from
  // form fields or dialogs, where they stay the field's own undo.
  const changesRef = useRef(changes);
  changesRef.current = changes;
  useEffect(() => {
    if (!viewUp) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key !== "z" && event.key !== "Z") return;
      if (isFormField(event.target)) return;
      event.preventDefault();
      if (event.shiftKey) changesRef.current.redo();
      else changesRef.current.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewUp]);

  return {
    /** The view's status announcement (enter / leave / every command). */
    announcement,
    announce: setAnnouncement,
    /** Where the view lands after a selection command; null to clear. */
    landing,
    setLanding,
    /** The corrections list disclosure. */
    listOpen,
    setListOpen,
    /** The change path (pending consequences dialog, busy). */
    changes,
    commandsFor,
    onCommand,
    selectionCommandsFor,
    onSelectionCommand,
    typeChoicesFor,
    onChangeType,
    undoListed,
    restoreOriginal,
  };
}
