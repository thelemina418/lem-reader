// src/reader/CorrectionConsequencesDialog.tsx
// Spec #68 / issue #72 — "before this correction": the consequences of a
// proposed correction, told the way the PDF repair and Reprocessing
// previews tell theirs (the shared ConsequenceChecklist: each chapter
// consequence accepted explicitly; apply stays disabled until all are).
// Highlights are named by their words with what happens to them.
//
// Focus contract — the WipeConfirm pattern: showModal on open (focus
// trapped, background inert), explicit initial focus on the SAFE action
// (Cancel — never the confirming one), Esc / backdrop route through the
// same onCancel as the Cancel button (the parent's `open` flip owns every
// close), and focus returns to the element that had it on open.
//
// Nothing here writes: the parent applies on confirm. Cancel leaves
// everything untouched.
import { useEffect, useRef, useState } from "react";
import { ConsequenceChecklist } from "../ui/ConsequenceChecklist";
import { describeCorrection } from "../content/corrections/describe";
import type { DroppedMark } from "../content/corrections/engine";
import type {
  CorrectionHighlightOutcome,
  CorrectionsPreview,
} from "../persistence/correctionsStore";

const OUTCOME_COPY: Record<CorrectionHighlightOutcome, string> = {
  confident: "stays where it is",
  hidden: "will not show while hidden; returns if you unhide",
  ambiguous: "ambiguous — it will be shown as needing your attention",
  orphan: "orphaned — it will be shown as orphaned, never moved",
  crosses:
    "crosses a block boundary that moves — it will be shown as orphaned until the boundary is back, never re-attached",
};

/** Issue #74 — a dropped mark in words. */
const MARK_COPY: Record<DroppedMark["mark"], string> = {
  link: "Link",
  em: "Emphasis",
  strong: "Bold",
  code: "Code formatting",
};

const quoted = (text: string) => `“${text.length > 120 ? `${text.slice(0, 120)}…` : text}”`;

interface CorrectionConsequencesDialogProps {
  /** The preview to confirm; null = closed. */
  preview: CorrectionsPreview | null;
  /** "Hide this block?" */
  title: string;
  /** The confirming button's label ("Hide block"). */
  confirmLabel: string;
  busy: boolean;
  /** A calm failure line from the last confirm attempt. */
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CorrectionConsequencesDialog({
  preview,
  title,
  confirmLabel,
  busy,
  error,
  onConfirm,
  onCancel,
}: CorrectionConsequencesDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const open = preview !== null;
  const [accepted, setAccepted] = useState<Set<number>>(new Set());

  // A new preview starts with nothing accepted.
  useEffect(() => setAccepted(new Set()), [preview]);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      triggerRef.current = document.activeElement as HTMLElement | null;
      dlg.showModal();
      const initial =
        dlg.querySelector<HTMLElement>("[data-initial-focus]") ??
        dlg.querySelector<HTMLElement>(
          "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
        ) ??
        dlg;
      initial.focus();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const handleClose = () => {
      triggerRef.current?.focus();
    };
    // Esc: route through onCancel (the parent owns the close).
    const handleCancel = (e: Event) => {
      e.preventDefault();
      if (!busy) onCancel();
    };
    const handleScrimClick = (e: MouseEvent) => {
      if (e.target === dlg && !busy) onCancel();
    };
    dlg.addEventListener("close", handleClose);
    dlg.addEventListener("cancel", handleCancel);
    dlg.addEventListener("click", handleScrimClick);
    return () => {
      dlg.removeEventListener("close", handleClose);
      dlg.removeEventListener("cancel", handleCancel);
      dlg.removeEventListener("click", handleScrimClick);
    };
  }, [onCancel, busy]);

  const highlights = preview?.highlights.filter((h) => h.outcome !== "confident") ?? [];
  const chapters = preview?.chapters ?? [];
  const later = preview?.laterNotApplied ?? [];
  const contents = preview?.contents ?? [];
  const droppedMarks = preview?.droppedMarks ?? [];
  const ready = accepted.size === chapters.length;

  return (
    <dialog
      ref={ref}
      className="correction-consequences"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="correction-consequences-title"
      aria-describedby="correction-consequences-body"
    >
      {preview && (
        <div className="correction-consequences-inner">
          <h2 id="correction-consequences-title">{title}</h2>
          <p id="correction-consequences-body">
            This change affects your reading data or your other corrections. Nothing changes unless
            you confirm, and you can undo it afterwards.
          </p>
          {later.length > 0 && (
            <>
              <h3>Corrections that would no longer fit</h3>
              <ul aria-label="Corrections that would no longer fit">
                {later.map(({ correction, reason }) => (
                  <li key={correction.id}>
                    {describeCorrection(correction)} — not applied: {reason} It stays in the list.
                  </li>
                ))}
              </ul>
            </>
          )}
          {preview.restored.length > 0 && (
            <>
              <h3>Coming back</h3>
              <ul aria-label="Coming back">
                {preview.restored.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            </>
          )}
          {highlights.length > 0 && (
            <>
              <h3>Highlights</h3>
              <ul aria-label="Highlights after this correction">
                {highlights.map((h) => (
                  <li key={h.highlightId}>
                    {quoted(h.exact)} — {OUTCOME_COPY[h.outcome]}
                  </li>
                ))}
              </ul>
            </>
          )}
          {contents.length > 0 && (
            <>
              <h3>Contents</h3>
              <ul aria-label="Contents after this correction">
                {contents.map((c, i) => (
                  <li key={i}>
                    {c.change === "added" ? "Adds" : "Removes"} chapter {quoted(c.title)}
                  </li>
                ))}
              </ul>
            </>
          )}
          {droppedMarks.length > 0 && (
            <>
              <h3>Formatting</h3>
              <p>A code block holds plain text only, so this formatting will be dropped:</p>
              <ul aria-label="Formatting dropped">
                {droppedMarks.map((m, i) => (
                  <li key={i}>
                    {MARK_COPY[m.mark]} on {quoted(m.text)}
                  </li>
                ))}
              </ul>
            </>
          )}
          <ConsequenceChecklist
            items={chapters}
            accepted={accepted}
            onChange={setAccepted}
            disabled={busy}
          />
          {error && (
            <p className="correction-consequences-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={onConfirm}
              disabled={busy || !ready}
            >
              {confirmLabel}
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={onCancel}
              disabled={busy}
              data-initial-focus
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
