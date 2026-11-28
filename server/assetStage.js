import { fetchImageAsset } from "./fetchImageAsset";
import { MAX_FIGURES_PER_ARTICLE, MAX_ASSET_RESPONSE_BYTES, ASSET_STAGE_DEADLINE_MS, ASSET_FETCH_CONCURRENCY, } from "./limits";
/** http(s) predicate — the collect step's admission filter. data: and every
 * other scheme are NEVER collected: they are already refused upstream by the
 * schema/httpUrl gate (D20-02 — no data: arm exists anywhere). */
const HTTP_SRC = /^https?:/i;
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
export function rewriteFiguresWithAssets(blocks, resolution, claimedSrc = (src) => HTTP_SRC.test(src)) {
    return blocks.map((b) => {
        if (b.kind === "figure") {
            const src = b.src;
            if (typeof src !== "string" || !claimedSrc(src))
                return b;
            const res = resolution.get(src);
            if (res === undefined)
                return b;
            if (typeof res === "string") {
                // Refused — omit the src key entirely (schema .optional(); no stale
                // remote URL survives into the canonical model), keep provenance
                // where it is URL-shaped (see the doc comment's http-only rule).
                const { src: _omit, ...rest } = b;
                return HTTP_SRC.test(src) ? { ...rest, originalSrc: src } : rest;
            }
            return HTTP_SRC.test(src)
                ? {
                    ...b,
                    src: "asset:" + res.assetId,
                    originalSrc: src,
                    width: res.width,
                    height: res.height,
                }
                : {
                    ...b,
                    src: "asset:" + res.assetId,
                    width: res.width,
                    height: res.height,
                };
        }
        if (b.kind === "blockquote") {
            return { ...b, children: rewriteFiguresWithAssets(b.children, resolution) };
        }
        if (b.kind === "bulleted-list") {
            return {
                ...b,
                items: b.items.map((i) => ({ content: rewriteFiguresWithAssets(i.content, resolution) })),
            };
        }
        if (b.kind === "numbered-list") {
            return {
                ...b,
                items: b.items.map((i) => ({ content: rewriteFiguresWithAssets(i.content, resolution) })),
            };
        }
        return b;
    });
}
/**
 * runAssetStage — collect unique http(s) figure srcs in document order,
 * enforce the three stage caps, fetch via the 20-01 seam with bounded
 * concurrency, and rewrite. Never throws for per-figure problems; only
 * infrastructure errors (a malformed blocks array) escape.
 */
export async function runAssetStage(blocks, options = {}) {
    // ── Collect: unique http(s) figure srcs in document order ───────────────
    const uniqueSrcs = [];
    const seenSrc = new Set();
    const collect = (bs) => {
        for (const b of bs) {
            if (b.kind === "figure") {
                const src = b.src;
                if (typeof src === "string" && HTTP_SRC.test(src) && !seenSrc.has(src)) {
                    seenSrc.add(src);
                    uniqueSrcs.push(src);
                }
            }
            else if (b.kind === "blockquote") {
                collect(b.children);
            }
            else if (b.kind === "bulleted-list" || b.kind === "numbered-list") {
                for (const item of b.items)
                    collect(item.content);
            }
        }
    };
    collect(blocks);
    const resolution = new Map();
    // ── Count cap: beyond-cap unique srcs refuse "count", never fetched ─────
    const fetchable = uniqueSrcs.filter((src, i) => {
        if (i >= MAX_FIGURES_PER_ARTICLE) {
            resolution.set(src, "count");
            return false;
        }
        return true;
    });
    // ── Deadline gate + bounded-concurrency fetch over the admitted srcs ────
    const deadlineAt = Date.now() + (options.deadlineMs ?? ASSET_STAGE_DEADLINE_MS);
    const expired = () => options.signal?.aborted === true || Date.now() >= deadlineAt;
    const fetched = new Map();
    let cursor = 0;
    const worker = async () => {
        for (;;) {
            const i = cursor++;
            if (i >= fetchable.length)
                return;
            const src = fetchable[i];
            if (expired()) {
                fetched.set(src, "deadline");
                continue;
            }
            try {
                // 260908-ef5 — thread the article-origin Referer through the seam.
                // The second argument is undefined when the option is absent, so
                // existing callers observe the exact pre-260908-ef5 call shape.
                fetched.set(src, await fetchImageAsset(src, options.refererOrigin !== undefined
                    ? { refererOrigin: options.refererOrigin }
                    : undefined));
            }
            catch {
                // fetchImageAsset never throws by contract (D20-05) — this guard
                // keeps the stage's own never-throw promise even if that contract
                // regresses. Calm per-figure "fetch" refusal, article survives.
                fetched.set(src, "fetch");
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(ASSET_FETCH_CONCURRENCY, fetchable.length) }, () => worker()));
    // ── Response budget: running decoded-byte total over ACCEPTED assets in
    // document order (first-come deterministic — D20-05 per-figure refusal
    // beyond it). Identical bytes (same assetId) self-identify: they reuse the
    // first admission without double-charging the budget (D7-07).
    const assets = [];
    const byAssetId = new Map();
    let budgetUsed = 0;
    for (const src of fetchable) {
        const res = fetched.get(src);
        if (res === undefined) {
            // Defensive: every fetchable src has a result (the worker pool covers
            // the full list). Treat the impossible as a calm deadline refusal.
            resolution.set(src, "deadline");
            continue;
        }
        if (typeof res === "string") {
            resolution.set(src, res); // fetch-level refusal passes through verbatim
            continue;
        }
        const known = byAssetId.get(res.assetId);
        if (known !== undefined) {
            resolution.set(src, known); // byte-identical twin — already admitted
            continue;
        }
        if (budgetUsed + res.bytes.byteLength > MAX_ASSET_RESPONSE_BYTES) {
            resolution.set(src, "budget");
            continue;
        }
        budgetUsed += res.bytes.byteLength;
        byAssetId.set(res.assetId, res);
        assets.push(res);
        resolution.set(src, res);
    }
    // ── Rewrite + per-figure refusal count (the disclosure the caller stamps)
    const rewritten = rewriteFiguresWithAssets(blocks, resolution);
    let refusedCount = 0;
    const countRefused = (bs) => {
        for (const b of bs) {
            if (b.kind === "figure") {
                const src = b.src;
                if (typeof src === "string" && HTTP_SRC.test(src)) {
                    const res = resolution.get(src);
                    if (res !== undefined && typeof res === "string")
                        refusedCount += 1;
                }
            }
            else if (b.kind === "blockquote") {
                countRefused(b.children);
            }
            else if (b.kind === "bulleted-list" || b.kind === "numbered-list") {
                for (const item of b.items)
                    countRefused(item.content);
            }
        }
    };
    countRefused(blocks);
    return { blocks: rewritten, assets, refusedCount };
}
