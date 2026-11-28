// src/measurement/fingerprint.ts
// Loads the committed calibration fingerprint (calibration/fingerprint.json)
// and derives the seed EligibilityState for the measurement engine.
//
// Per RESEARCH §Open Question 4 + Plan 02 Task 2: the fingerprint is a
// committed repo artifact (NOT IndexedDB — STACK.md forbids persisting
// derived geometry). Vite's JSON import (resolveJsonModule: true in
// tsconfig.json) inlines it at build time. The runtime cost is one module
// load; no IO.
//
// Derivation rule: a kind is seed-eligible iff ANY (engine, fixture,
// variant) cell in the fingerprint marks it eligible. This is permissive
// by design — the runtime drift guard (D3-08) corrects the seed at runtime
// if a particular environment drifts. The committed fingerprint is the CI
// baseline; CI regression (D3-10) prevents the seed from silently widening.
//
// Safe fallback (D3-03): if the fingerprint is empty/missing/malformed, OR
// a kind is absent from every cell, the kind defaults to pretextEligible =
// false → DOM-only measurement. The reader is never blocked by a missing
// or unparseable fingerprint.
// Vite JSON import — the build inlines the committed fingerprint artifact.
// Use relative path so the import resolves from the source tree (not a
// path alias — tsconfig has none).
import fingerprint from "../../calibration/fingerprint.json";
/** The committed fingerprint artifact (D3-08 baseline). */
export const COMMITTED_FINGERPRINT = fingerprint;
/**
 * Derive the seed EligibilityState from the committed fingerprint. A kind
 * is eligible iff at least one (engine, fixture, variant) cell marks it
 * eligible. Returns all-false when the fingerprint is empty/malformed —
 * the engine then measures via domMeasurer only (D3-03 safe fallback).
 */
export function deriveEligibilityFromFingerprint(fp = COMMITTED_FINGERPRINT) {
    const eligibility = {
        paragraph: { pretextEligible: false },
        heading: { pretextEligible: false },
    };
    const engines = fp?.engines;
    if (!engines || typeof engines !== "object")
        return eligibility;
    for (const engine of Object.values(engines)) {
        if (!engine || typeof engine !== "object")
            continue;
        for (const fixture of Object.values(engine)) {
            if (!fixture || typeof fixture !== "object")
                continue;
            for (const variant of Object.values(fixture)) {
                if (!variant || typeof variant !== "object")
                    continue;
                const paragraph = variant.paragraph;
                if (paragraph?.eligible === true) {
                    eligibility.paragraph.pretextEligible = true;
                }
                const heading = variant.heading;
                if (heading?.eligible === true) {
                    eligibility.heading.pretextEligible = true;
                }
            }
        }
    }
    return eligibility;
}
