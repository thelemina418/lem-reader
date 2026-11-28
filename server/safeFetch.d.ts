/** The fetched-document shape returned by safeFetch. `hash` is the SHA-256 of
 * the response body (V6 cryptography — Web Crypto subtle.digest), used for
 * `IngestionMeta.originalHtmlHash` traceability (07-02 schema). */
export interface FetchedContent {
    html: string;
    finalUrl: string;
    contentType: string;
    hash: string;
}
/** SafeFetchProfile — the parameterization seam (20-RESEARCH Pattern 1).
 * `allowedContentTypes` is matched as a substring against the declared
 * content-type header (the image profile passes ["image/"] — advisory only;
 * the byte sniff in fetchImageAsset decides admission). `bodyKind` selects
 * the read: "text" → res.text() (document profile, byte-stable); "bytes" →
 * res.arrayBuffer() + post-read byteLength re-check against maxBytes.
 * `contentTypeGate` (quick task 260908-ef5) selects the gate MODE over the
 * declared header: "strict" (the absent-field default — the document profile
 * passes no gate, so its observable behavior stays byte-identical and the
 * 19-vector e2e matrix holds untouched) refuses any header failing the
 * substring test; "admit-opaque" additionally lets the exhaustive opaque set
 * (empty / application/octet-stream / binary/octet-stream) reach the body
 * read so the authoritative magic-byte sniff decides admission (D20-10 —
 * CDNs, S3, and signed URLs commonly serve real image bytes under opaque
 * binary headers). One pipeline, parameterized — never forked (D20-12).
 * `headers` (quick task 260908-ef5) carries optional per-profile extra
 * request headers (e.g. the image profile's browser-like Accept); they are
 * merged AFTER the User-Agent literal, and an absent field yields exactly
 * today's single-header shape — the document profile's request headers stay
 * byte-identical. Redirect recursion threads the profile, so extra headers
 * persist per hop (desired: CDN redirect chains expect the Referer). */
export interface SafeFetchProfile {
    allowedContentTypes: string[];
    timeoutMs: number;
    maxBytes: number;
    bodyKind: "text" | "bytes";
    contentTypeGate?: "strict" | "admit-opaque";
    headers?: Record<string, string>;
}
/** The validated-response shape returned by safeFetchCore. `body` is a string
 * for the "text" profile and a Uint8Array for the "bytes" profile. */
export interface SafeFetchResult {
    finalUrl: string;
    contentType: string;
    body: string | Uint8Array;
}
/**
 * resolveValidatedHost — the shared pre-fetch host validation (Measures 5, 3,
 * 4): metadata-hostname blocklist → DNS resolve4/6 → ip-address deny-list on
 * EVERY resolved IP. Returns the validated IP list (v4 first — the caller
 * pins allIps[0], byte-identical to the pre-refactor v4[0] ?? v6[0] pin).
 * Throws IngestionError BEFORE any fetch (Measure 7 discipline). Extracted
 * verbatim from safeFetchCore so non-pipeline fetchers (the InnerTube POSTs
 * of server/youtubeTranscript.ts, whose constant endpoints bypass safeFetchCore
 * because it is GET-shaped) run the SAME validation — one guard shape, never
 * a fork of the checks (issue #35 AC: private/internal endpoints refused on
 * all outbound requests).
 */
export declare function resolveValidatedHost(hostname: string): Promise<string[]>;
/**
 * safeFetchCore — the parameterized 9-measure SSRF-safe pipeline. Runs
 * scheme → metadata-hostname → DNS-resolve → ip-address deny-list →
 * pinning/timeout → manual-redirect-per-hop → content-length cap →
 * content-type gate → body read, then returns the profile-shaped result.
 * Throws IngestionError BEFORE any body read on validation failure (Measure
 * 7 — no upstream body leaks). Recurses through redirects, re-validating
 * DNS + IP on every hop (Measure 2) under the SAME profile. The `hopDepth`
 * parameter is internal; callers pass only the URL + profile.
 */
export declare function safeFetchCore(rawUrl: string, profile: SafeFetchProfile, hopDepth?: number): Promise<SafeFetchResult>;
/**
 * safeFetch — the SSRF-safe DOCUMENT fetcher (the document profile wrapper
 * over safeFetchCore). Observable behavior is byte-identical to the
 * pre-Phase-20 single-profile implementation (Pitfall 4): same constants
 * (ALLOWED_CONTENT_TYPES / REQUEST_TIMEOUT_MS / MAX_RESPONSE_BYTES), same
 * IngestionError reasons, same redirect recursion, same headers, text body.
 */
export declare function safeFetch(rawUrl: string, hopDepth?: number): Promise<FetchedContent>;
/**
 * safeFeedFetch — the SSRF-safe FEED fetcher (issue #121; the third
 * SafeFetchProfile over the ONE pipeline — never a fork, D20-12). Same 9
 * measures, same per-hop redirect re-validation, same pre-read
 * content-length cap and Measure-7 no-body-read-on-refusal guarantee; the
 * profile differs only in its constants: the XML-subtype content-type
 * allowlist (FEED_CONTENT_TYPES), FEED_TIMEOUT_MS, and FEED_MAX_BYTES,
 * reading text. The result is the raw XML string — parsing/admission is
 * server/parseFeed's job (headers lie; the parse decides the feed is real).
 */
export declare function safeFeedFetch(rawUrl: string): Promise<SafeFetchResult>;
