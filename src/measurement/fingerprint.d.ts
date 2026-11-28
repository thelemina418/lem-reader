import type { EligibilityState } from "./types";
/** The committed fingerprint artifact (D3-08 baseline). */
export declare const COMMITTED_FINGERPRINT: Fingerprint;
/**
 * The fingerprint shape (subset relevant to seeding). Plan 02 Task 2's
 * harness writes a richer object; we only read the eligibility bits here.
 */
export interface Fingerprint {
    schemaVersion: number;
    generatedAt?: string;
    toleranceBound?: {
        heightDriftPx?: number;
        breaksExact?: boolean;
    };
    rationale?: string;
    engines?: Record<string, // "chromium" | "firefox" | "webkit"
    Record<string, // fixtureId
    Record<string, // variantKey
    Record<string, // "paragraph" | "heading"
    {
        eligible?: boolean;
        heightDriftP95?: number;
        breaksMatchRatio?: number;
    }>>>>;
}
/**
 * Derive the seed EligibilityState from the committed fingerprint. A kind
 * is eligible iff at least one (engine, fixture, variant) cell marks it
 * eligible. Returns all-false when the fingerprint is empty/malformed —
 * the engine then measures via domMeasurer only (D3-03 safe fallback).
 */
export declare function deriveEligibilityFromFingerprint(fp?: Fingerprint): EligibilityState;
