// src/content/corrections/reapply.ts
// Spec #68 / issue #78 — re-applying a reader's corrections to a NEW
// original (Reprocessing: a re-fetched URL, a re-chosen file, each chapter
// of a re-chosen EPUB; PDF repair). Each correction is re-applied by finding
// its text, through the one engine — the same exact / context-narrowed /
// ambiguous / orphan rules as highlight re-matching — so the stores' previews
// show what apply will write. Pure.
//
// Nothing is rewritten on the corrections themselves: the list stays as the
// reader made it, and the engine derives every outcome (applied, or not
// applied with its reason) from the original it is shown over, exactly as
// import does (#77). A correction that no longer fits therefore stays in the
// corrections list as not applied, never dropped.

import type { Correction } from "../schema";
import type { CanonicalArticle } from "../types";
import { applyCorrections, type CorrectionsResult } from "./engine";

export interface NotAppliedCorrection {
  readonly correction: Correction;
  readonly reason: string;
}

export interface Reapplication {
  /** The corrections over the current original (what the reader sees now). */
  readonly before: CorrectionsResult;
  /** The same corrections over the new original (what apply will show). */
  readonly after: CorrectionsResult;
  /** Corrections that apply over the new original. */
  readonly reapplied: readonly Correction[];
  /** Corrections that apply today and would no longer fit, with the reason. */
  readonly notApplied: readonly NotAppliedCorrection[];
}

export function reapplyCorrections(
  current: CanonicalArticle,
  next: CanonicalArticle,
  corrections: readonly Correction[],
): Reapplication {
  const before = applyCorrections(current, corrections);
  const after = applyCorrections(next, corrections);
  const reapplied: Correction[] = [];
  const notApplied: NotAppliedCorrection[] = [];
  corrections.forEach((correction, i) => {
    const outcome = after.outcomes[i];
    if (outcome?.status === "applied") reapplied.push(correction);
    else if (outcome?.status === "not-applied" && before.outcomes[i]?.status === "applied") {
      notApplied.push({ correction, reason: outcome.reason });
    }
  });
  return { before, after, reapplied, notApplied };
}
