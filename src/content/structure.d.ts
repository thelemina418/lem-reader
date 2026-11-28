import { type CanonicalArticle, type StructureDestination, type WorkStructure } from "./schema";
/** Bumped only when the derivation algorithm itself changes. Existing
 * snapshots stay frozen at their established boundaries; only records
 * without a snapshot re-derive (and lazily persist) under the new version. */
export declare const STRUCTURE_GENERATOR_VERSION = 3;
/** The target canonical length of one generated reading part, in grapheme
 * clusters. Content-work sizing (like the pagination bounds), not layout:
 * a part spans several measurement windows, so window boundaries can change
 * with typography while the part does not. */
export declare const PART_TARGET_GRAPHEMES = 24000;
/** The minimal input derivation reads off the canonical article. The server
 * composition calls this just before ArticleSchema.parse with exactly these
 * fields assembled; the client passes a parsed record. */
export type StructureSource = Pick<CanonicalArticle, "id" | "revision" | "lang" | "blocks" | "footnotes"> & {
    /** The resolved work title (provenance.title). A body heading carrying it
     * is the article's own title artifact (Readability keeps the in-page h1,
     * promoted to h2) — it is the WORK's name, never one of its chapters. */
    provenanceTitle?: string;
};
/** Ordered publisher chapter titles captured at extraction (the source's own
 * table of contents). Ephemeral: consumed at derivation, never persisted. */
export type OutlineEvidence = readonly string[];
/** Local index links can corroborate an entry, never contradict it. The
 * ordinal may be absent from a repeated body heading; derivation separately
 * verifies the complete numbered group and its canonical occurrence count. */
export declare function publisherEntryMatchesHeading(entry: string, heading: string): boolean;
/**
 * Derive the work structure from canonical content (with optional publisher
 * outline evidence). Returns undefined only for a work with no readable text
 * at all (every block zero-length and no footnote bodies) — there is nothing
 * to divide, and orientation stays silent rather than inventing structure.
 */
export declare function deriveWorkStructure(source: StructureSource, evidence?: OutlineEvidence): WorkStructure | undefined;
/**
 * Validate a candidate structure (a persisted snapshot, an imported one, or
 * a freshly derived one) against the article's canonical content. Returns
 * the parsed structure, or null when ANY of these fail:
 *   - schema shape / version;
 *   - revision mismatch with the row;
 *   - the destinations do not tile the canonical coordinate stream exactly
 *     (gap, overlap, out-of-order, out-of-bounds, wrong block mapping);
 *   - the last destination does not end at the work's totalGraphemes
 *     (footnote bodies and trailing text stay covered);
 *   - chapter/part relations are malformed (unknown parent, part outside its
 *     chapter, a generated part claiming a chapter title source, duplicate
 *     ids).
 *
 * A partial or invalid snapshot is never a valid replacement for local
 * structure — callers fall back to derivation.
 */
export declare function validateWorkStructure(article: CanonicalArticle, candidate: unknown): WorkStructure | null;
/** One resolved chapter/part orientation for a canonical offset. */
export interface WorkPosition {
    /** The destination whose range contains the offset. */
    destination: StructureDestination;
    /** The containing chapter when the destination is (or sits under) one. */
    chapter?: StructureDestination;
    /** 1-based ordinals. Parts number within their chapter (or across the
     * work when chapterless); chapters number across the work. */
    chapterOrdinal?: number;
    chapterTotal?: number;
    partOrdinal?: number;
    partTotal?: number;
}
/**
 * The LEAF destinations — the ranges a reader actually moves through: a
 * chapter's generated parts when it has them, the chapter itself otherwise;
 * work-level parts when the structure has no chapters. Leaves tile the
 * canonical coordinate stream exactly once (guaranteed by validation).
 */
export declare function structureLeaves(structure: WorkStructure): StructureDestination[];
/**
 * Resolve a canonical D-05 offset to its chapter/reading part. Assumes a
 * VALIDATED structure (validateWorkStructure) — tiling makes the lookup a
 * binary search over the leaves' startOffsets. Offsets clamp into
 * [0, totalGraphemes), so footnote-region and end-pin offsets resolve to
 * the final leaf.
 */
export declare function resolveWorkPosition(article: CanonicalArticle, structure: WorkStructure, offset: number): WorkPosition | null;
/** Secondary source-section text only; generated processing parts stay hidden.
 * This presentation policy does not mutate or renumber frozen destinations.
 */
export declare function formatOrientationLabel(position: WorkPosition | null): string;
