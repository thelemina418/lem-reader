// Reprocessing an EPUB book as a whole book (#64, spec #66 story 59). A
// plain (non-destructive until accepted) modal opened from the book row:
// the reader chooses the original EPUB again, which must match the
// fingerprint saved when the book was added; the preview shows chapters
// before and after, added and removed chapters, highlight outcomes and every
// chapter consequence; only "Apply reprocessing" writes, atomically.
import { useEffect, useId, useRef, useState } from "react";
import type { Book } from "../../content/schema";
import {
  applyBookReprocess,
  previewBookReprocess,
  type BookReprocessPreview,
} from "../../persistence/reprocessStore";
import { StatusRegion } from "../../ui/StatusRegion";
import {
  ConsequenceChecklist,
  CorrectionsOutcome,
  HighlightOutcomes,
  useReprocessRun,
} from "./reprocessParts";
import "./pdfRepair.css";

interface ReprocessBookDialogProps {
  open: boolean;
  book: Book | null;
  onSaved: () => void;
  onCancel: () => void;
}

function ChapterList({ label, titles }: { label: string; titles: readonly string[] }) {
  return (
    <details>
      <summary>
        {label} ({titles.length})
      </summary>
      <ol>
        {titles.map((title, n) => (
          <li key={n}>{title}</li>
        ))}
      </ol>
    </details>
  );
}

export function ReprocessBookDialog({ open, book, onSaved, onCancel }: ReprocessBookDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BookReprocessPreview | null>(null);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const { busy, error, setError, run } = useReprocessRun("book");

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      triggerRef.current = document.activeElement as HTMLElement | null;
      setFile(null);
      setPreview(null);
      setAccepted(new Set());
      setError("");
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open, setError]);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const handleClose = () => triggerRef.current?.focus();
    const handleCancel = (e: Event) => {
      e.preventDefault();
      if (!busy) onCancel();
    };
    dlg.addEventListener("close", handleClose);
    dlg.addEventListener("cancel", handleCancel);
    return () => {
      dlg.removeEventListener("close", handleClose);
      dlg.removeEventListener("cancel", handleCancel);
    };
  }, [onCancel, busy]);

  return (
    <dialog ref={ref} className="reprocess-book" aria-labelledby="reprocess-book-heading">
      <div className="reprocess-book-inner pdf-repair-panel">
        <h2 id="reprocess-book-heading">Reprocess book</h2>
        {open && book && (
          <>
            <p>
              Process {book.title} again with current ingestion, as a whole book. Lem Reader does
              not keep original files, so choose the EPUB you added; it is checked against the
              fingerprint saved then. Previewing does not change this book.
            </p>
            <label htmlFor={inputId}>Original EPUB</label>
            <input
              id={inputId}
              type="file"
              accept=".epub,application/epub+zip"
              disabled={busy}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setPreview(null);
                setAccepted(new Set());
                setError("");
              }}
            />
            <button
              type="button"
              className="btn btn-quiet"
              disabled={busy || !file}
              onClick={() =>
                void run(async () => {
                  if (!file) return;
                  setPreview(null);
                  setAccepted(new Set());
                  setPreview(await previewBookReprocess(book.id, file));
                })
              }
            >
              {busy && !preview ? "Checking book…" : "Preview reprocessing"}
            </button>
            {preview && (
              <section aria-label="Reprocess preview">
                <h3>What will change</h3>
                <p>This is the EPUB you added. Only how it was processed changes.</p>
                <ChapterList label="Chapters before" titles={preview.chaptersBefore} />
                <ChapterList label="Chapters after" titles={preview.chaptersAfter} />
                {preview.added.length > 0 && (
                  <p>
                    Added: {preview.added.map((c) => c.title).join(", ")}. Current ingestion can now
                    read {preview.added.length === 1 ? "this chapter" : "these chapters"}.
                  </p>
                )}
                {preview.removed.length > 0 && (
                  <p>No longer in the book: {preview.removed.map((c) => c.title).join(", ")}.</p>
                )}
                {preview.changes.length === 0 ? (
                  <p>No passages change in the chapters that stay.</p>
                ) : (
                  <details>
                    <summary>Changed passages ({preview.changes.length})</summary>
                    <ul>
                      {preview.changes.map((change, n) => (
                        <li key={n}>
                          {change.chapter}: {change.kind === "removed" ? "Removed: " : "Added: "}
                          {change.text}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <HighlightOutcomes highlights={preview.highlights} noun="book" />
                <CorrectionsOutcome
                  reapplied={preview.correctionsReapplied}
                  notApplied={preview.correctionsNotApplied}
                  version="new version"
                />
                {preview.positionsUnmatched.length > 0 && (
                  <p>
                    Your reading position in {preview.positionsUnmatched.join(", ")} cannot be
                    matched in the new version; it opens at the start of that chapter.
                  </p>
                )}
                <p>
                  Chapters that stay keep their notes, collections, and completion. The book keeps
                  its tags.
                </p>
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
                      await applyBookReprocess(preview, {
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
          </>
        )}
        <StatusRegion>{error}</StatusRegion>
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
