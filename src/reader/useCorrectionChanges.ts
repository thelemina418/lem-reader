// src/reader/useCorrectionChanges.ts
// Spec #68 / issues #72, #76 — the ONE path every correction change takes
// in the Correction view: a new correction, Ctrl+Z / Ctrl+Shift+Z, undo of
// one correction from the corrections list, removing a not-applied one,
// and Restore original. Each is "replace the article's corrections list
// with this one", so each goes through the corrections store's preview →
// (consequences dialog when not clean) → one-transaction apply, and each
// re-anchors highlights and the reading position the same way.
//
// The session history (in memory, per open article — spec #68: "a session
// undo/redo history") holds each applied change as a step: the list before
// and after. Undo applies `before`, redo applies `after`; both still preview
// first, so an undo with consequences asks. A new change clears the redo
// side. Restore original is one step like any other.
//
// What undo can't get back from the list alone: completions and collection
// entries an ACCEPTED chapter consequence removed. The session keeps those
// rows (the apply's receipt) in a pool; every history move, list undo and
// Restore original offers them to the store, which puts back exactly those
// whose chapter the change brings back (named in the preview's `restored`).
// A fresh correction never does. The pool dies with the session, so a
// reload or a later session can bring back structure but not those rows.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Correction } from "../content/schema";
import {
  applyCorrectionsChange,
  CorrectionsRefusal,
  previewCorrectionsChange,
  type CorrectionsPreview,
} from "../persistence/correctionsStore";
import { NO_REMOVED_ROWS, type RemovedChapterRows } from "../persistence/chapterConsequences";

/** One proposed change to the article's corrections list. */
export interface CorrectionChange {
  readonly next: readonly Correction[];
  /** Consequences dialog title ("Hide this block?"). */
  readonly title: string;
  /** The dialog's confirming button ("Hide block"). */
  readonly confirmLabel: string;
  /** Status-region announcement once applied. */
  readonly announce: string;
  /** Announcements when the session later undoes / redoes this step. */
  readonly undoAnnounce: string;
  readonly redoAnnounce: string;
  /** Offer the session's removed rows (undo-like changes only). */
  readonly reinstate?: boolean;
}

interface Step {
  readonly before: readonly Correction[];
  readonly after: readonly Correction[];
  readonly undoAnnounce: string;
  readonly redoAnnounce: string;
}

export interface PendingCorrectionChange {
  readonly preview: CorrectionsPreview;
  readonly title: string;
  readonly confirmLabel: string;
}

interface Options {
  readonly articleId: string | null;
  readonly corrections: readonly Correction[];
  /** The list now applied (the owner re-derives the corrected article). */
  readonly onApplied: (next: readonly Correction[]) => void;
  readonly announce: (message: string) => void;
}

type Applying = {
  change: Omit<CorrectionChange, "next" | "reinstate"> & { next: readonly Correction[] };
  history: "push" | "undo" | "redo";
};

function failure(error: unknown): string {
  return error instanceof CorrectionsRefusal
    ? error.message
    : "The correction couldn't be saved. Nothing was changed.";
}

function mergeRemoved(
  pool: RemovedChapterRows,
  reinstated: RemovedChapterRows,
  removed: RemovedChapterRows,
): RemovedChapterRows {
  const back = new Set(reinstated.completions.map((c) => c.targetKey));
  const backEntries = new Set(reinstated.entries.map((e) => `${e.collectionId}/${e.entry.id}`));
  return {
    completions: [
      ...pool.completions.filter((c) => !back.has(c.targetKey)),
      ...removed.completions,
    ],
    entries: [
      ...pool.entries.filter((e) => !backEntries.has(`${e.collectionId}/${e.entry.id}`)),
      ...removed.entries,
    ],
  };
}

