/** Fetch timeout (AbortSignal.timeout cap). CONTEXT.md "~30s"; Workers CPU
 * limit is 30s on most plans. Generous enough for slow publishers; tight
 * enough to prevent the fetcher being weaponized as a DoS amplifier. */
export declare const REQUEST_TIMEOUT_MS = 30000;
/** Maximum response body size. A real article HTML is 100KB–2MB; 5MB caps
 * pathological pages without rejecting legitimate long-form. Checked against
 * the Content-Length header BEFORE res.text() (Measure 7 — no body leak on
 * refusal). */
export declare const MAX_RESPONSE_BYTES: number;
/** Redirect cap. OWASP recommends 3–5; 5 covers legitimate redirect chains
 * (e.g. medium.com → cdn) without enabling redirect-loops. Each hop is
 * re-validated through the full safeFetch pipeline (Measure 2). */
export declare const MAX_REDIRECTS = 5;
/** Content-type allowlist. CONTEXT.md lock. Only (text|application)/(xhtml+)html
 * is accepted; application/pdf, image/*, text/plain etc. are refused at the
 * boundary (Measure 12). */
export declare const ALLOWED_CONTENT_TYPES: string[];
/** Private / reserved IP ranges — the OWASP SSRF Cheat Sheet Case 2 deny-list
 * minimum. The ip-address library's Address4/Address6.isInSubnet checks every
 * resolved IP against these CIDRs (Measure 4). Covers:
 *   - 10/8, 172.16/12, 192.168/16 (RFC 1918 private)
 *   - 169.254/16 (link-local + cloud-metadata)
 *   - 127/8 (loopback)
 *   - 0/8 (this-network)
 *   - 100.64/10 (CGNAT — RFC 6598)
 *   - 224/4 (multicast)
 *   - ::1/128, fc00::/7, fe80::/10, ff00::/8 (IPv6 reserved scopes)
 * CITED: 07-RESEARCH.md §SSRF Guard Implementation L401-406. */
export declare const PRIVATE_RANGES: readonly ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "127.0.0.0/8", "0.0.0.0/8", "100.64.0.0/10", "224.0.0.0/4", "::1/128", "fc00::/7", "fe80::/10", "ff00::/8"];
/** Cloud-metadata hostnames — the explicit blocklist (Measure 5). AWS/GCP/Azure
 * metadata endpoints serve credentials to anyone who can reach them; blocking
 * the hostname BEFORE DNS resolution closes the cheapest SSRF exfil path.
 * CITED: 07-RESEARCH.md §SSRF Guard Implementation L407. */
export declare const METADATA_HOSTNAMES: readonly ["169.254.169.254", "metadata.google.internal", "metadata.amazonaws.com"];
import { PDF_MAX_BYTES } from "../src/ingestion/types";
export { PDF_MAX_BYTES };
/** Maximum page count of an admitted PDF (T-11-01 DoS cap). ~500 pages covers
 * book-length documents while bounding extraction work; a document over this
 * refuses with `pdf-too-large` BEFORE parsing begins. */
export declare const PDF_MAX_PAGES = 500;
/** PDF extraction timeout (AbortSignal cap) — mirrors REQUEST_TIMEOUT_MS above
 * (planner resolution of 11-RESEARCH Open Question 2): Workers CPU limit is
 * 30s on most plans and text extraction is CPU-bound, so the same wall-clock
 * generosity/tightness tradeoff applies. */
export declare const PDF_EXTRACTION_TIMEOUT_MS = 30000;
/** MAX_IMAGE_PIXELS — the pdf.js image-decompression bomb cap. PROVENANCE
 * CORRECTION: this is TOTAL PIXELS (width×height ≈ 16 megapixels), NOT bytes —
 * correcting the ARCHITECTURE.md L781 "16 MB" label per 11-RESEARCH.md §State
 * of the Art. A modest pixel count decompresses to enormous byte counts (the
 * classic zip-bomb analog: a tiny PNG declaring a 65,000×65,000 canvas); the
 * pdf.js `EvaluatorOptions.maxImagePixels` option counts PIXELS, and 16,777,216
 * (4096×4096) is its default ceiling — re-stated here explicitly so the cap is
 * auditable alongside every other server limit. */
export declare const MAX_IMAGE_PIXELS = 16777216;
import { EPUB_MAX_BYTES } from "../src/ingestion/types";
export { EPUB_MAX_BYTES };
/** Maximum chapter (article) count of an admitted EPUB (assumption A2 sanity
 * ceiling; T-12-01 DoS cap). A real book never approaches 1000 chapters; an
 * EPUB whose TOC/spine derives more refuses with `epub-too-large` before
 * per-chapter work begins. */
