import { type SafeFetchProfile } from "./safeFetch";
/** ImageAsset — the sniff result the 20-02 asset stage persists. `assetId` is
 * `img-<12hex>` (D7-07 shortHash locality precedent — identical bytes
 * self-identify); width/height are the orientation-corrected intrinsic pixels
 * (D20-13 — what the pagination reserved box consumes); contentType is the
 * SNIFFED canonical type, never the declared header. */
export interface ImageAsset {
    assetId: string;
    contentType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "image/avif";
    width: number;
    height: number;
    bytes: Uint8Array;
}
/** ImageAssetRefusal — the fetch-level typed refusals (D20-05: returned typed
 * values, NEVER throws). CLOSED at this level by design: the stage-level arms
 * "count"/"budget"/"deadline" are article-budget concepts that live ONLY on
 * 20-02's AssetResolution supertype, never on this union. */
export type ImageAssetRefusal = "fetch" | "type" | "bytes" | "pixels" | "animated";
/** The image profile over safeFetchCore — the ONLY fetch entry for assets (no
 * second SSRF egress path exists for images). The "image/" content-type gate
 * is genuinely ADVISORY (quick task 260908-ef5): with contentTypeGate
 * "admit-opaque", CDNs/S3/signed URLs serving real image bytes under an
 * application/octet-stream, binary/octet-stream, or empty declared header
 * flow through to sniffImageAsset below, which stays the SOLE admission
 * authority per D20-10 (headers lie; bytes do not) — the sniffed type still
 * decides, so an octet-stream-labeled HTML challenge page refuses on its
 * bytes. Clearly-non-image declarations (text/html, application/json,
 * text/plain, application/pdf) keep the early calm pre-read refusal in the
 * core. One pipeline, parameterized — never forked (D20-12).
 *
 * Browser-like Accept (260908-ef5): hotlink-protected CDNs (common on news
 * sites) 403 requests that look non-browser; the Accept value mirrors what
 * browsers advertise for image subresources (svg+xml included — the sniff
 * still refuses SVG bytes, D20-10 unchanged). */
export declare const IMAGE_FETCH_PROFILE: SafeFetchProfile;
/** fetchImageAsset options (quick task 260908-ef5).
 *
 * SSRF RULE — `refererOrigin` MUST be derived by the caller from the
 * ALREADY-SSRF-VALIDATED article URL (server/ingest.ts derives it via
 * new URL(finalUrl).origin after safeFetch validated every hop). It is
 * NEVER derived from any image src: it is a request HEADER, never a fetch
 * target, and cannot influence which host is fetched — the 9-measure
 * pipeline in safeFetchCore remains the sole egress authority (D20-12).
 * The value discloses exactly what a real browser visit to the article
 * would disclose to the CDN (T-EF5-02: accept). */
export interface FetchImageAssetOptions {
    refererOrigin?: string;
}
/**
 * fetchImageAsset — fetch an image URL through the shared SSRF-safe core,
 * then run the authoritative sniff on the returned bytes. Every fetch-layer
 * failure (SSRF refusal, timeout, redirect loop, cap, network error) maps to
 * the typed "fetch" refusal; the sniff's refusals are "bytes" | "type" |
 * "pixels" | "animated". Never throws (D20-05 composure — the stage applies
 * the calm per-figure fallback without try/catch noise).
 *
 * 260908-ef5: a non-empty `opts.refererOrigin` upgrades the per-call profile
 * with a Referer header (spread over IMAGE_FETCH_PROFILE — Accept and every
 * other profile field persist); an absent/empty one passes IMAGE_FETCH_PROFILE
 * unchanged, so existing callers are byte-stable.
 */
export declare function fetchImageAsset(url: string, opts?: FetchImageAssetOptions): Promise<ImageAsset | ImageAssetRefusal>;
/**
 * sniffImageAsset — the network-free sniff sequence (the shared seam the
 * 20-06 EPUB container path reuses over already-local archive bytes). Order:
 *   1. bytes.byteLength re-check vs MAX_ASSET_BYTES → "bytes" (the core
 *      already re-checks post-read on the fetch path; this guards the
 *      container path and keeps the seam self-contained)
 *   2. sniffed type outside the D20-08 raster set (svg included — D20-10,
 *      imageSize throw included) → "type"
 *   3. sniffed width×height > MAX_ASSET_PIXELS → "pixels" (decode-bomb stop)
 *   4. isAnimated(bytes) → "animated" (GIF/WebP/APNG — D20-09)
 *   5. EXIF orientation >= 5 swaps stored width/height (Pitfall 2)
 *   6. assetId = "img-" + sha256(bytes).slice(0, 12) (D7-07)
 */
export declare function sniffImageAsset(bytes: Uint8Array): ImageAsset | ImageAssetRefusal;
