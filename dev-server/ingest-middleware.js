import { handleIngestBody } from "../server/ingestAdapter";
import { MAX_INGEST_BODY_BYTES } from "../server/limits";
/**
 * Read the request body as a UTF-8 string. Returns "" if the request has no
 * body (the adapter helper turns it into a server-error 400).
 */
function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = "";
        req.setEncoding("utf-8");
        req.on("data", (chunk) => {
            data += chunk;
        });
        req.on("end", () => resolve(data));
        req.on("error", reject);
    });
}
/**
 * Pre-read reason selection — from the URL query hint ONLY (12-03's
 * ingestEpub posts to /api/ingest?format=epub). The hint selects COPY;
 * enforcement remains content-length-based and body-agnostic (the guard
 * fires BEFORE readBody attaches a single data listener — no body exists
 * to inspect yet).
 */
function tooLargeReasonFromUrl(url) {
    return url.includes("format=epub") ? "epub-too-large" : "pdf-too-large";
}
/**
 * Post-read reason selection — branch on the parsed body shape (the chunked
 * / lying-content-length path already accumulated the body, so the honest
 * discriminator is the body key itself): the epub key → "epub-too-large",
 * the pdf key → "pdf-too-large". A non-JSON body (or a text variant —
 * url/paste/markdown carry neither key) falls through to the URL-hint
 * default, which preserves the pre-Phase-12 behavior byte-for-byte.
 */
function tooLargeReasonFromBody(raw, url) {
    try {
        const parsed = raw.length === 0 ? null : JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            if ("epub" in parsed)
                return "epub-too-large";
            if ("pdf" in parsed)
                return "pdf-too-large";
        }
    }
    catch {
        // Not JSON — the raw-length cap already fired; the hint default below
        // keeps the historical refusal copy.
    }
    return tooLargeReasonFromUrl(url);
}
/**
 * Refuse with the typed too-large envelope + HTTP 413. Shared by both cap
 * paths below (content-length pre-read + post-read raw-length re-check)
 * so the refusal shape stays byte-identical (T-11-02 mitigation) — only
 * the `reason` copy is format-aware (Phase 12 Pitfall 2).
 */
function refuseTooLarge(res, reason) {
    res.statusCode = 413;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason }));
}
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
export function viteIngestMiddleware() {
    return (server) => {
        server.middlewares.use(async (req, res, next) => {
            const url = req.url ?? "";
            // Match POST /api/ingest exactly. (Vite normalizes the SPA dev server
            // to one origin on :5173, so the client's `fetch("/api/ingest")`
            // arrives here directly — no proxy.)
            const path = url.split("?")[0] ?? url;
            if (req.method !== "POST" || !path.endsWith("/api/ingest")) {
                return next();
            }
            // Guard 1 — content-length PRE-READ cap. An unparseable header falls
            // through to guard 2 (the post-read re-check still bounds the body).
            // Reason copy from the query hint (Pitfall 2): format=epub →
            // epub-too-large; otherwise the historical pdf-too-large.
            const contentLengthRaw = req.headers["content-length"];
            if (contentLengthRaw !== undefined) {
                const contentLength = Number.parseInt(String(contentLengthRaw), 10);
                if (Number.isFinite(contentLength) && contentLength > MAX_INGEST_BODY_BYTES) {
                    refuseTooLarge(res, tooLargeReasonFromUrl(url));
                    return;
                }
            }
            let body;
            try {
                const raw = await readBody(req);
                // Guard 2 — post-read raw-length cap (chunked requests carry no
                // content-length). Byte-accurate: readBody yields a utf-8 string,
                // the cap counts bytes. Reason branches on the parsed body key
                // (Pitfall 2) with the hint default for non-JSON/text bodies.
                if (Buffer.byteLength(raw, "utf-8") > MAX_INGEST_BODY_BYTES) {
                    refuseTooLarge(res, tooLargeReasonFromBody(raw, url));
                    return;
                }
                body = raw.length === 0 ? null : JSON.parse(raw);
            }
            catch {
                // JSON.parse failure — surface as the typed server-error envelope.
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ ok: false, reason: "server-error" }));
                return;
            }
            const { status, body: responseBody } = await handleIngestBody(body);
            res.statusCode = status;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(responseBody));
        });
    };
}
