import { useState } from "react";
import type { CanonicalArticle } from "../../content/schema";
import { IngestionError } from "../IngestionClient";
import { mapReasonToCopy } from "../ingestCopy";
import {
  applyReprocess,
  previewUrlReprocess,
  ReprocessRefusal,
  type HighlightOutcome,
  type ReprocessPreview,
} from "../../persistence/reprocessStore";
import { StatusRegion } from "../../ui/StatusRegion";
import "./pdfRepair.css";

const OUTCOME_COPY: Record<HighlightOutcome, string> = {
  confident: "re-matches",
  ambiguous: "ambiguous — it will be shown as needing your attention",
  orphan: "orphaned — it will be shown as orphaned, never moved",
};

/** Explicit Reprocessing (#63) inside the library metadata dialog, beside the
 * PDF repair precedent. Fetching and previewing never change the article;
 * only "Apply reprocessing" does, and cancelling the dialog discards the
 * preview. */
export function ReprocessPanel({
  article,
  onSaved,
  onBusy,
}: {
  article: CanonicalArticle;
  onSaved: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const [preview, setPreview] = useState<ReprocessPreview | null>(null);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(action: () => Promise<void>) {
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof ReprocessRefusal
          ? cause.message
          : cause instanceof IngestionError
            ? `${mapReasonToCopy(cause.reason)} Your article is unchanged.`
            : "Reprocessing could not be completed. Your article is unchanged; close and try again.",
      );
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  const affected = preview?.highlights.filter((h) => h.outcome !== "confident").length ?? 0;
  return (
    <details className="pdf-repair-panel">
      <summary>Reprocess article</summary>
      <p>
        Fetch this article’s address again and process it with current ingestion. Previewing does
        not change this article.
      </p>
      <button
        type="button"
        className="btn btn-quiet"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            setPreview(null);
            setAccepted(new Set());
            setPreview(await previewUrlReprocess(article.id));
          })
        }
      >
        {busy && !preview ? "Fetching article…" : "Preview reprocessing"}
      </button>
      {preview && (
        <section aria-label="Reprocess preview">
          <h3>What will change</h3>
          {preview.sourceChanged ? (
            <p>
              <strong>The page at this address has changed since you added it.</strong> Applying
              replaces your saved version with the page as it is now.
            </p>
          ) : (
            <p>The page is the same as when you added it. Only how it was processed changes.</p>
          )}
          {preview.changes.length === 0 ? (
            <p>No passages change.</p>
          ) : (
            <details>
              <summary>Changed passages ({preview.changes.length})</summary>
              <ul>
                {preview.changes.map((change, n) => (
                  <li key={n}>
                    {change.kind === "removed" ? "Removed: " : "Added: "}
                    {change.text}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {preview.highlights.length === 0 ? (
            <p>This article has no highlights.</p>
          ) : (
            <>
              <p>
                Highlights: {preview.highlights.length - affected} of {preview.highlights.length}{" "}
                re-match.
              </p>
              <ul aria-label="Highlights after reprocessing">
                {preview.highlights.map((h) => (
                  <li key={h.highlightId}>
                    “{h.exact.length > 120 ? `${h.exact.slice(0, 120)}…` : h.exact}” —{" "}
                    {OUTCOME_COPY[h.outcome]}
                  </li>
                ))}
              </ul>
            </>
          )}
          {preview.position.kind === "unmatched" && (
            <p>
              Your reading position cannot be matched in the new version; it opens at the start.
            </p>
          )}
          <p>Article notes, tags, collections, and completion carry over.</p>
          {preview.consequences.length > 0 && (
            <>
              <h3>Reader data that cannot keep its chapter meaning</h3>
              <ul>
                {preview.consequences.map((item, index) => (
                  <li key={index}>
                    <label>
                      <input
                        type="checkbox"
                        checked={accepted.has(index)}
                        disabled={busy}
                        onChange={(event) =>
                          setAccepted((previous) => {
                            const next = new Set(previous);
                            if (event.target.checked) next.add(index);
                            else next.delete(index);
                            return next;
                          })
                        }
                      />
                      {item.label}
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || accepted.size !== preview.consequences.length}
            onClick={() =>
              void run(async () => {
                await applyReprocess(preview, {
                  acceptConsequences: accepted.size === preview.consequences.length,
                });
                onSaved();
              })
            }
          >
            Apply reprocessing
          </button>
        </section>
      )}
      <StatusRegion>{error}</StatusRegion>
    </details>
  );
}
