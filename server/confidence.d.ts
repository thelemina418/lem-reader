import type { CanonicalArticle } from "../src/content/schema";
/** ConfidenceResult — the derived two-state outcome. `reason` is present on
 * the `low` variant; the `confident` variant carries no reason. */
export interface ConfidenceResult {
    state: "confident" | "low";
    reason?: string;
}
/** Inputs to deriveConfidence. `isReaderable` is Readability's cheap
 * isProbablyReaderable() pre-check (a negative signal — a page Readability
 * dislikes is admitted flagged low, never refused per ADR-0003). Future
 * calibration may add textToContentRatio / linkDensity here. */
export interface ConfidenceSignals {
    isReaderable: boolean;
}
/**
 * deriveConfidence — the two-state formula (ADR-0003). Pure function; no I/O.
 * Call sites: /server/ingest.ts orchestrator (07-05) runs this AFTER extraction
 * + sanitize to stamp the article confident or low — both enter the library;
 * low surfaces the reader-visible fidelity note (ING-06, DOC-06 copy).
 */
export declare function deriveConfidence(article: CanonicalArticle, signals: ConfidenceSignals): ConfidenceResult;
