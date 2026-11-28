// src/reader/CorrectionsList.tsx
// Spec #68 / issue #76 — the corrections on this article, reachable from
// the Correction view (its button, or L). Each correction is listed in plain
// words with the text it touched (src/content/corrections/describe.ts), in
// the order it applies. Any one can be undone — not only the latest. A
// correction that no longer fits stays here, marked "Not applied" with its
// reason, and can be removed by the reader; it is never dropped silently.
// Restore original sits at the end of the list.
//
// A disclosure in the view's header, not a dialog: the consequences dialog
// may open over it. Opening moves focus to the list heading; Escape (or
// Close) folds it and returns focus to the toggle. Nothing here writes: the
// owner previews and applies through the one change path.

import { useCallback, useEffect, useId, useRef } from "react";
import type { Correction } from "../content/schema";
import type { CorrectionOutcome } from "../content/corrections/engine";
import { describeCorrection } from "../content/corrections/describe";
import { isFormField } from "./PageTurnControls";

interface CorrectionsListProps {
  corrections: readonly Correction[];
  /** One per correction, in order (the engine's outcomes). */
  outcomes: readonly CorrectionOutcome[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Undo one correction (applied) or remove it (not applied). */
  onUndo: (correction: Correction, applied: boolean) => void;
  onRestoreOriginal: () => void;
  busy: boolean;
}

export function CorrectionsList({
  corrections,
  outcomes,
  open,
  onOpenChange,
  onUndo,
  onRestoreOriginal,
  busy,
}: CorrectionsListProps) {
  const panelId = useId();
  const headingId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const wasOpen = useRef(open);

  useEffect(() => {
    if (open && !wasOpen.current) {
      headingRef.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
      headingRef.current?.focus({ preventScroll: true });
    }
    wasOpen.current = open;
  }, [open]);

  // An undone item leaves the list: focus that was on its button (now gone)
  // lands on the list heading, never <body>.
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    if (active === null || active === document.body) {
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [corrections, open]);

  const close = useCallback(() => {
    onOpenChange(false);
    toggleRef.current?.focus();
  }, [onOpenChange]);

  // L — open / fold the list. Plain L only, never from form fields or
  // dialogs (the isFormField contract).
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isFormField(event.target)) return;
      if (event.key !== "l" && event.key !== "L") return;
      event.preventDefault();
      if (openRef.current) close();
      else onOpenChange(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, onOpenChange]);

  const disabled = busy ? "true" : undefined;

  return (
    <div className="corrections-list">
      <button
        ref={toggleRef}
        type="button"
        className="correction-command corrections-list-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        aria-keyshortcuts="L"
        onClick={() => (open ? close() : onOpenChange(true))}
      >
        Corrections ({corrections.length}) <kbd>L</kbd>
      </button>
      <section
        id={panelId}
        className="corrections-list-panel"
        aria-labelledby={headingId}
        hidden={!open}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
        }}
      >
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="corrections-list-heading">
          Corrections on this article
        </h2>
        {corrections.length === 0 ? (
          <p className="corrections-list-empty">
            No corrections. The article reads exactly as it was added.
          </p>
        ) : (
          <ol className="corrections-list-items">
            {corrections.map((correction, i) => {
              const outcome = outcomes[i];
              const applied = outcome?.status !== "not-applied";
              const description = describeCorrection(correction);
              const descriptionId = `${panelId}-${correction.id}`;
              return (
                <li key={correction.id} className="corrections-list-item">
                  <span id={descriptionId}>{description}</span>
                  {outcome?.status === "not-applied" ? (
                    <span className="corrections-list-not-applied">
                      Not applied: {outcome.reason}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-quiet"
                    aria-describedby={descriptionId}
                    aria-disabled={disabled}
                    onClick={() => {
                      if (!busy) onUndo(correction, applied);
                    }}
                  >
                    {applied ? "Undo" : "Remove"}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        <div className="corrections-list-actions">
          {corrections.length > 0 ? (
            <button
              type="button"
              className="btn btn-quiet"
              aria-disabled={disabled}
              onClick={() => {
                if (!busy) onRestoreOriginal();
              }}
            >
              Restore original
            </button>
          ) : null}
          <button type="button" className="btn btn-quiet" onClick={close}>
            Close
          </button>
        </div>
      </section>
    </div>
  );
}