export function useCorrectionChanges({ articleId, corrections, onApplied, announce }: Options) {
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<(PendingCorrectionChange & { applying: Applying }) | null>(
    null,
  );
  const [pendingError, setPendingError] = useState("");
  const undoStack = useRef<Step[]>([]);
  const redoStack = useRef<Step[]>([]);
  const removedPool = useRef<RemovedChapterRows>(NO_REMOVED_ROWS);
  // Re-render when the stacks change (canUndo / canRedo).
  const [, setHistoryTick] = useState(0);
  const correctionsRef = useRef(corrections);
  correctionsRef.current = corrections;
  // The history belongs to one open article.
  useEffect(() => {
    undoStack.current = [];
    redoStack.current = [];
    removedPool.current = NO_REMOVED_ROWS;
    setPending(null);
    setHistoryTick((n) => n + 1);
  }, [articleId]);

  const commit = useCallback(
    async (preview: CorrectionsPreview, applying: Applying, accept: boolean) => {
      const before = correctionsRef.current;
      const { removed } = await applyCorrectionsChange(preview, { acceptConsequences: accept });
      removedPool.current = mergeRemoved(removedPool.current, preview.reinstate, removed);
      const { change, history } = applying;
      const step: Step =
        history === "push"
          ? {
              before,
              after: change.next,
              undoAnnounce: change.undoAnnounce,
              redoAnnounce: change.redoAnnounce,
            }
          : (history === "undo" ? undoStack.current : redoStack.current).at(-1)!;
      if (history === "push") {
        undoStack.current = [...undoStack.current, step];
        redoStack.current = [];
      } else if (history === "undo") {
        undoStack.current = undoStack.current.slice(0, -1);
        redoStack.current = [...redoStack.current, step];
      } else {
        redoStack.current = redoStack.current.slice(0, -1);
        undoStack.current = [...undoStack.current, step];
      }
      setHistoryTick((n) => n + 1);
      onApplied(preview.corrections);
      announce(
        preview.restored.length > 0
          ? `${change.announce} ${restoredSummary(preview)}`
          : change.announce,
      );
    },
    [onApplied, announce],
  );

  const start = useCallback(
    async (applying: Applying, reinstate: boolean) => {
      if (!articleId || busy || pending) return;
      setBusy(true);
      try {
        const preview = await previewCorrectionsChange(articleId, applying.change.next, {
          removedEarlier: reinstate ? removedPool.current : NO_REMOVED_ROWS,
        });
        if (!preview.clean) {
          setPendingError("");
          setPending({
            preview,
            title: applying.change.title,
            confirmLabel: applying.change.confirmLabel,
            applying,
          });
          return;
        }
        await commit(preview, applying, false);
      } catch (error) {
        announce(failure(error));
      } finally {
        setBusy(false);
      }
    },
    [articleId, busy, pending, commit, announce],
  );

  /** Propose a change (a new correction, a list undo, Restore original). */
  const run = useCallback(
    (change: CorrectionChange) => start({ change, history: "push" }, change.reinstate === true),
    [start],
  );

  const undo = useCallback(() => {
    const step = undoStack.current.at(-1);
    if (!step) {
      announce("Nothing to undo.");
      return;
    }
    void start(
      {
        change: {
          next: step.before,
          title: "Undo this change?",
          confirmLabel: "Undo",
          announce: `${step.undoAnnounce} Press Ctrl+Shift+Z to redo.`,
          undoAnnounce: step.undoAnnounce,
          redoAnnounce: step.redoAnnounce,
        },
        history: "undo",
      },
      true,
    );
  }, [start, announce]);

  const redo = useCallback(() => {
    const step = redoStack.current.at(-1);
    if (!step) {
      announce("Nothing to redo.");
      return;
    }
    void start(
      {
        change: {
          next: step.after,
          title: "Redo this change?",
          confirmLabel: "Redo",
          announce: `${step.redoAnnounce} Press Ctrl+Z to undo.`,
          undoAnnounce: step.undoAnnounce,
          redoAnnounce: step.redoAnnounce,
        },
        history: "redo",
      },
      true,
    );
  }, [start, announce]);

  const confirmPending = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await commit(pending.preview, pending.applying, true);
      setPending(null);
    } catch (error) {
      setPendingError(failure(error));
    } finally {
      setBusy(false);
    }
  }, [pending, commit]);

  const cancelPending = useCallback(() => {
    setPending(null);
    announce("Nothing was changed.");
  }, [announce]);

  return {
    run,
    undo,
    redo,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    busy,
    pending: pending as PendingCorrectionChange | null,
    pendingError,
    confirmPending,
    cancelPending,
  };
}

function restoredSummary(preview: CorrectionsPreview): string {
  const n = preview.reinstate.completions.length + preview.reinstate.entries.length;
  return n === 1
    ? "One chapter status or collection entry came back."
    : `${n} chapter statuses or collection entries came back.`;
}
