import type { Block } from "../src/content/schema";
import type { ImageAsset, ImageAssetRefusal } from "./fetchImageAsset";
/** AssetResolution — the STAGE-level supertype (cross-plan contract, locked
 * in 20-02-PLAN artifacts): 20-01's ImageAssetRefusal stays CLOSED at
 * fetch-level refusals (fetch|type|bytes|pixels|animated — the sniff
 * module's concern); the three stage arms are article-budget concepts
 * represented ONLY here, on the type this stage and 20-06 both consume.
 * No widening of the 20-01 union. */
export type AssetResolution = ImageAsset | ImageAssetRefusal | "count" | "budget" | "deadline";
/**
 * rewriteFiguresWithAssets — the pure recursive rewrite over the block tree.
 * For each figure carrying a src CLAIMED by `claimedSrc` (default: http(s) —
 * the network-path collect filter, byte-stable for every existing caller)
 * and present in the resolution map:
 *   - accepted (ImageAsset) → src becomes "asset:" + assetId, originalSrc the
 *     provenance URL, width/height the stored intrinsic px (ONLY these four
 *     fields differ — the spec asserts deep-equality on the rest)
 *   - refused (any string arm) → src omitted, originalSrc kept as the
 *     provenance of where the bytes would have come from
 * Figures with no src, unclaimed srcs, or srcs absent from the map are
 * returned unchanged. alt + caption are never touched (D-05 byte-identity).
 *
 * Provenance discipline (20-06): originalSrc is httpUrl-typed in the schema,
 * so it is written ONLY for http(s) srcs — the EPUB container path reuses
 * this function with a marker-claiming predicate whose chapter-relative srcs
 * are not URL-shaped; those figures carry their provenance in the refusal
 * disclosure instead, never a forced non-URL originalSrc.
 */
export declare function rewriteFiguresWithAssets(blocks: Block[], resolution: Map<string, AssetResolution>, claimedSrc?: (src: string) => boolean): Block[];
/** Options for runAssetStage. */
export interface AssetStageOptions {
    /** External cancellation (e.g. the HTTP request aborted). Remaining
     * figures refuse "deadline" — the bounded-inline-latency arm. */
    signal?: AbortSignal;
    /** Overall wall-clock budget in ms; defaults to ASSET_STAGE_DEADLINE_MS.
     * A non-positive value means the deadline is already expired (spec uses
     * this for the deterministic pre-expired cell). */
    deadlineMs?: number;
    /** 260908-ef5 — the SSRF-validated article origin the orchestrator derives
     * from finalUrl (new URL(finalUrl).origin), threaded to fetchImageAsset so
     * hotlink-protected CDNs see the browser-equivalent Referer. MUST come from
     * the validated article URL, never from an image src (see the seam's SSRF
     * rule). Undefined (the url-less paste/html-upload/markdown paths) omits
     * the Referer entirely — byte-stable for existing callers. */
    refererOrigin?: string;
}
/** The stage result: rewritten blocks, the accepted unique assets (in
 * document order, deduped by assetId — identical bytes self-identify per
 * D7-07), and the per-FIGURE refusal count the caller stamps into
 * ingestionMeta.extractionWarnings (T-20-10 disclosure — the stage never
 * stamps anything itself; the orchestrator owns the article). */
export interface AssetStageResult {
    blocks: Block[];
    assets: ImageAsset[];
    refusedCount: number;
}
/**
 * runAssetStage — collect unique http(s) figure srcs in document order,
 * enforce the three stage caps, fetch via the 20-01 seam with bounded
 * concurrency, and rewrite. Never throws for per-figure problems; only
 * infrastructure errors (a malformed blocks array) escape.
 */
export declare function runAssetStage(blocks: Block[], options?: AssetStageOptions): Promise<AssetStageResult>;
