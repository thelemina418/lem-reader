// Shared pieces of the Reprocessing preview (#63/#64): the article panel
// (URL re-fetch or re-chosen original file) and the book dialog (re-chosen
// original EPUB) disclose consequences with the same words and controls.
import { useState } from "react";
import { IngestionError } from "../IngestionClient";
import { mapReasonToCopy } from "../ingestCopy";
import {
  ReprocessRefusal,
  type HighlightConsequence,
  type HighlightOutcome,
} from "../../persistence/reprocessStore";
import { describeCorrection } from "../../content/corrections/describe";
import type { NotAppliedCorrection } from "../../content/corrections/reapply";

const OUTCOME_COPY: Record<HighlightOutcome, string> = {
  confident: "re-matches",
  ambiguous: "ambiguous — it will be shown as needing your attention",
  orphan: "orphaned — it will be shown as orphaned, never moved",
  hidden: "inside a block your corrections hide — it shows again if you unhide the block",
};

/** Busy/error state around one reprocess step. Every failure is calm and
 * says the work is unchanged: preview never writes, and apply is atomic. */
export function useReprocessRun(noun: "article" | "book", onBusy?: (busy: boolean) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(action: () => Promise<void>) {
    setBusy(true);
    onBusy?.(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof ReprocessRefusal
          ? cause.message
          : cause instanceof IngestionError
            ? `${mapReasonToCopy(cause.reason)} Your ${noun} is unchanged.`
            : `Reprocessing could not be completed. Your ${noun} is unchanged; close and try again.`,
      );
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  }
  return { busy, error, setError, run };
}

export function HighlightOutcomes({
  highlights,
  noun,
}: {
  highlights: readonly (HighlightConsequence & { chapter?: string })[];
  noun: "article" | "book";
}) {
  if (highlights.length === 0)
    return (
      <p>
        {noun === "article"
          ? "This article has no highlights."
          : "The chapters that stay have no highlights."}
      </p>
    );
  const affected = highlights.filter((h) => h.outcome !== "confident").length;
  return (
    <>
      <p>
        Highlights: {highlights.length - affected} of {highlights.length} re-match.
      </p>
      <ul aria-label="Highlights after reprocessing">
        {highlights.map((h) => (
          <li key={h.highlightId}>
            {h.chapter !== undefined && `${h.chapter}: `}“
            {h.exact.length > 120 ? `${h.exact.slice(0, 120)}…` : h.exact}” —{" "}
            {OUTCOME_COPY[h.outcome]}
          </li>
        ))}
      </ul>
    </>
  );
}

/** Spec #68 / #78 — the reader's corrections re-applied to the new version:
 * how many still fit, and each one that no longer does, with its reason.
 * Nothing is dropped: those stay in the corrections list as not applied.
 * Renders nothing for an article without corrections. */
export function CorrectionsOutcome({
  reapplied,
  notApplied,
  version,
}: {
  reapplied: number;
  notApplied: readonly (NotAppliedCorrection & { chapter?: string })[];
  /** How the new version is named in the copy. */
  version: "new version" | "repaired version";
}) {
  const total = reapplied + notApplied.length;
  if (total === 0) return null;
  return (
    <>
      <p>
        Your corrections: {reapplied} of {total} re-applied to the {version} by finding their text.
      </p>
      {notApplied.length > 0 && (
        <ul aria-label="Corrections that no longer fit">
          {notApplied.map(({ correction, reason, chapter }) => (
            <li key={`${chapter ?? ""}:${correction.id}`}>
              {chapter !== undefined && `${chapter}: `}
              {describeCorrection(correction)} — no longer fits: {reason} It stays in the
              corrections list as not applied.
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
