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

const OUTCOME_COPY: Record<HighlightOutcome, string> = {
  confident: "re-matches",
  ambiguous: "ambiguous — it will be shown as needing your attention",
  orphan: "orphaned — it will be shown as orphaned, never moved",
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

/** Each consequence is accepted explicitly; apply stays disabled until all
 * are. */
export function ConsequenceChecklist({
  items,
  accepted,
  onChange,
  disabled,
}: {
  items: readonly { label: string }[];
  accepted: ReadonlySet<number>;
  onChange: (next: Set<number>) => void;
  disabled: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <>
      <h3>Reader data that cannot keep its chapter meaning</h3>
      <ul>
        {items.map((item, index) => (
          <li key={index}>
            <label>
              <input
                type="checkbox"
                checked={accepted.has(index)}
                disabled={disabled}
                onChange={(event) => {
                  const next = new Set(accepted);
                  if (event.target.checked) next.add(index);
                  else next.delete(index);
                  onChange(next);
                }}
              />
              {item.label}
            </label>
          </li>
        ))}
      </ul>
    </>
  );
}