export declare const EPUB_MAX_CHAPTERS = 1000;
/** EPUB extraction timeout (AbortSignal cap) — mirrors REQUEST_TIMEOUT_MS and
 * PDF_EXTRACTION_TIMEOUT_MS above: the EPUB unzip + XML parse + per-chapter
 * sanitize/walk is CPU-bound, so the same wall-clock generosity/tightness
 * tradeoff applies (12-RESEARCH Open Question 2's PDF resolution, EPUB
 * edition). */
export declare const EPUB_EXTRACTION_TIMEOUT_MS = 30000;
/** Per-entry decompressed bomb cap for EPUB archive entries (T-12-01). A
 * single XHTML document over 64MB inside a ≤10MB zip is pathological; this
 * is the Phase 9 MAX_ENTRY_ORIGINAL_SIZE discipline (fflate filter skips
 * over-cap entries BEFORE inflation — over-cap entries are never inflated)
 * at an EPUB-appropriate constant. Enforced in 12-02's epubToBooks. */
export declare const EPUB_MAX_ENTRY_BYTES: number;
/** Maximum raw JSON body size accepted by the ingest middleware for the
 * binary upload paths. The request carries base64-in-JSON (~33% inflation
 * over the decoded cap) plus JSON envelope overhead (keys, filename, quotes)
 * — Pitfall 7 of 11-RESEARCH.md + Pitfall 2 of 12-RESEARCH.md: the
 * middleware must refuse on `content-length` BEFORE readBody accumulates,
 * and this is the number it checks against. Derived from the LARGER of the
 * two decoded caps so whichever format diverges upward stays admissible —
 * numerically identical today (equal 10MB caps) but structurally correct
 * for future divergence. The +2048 slack absorbs the envelope; the
 * Math.ceil rounds the 4/3 base64 ratio up so a maximum-size valid upload
 * is never refused by the transport guard. */
export declare const MAX_INGEST_BODY_BYTES: number;
import { MAX_ASSET_BYTES, MAX_ASSET_PIXELS, ASSET_FETCH_TIMEOUT_MS, ASSET_STAGE_DEADLINE_MS, ASSET_FETCH_CONCURRENCY, MAX_FIGURES_PER_ARTICLE, MAX_ARTICLE_ASSET_BYTES, MAX_ASSET_RESPONSE_BYTES } from "../src/ingestion/types";
export { MAX_ASSET_BYTES, MAX_ASSET_PIXELS, ASSET_FETCH_TIMEOUT_MS, ASSET_STAGE_DEADLINE_MS, ASSET_FETCH_CONCURRENCY, MAX_FIGURES_PER_ARTICLE, MAX_ARTICLE_ASSET_BYTES, MAX_ASSET_RESPONSE_BYTES, };
/** Transcript fetch timeout (AbortSignal cap) — mirrors REQUEST_TIMEOUT_MS
 * ("~30s per call", issue #35): Workers CPU limit is 30s on most plans and
 * each of the client's calls is an independent network round-trip, so the
 * same wall-clock generosity/tightness tradeoff applies. */
export declare const TRANSCRIPT_TIMEOUT_MS = 30000;
/** Maximum response body size per transcript-client call — mirrors
 * MAX_RESPONSE_BYTES (5MB). A player response runs ~250KB, a WEB `next`
 * response ~1-2MB; the ANDROID `next` variant measured 14MB live on
 * 2026-09-16, which is exactly the pathological shape this cap refuses. */
export declare const TRANSCRIPT_MAX_BYTES: number;
import { MAX_FEED_ITEMS, MAX_FEED_TEXT_CHARS } from "../src/content/schema";
export { MAX_FEED_ITEMS, MAX_FEED_TEXT_CHARS };
/** Feed fetch timeout (AbortSignal cap) — mirrors REQUEST_TIMEOUT_MS: a
 * feed is one network round-trip like a document fetch, so the same
 * generosity/tightness tradeoff applies. */
export declare const FEED_TIMEOUT_MS = 30000;
/** Maximum feed response body size — mirrors MAX_RESPONSE_BYTES (5MB).
 * Real feeds run 10KB–1MB (bounded preview windows); 5MB caps pathological
 * XML without rejecting legitimate feeds. Checked against Content-Length
 * BEFORE the body read (Measure 7 — no body leak on refusal). */
export declare const FEED_MAX_BYTES: number;
/** Content-type allowlist for the feed fetch profile — ANY XML subtype.
 * Substring-matched against the declared header (the SafeFetchProfile
 * contract): `+xml` covers application/rss+xml, application/atom+xml, and
 * every other RFC 3023 XML subtype registration; the two plain
 * registrations (`application/xml`, `text/xml`) are listed explicitly since
 * neither contains the `+xml` suffix. HTML challenge pages, JSON, and
 * octet-stream refuse pre-read (the Discover surface carries the feed-aware
 * copy). */
export declare const FEED_CONTENT_TYPES: string[];
