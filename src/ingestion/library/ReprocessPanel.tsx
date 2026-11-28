import { useId, useState } from "react";
import type { CanonicalArticle } from "../../content/schema";
import {
  applyReprocess,
  isUploadSource,
  previewUploadReprocess,
  previewUrlReprocess,
  type ReprocessPreview,
} from "../../persistence/reprocessStore";
import { StatusRegion } from "../../ui/StatusRegion";
import {
  ConsequenceChecklist,
  CorrectionsOutcome,
  HighlightOutcomes,
  useReprocessRun,
} from "./reprocessParts";
import "./pdfRepair.css";

const ORIGINAL_ACCEPT: Record<string, string> = {
  markdown: ".md,text/markdown",
  paste: ".html,.htm,text/html",
  "html-upload": ".html,.htm,text/html",
};

/** Explicit Reprocessing (#63 URL, #64 upload) inside the library metadata
 * dialog, beside the PDF repair precedent. Fetching, choosing a file and
 * previewing never change the article; only "Apply reprocessing" does, and
 * cancelling the dialog discards the preview. An uploaded article asks for
 * its original file again (Lem Reader keeps no originals), which must match
 * the fingerprint saved when it was added. */
export function ReprocessPanel({
  article,
  onSaved,
  onBusy,
}: {
  article: CanonicalArticle;
  onSaved: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const inputId = useId();
  const source = article.ingestionMeta?.source;
  const upload = isUploadSource(source);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ReprocessPreview | null>(null);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const { busy, error, setError, run } = useReprocessRun("article", onBusy);
  return (
    <details className="pdf-repair-panel">
      <summary>Reprocess article</summary>
      {upload ? (
        <>
          <p>
            Process this article again with current ingestion. Lem Reader does not keep original
            files, so choose the file you added; it is checked against the fingerprint saved then.
            Previewing does not change this article.
          </p>
          <label htmlFor={inputId}>Original file</label>
          <input
            id={inputId}
            type="file"
            accept={ORIGINAL_ACCEPT[source] ?? ""}
            disabled={busy}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setPreview(null);
              setAccepted(new Set());
              setError("");
            }}
          />
        </>
      ) : (
        <p>
          Fetch this article’s address again and process it with current ingestion. Previewing does
          not change this article.
        </p>
      )}
      <button
        type="button"
        className="btn btn-quiet"
        disabled={busy || (upload && !file)}
        onClick={() =>
          void run(async () => {
            setPreview(null);
            setAccepted(new Set());
            setPreview(
              upload && file
                ? await previewUploadReprocess(article.id, file)
                : await previewUrlReprocess(article.id),
            );
          })
        }
      >
        {busy && !preview
          ? upload
            ? "Checking file…"
            : "Fetching article…"
          : "Preview reprocessing"}
      </button>
      {preview && (
        <section aria-label="Reprocess preview">
          <h3>What will change</h3>
          {upload ? (
            <p>This is the file you added. Only how it was processed changes.</p>
          ) : preview.sourceChanged ? (
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
          <HighlightOutcomes highlights={preview.highlights} noun="article" />
          <CorrectionsOutcome
            reapplied={preview.corrections.reapplied.length}
            notApplied={preview.corrections.notApplied}
            version="new version"
          />
          {preview.position.kind === "unmatched" && (
            <p>
              Your reading position cannot be matched in the new version; it opens at the start.
            </p>
          )}
          <p>Article notes, tags, collections, and completion carry over.</p>
          <ConsequenceChecklist
            items={preview.consequences}
            accepted={accepted}
            onChange={setAccepted}
            disabled={busy}
          />
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
