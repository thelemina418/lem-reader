import type { ViteDevServer } from "vite";
/**
 * viteIngestMiddleware — returns a Vite `configureServer` hook that installs
 * a connect middleware intercepting POST /api/ingest. The middleware runs the
 * full ingestion pipeline in Node and returns the IngestionResponse as JSON.
 * All other requests fall through to Vite's default handler (the SPA bundle).
 *
 * Body-size cap (Pitfall 7 / T-11-02 — Plan 11-03 Task 2; Phase 12 Plan
 * 12-04 Pitfall 2 fix): the pdf + epub variants carry base64-in-JSON bodies
 * up to MAX_INGEST_BODY_BYTES (now derived from max(PDF_MAX_BYTES,
 * EPUB_MAX_BYTES) in server/limits.ts — imported here, never re-derived
 * locally), and `readBody` accumulates unbounded. Two guards close that:
 *   1. PRE-READ — a content-length header over the cap is refused with 413
 *      BEFORE readBody attaches a single data listener (no allocation). The
 *      refusal copy follows the `?format=epub` query hint (epub-too-large
 *      vs pdf-too-large) — copy only; enforcement stays body-agnostic.
 *   2. POST-READ — a chunked request (no content-length) is re-checked
 *      against the same cap after readBody (byte length, not chars) and
 *      refused identically — with the reason branched on the PARSED body
 *      key (epub → epub-too-large, pdf → pdf-too-large, hint default
 *      otherwise) so an over-cap EPUB never sees PDF copy.
 * Nothing else in the route-match/response pattern changes — base64-in-JSON
 * keeps readBody + handleIngestBody byte-identical (locked transport
 * decision).
 *
 * Vite's `configureServer(server)` hook receives the `ViteDevServer` instance;
 * the connect middleware stack lives at `server.middlewares`. We install the
 * handler synchronously inside the hook body so it runs BEFORE Vite's
 * built-in middleware fallback (the SPA static handler) — POST /api/ingest
 * is intercepted on the way in, every other request calls next() and reaches
 * the SPA bundle as usual.
 *
 * Usage in vite.config.ts:
 *
 *   plugins: [{ name: "lem-ingest-dev-middleware", configureServer: viteIngestMiddleware() }]
 */
export declare function viteIngestMiddleware(): (server: ViteDevServer) => void;
