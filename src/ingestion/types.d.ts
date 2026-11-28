import { z } from "zod";
/**
 * MAX_PREFERRED_LANGUAGES — the count cap for the url variant's optional
 * `preferredLanguages` list (issue #59; decisions #56/#57). Browsers bound
 * `navigator.languages` to a handful of entries; 10 covers every real
 * browser list with headroom. Lives HERE (not /server) because the client
 * `browserPreferredLanguages` must slice to the SAME cap before posting —
 * a long browser list must degrade to a shorter preference, never a refused
 * import (the /src→/server import direction is forbidden).
 */
export declare const MAX_PREFERRED_LANGUAGES = 10;
/**
 * MAX_LANGUAGE_TAG_LENGTH — the per-tag length cap for `preferredLanguages`.
 * RFC 5646 §2.1.1 bounds a legal BCP-47 tag at 35 characters, so anything
 * longer cannot be a language tag (the DoS-shape guard of the limits
 * conventions — the tags are matched, never persisted).
 */
export declare const MAX_LANGUAGE_TAG_LENGTH = 35;
/**
 * MAX_PASTED_TRANSCRIPT_CHARS — the text cap for the transcript-paste
 * fallback variant (the youtube-bot-check companion). A 3-hour video's
 * transcript panel copy is ~40k characters; 500k leaves two orders of
 * magnitude of headroom while bounding DoS amplification (the
 * PDF_MAX_BYTES philosophy). Lives HERE so the client dialog can refuse
 * oversize pastes BEFORE any network cost (the T-16-05 earliest-enforcement
 * pattern) and the server re-checks after Zod parse (defense-in-depth).
 */
export declare const MAX_PASTED_TRANSCRIPT_CHARS = 500000;
/** IngestionRequest — D7-03 input-source-agnostic envelope. Exactly one of
 * {url} | {html} | {markdown}. The url variant is httpUrl-refined (single
 * source of truth with Provenance.sourceUrl / IngestionMeta.sourceUrl); the
 * html variant requires `.min(1)` so an empty paste is rejected at the
 * boundary (D7-03). The Phase 8 markdown variant (D8-16 + D8-17) carries the
 * raw `.md` source plus an optional `filename` hint — the server uses the
 * filename ONLY for the title fallback chain (D8-17); it does NOT affect the
 * article id (D8-18 — id is content-hash, not filename-hash). */
export declare const IngestionRequestSchema: z.ZodUnion<readonly [z.ZodObject<{
    url: z.ZodString;
    preferredLanguages: z.ZodCatch<z.ZodOptional<z.ZodArray<z.ZodString>>>;
}, z.core.$strip>, z.ZodObject<{
    html: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    markdown: z.ZodString;
    filename: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    pdf: z.ZodString;
    filename: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    epub: z.ZodString;
    filename: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    transcript: z.ZodObject<{
        text: z.ZodString;
        title: z.ZodString;
        url: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    feedUrl: z.ZodString;
}, z.core.$strip>]>;
export type IngestionRequest = z.infer<typeof IngestionRequestSchema>;
/**
 * PDF_MAX_BYTES — the decoded-byte cap for the Phase 11 PDF upload path
 * (ING-04), shared by THREE enforcement points: the client file picker
 * (the add dialog refuses file.size > PDF_MAX_BYTES before reading), the
 * middleware content-length guard (MAX_INGEST_BODY_BYTES derives from it), and
 * the orchestrator re-check after base64 decode (defense-in-depth). Lives HERE
 * (not in /server) because the /src→/server import direction is forbidden —
 * `server/limits.ts` re-exports it so server modules share one constant.
 * ~10MB mirrors the 07-RESEARCH fetch-body philosophy: generous for real
 * long-form documents, tight enough to prevent DoS amplification.
 */
export declare const PDF_MAX_BYTES: number;
/**
 * EPUB_MAX_BYTES — the decoded-byte cap for the Phase 12 EPUB upload path
 * (ING-05), shared by the SAME three enforcement points as PDF_MAX_BYTES:
 * the client file picker (the add dialog refuses file.size > EPUB_MAX_BYTES
 * before reading — the 11-04 earliest-enforcement pattern), the middleware
 * content-length guard (MAX_INGEST_BODY_BYTES derives from
 * max(PDF_MAX_BYTES, EPUB_MAX_BYTES)), and the orchestrator re-check after
 * base64 decode (defense-in-depth — 12-RESEARCH assumption A2 mirrors the
 * 07-RESEARCH fetch-body philosophy: XHTML text is tiny and images are
 * deferred per D12-16, so 10MB is generous while bounding DoS amplification).
 */
export declare const EPUB_MAX_BYTES: number;
/** Per-asset decoded-byte cap (fetch + EPUB container paths share it). 16MB
 * covers full-resolution editorial photography with headroom while bounding
 * per-asset memory; enforced post-read via bytes.byteLength (the 12-04
 * header-lie discipline — content-length can lie/absent/chunked). */
export declare const MAX_ASSET_BYTES: number;
/** Per-asset pixel cap (sniffed width×height, checked BEFORE any store).
 * Deliberately the SAME value as server/limits.ts MAX_IMAGE_PIXELS — one
 * auditable bomb-cap family (a tiny PNG declaring a 65,000×65,000 canvas
 * refuses here exactly like pdf.js decompression would). */
export declare const MAX_ASSET_PIXELS = 16777216;
/** Per-asset fetch timeout (AbortSignal cap for the image profile). Tighter
 * than the 30s document REQUEST_TIMEOUT_MS: an asset is a secondary resource
 * inline-fetched at ingest (D20-04) — one slow image must not eat the whole
 * per-article stage deadline. */
export declare const ASSET_FETCH_TIMEOUT_MS = 15000;
/** Overall per-article inline image budget (D20-04: assets fetch INLINE at
 * ingest — a saved article is ALWAYS complete). The stage refuses further
 * per-figure fetches beyond this wall-clock budget. */
export declare const ASSET_STAGE_DEADLINE_MS = 60000;
/** Bounded-concurrency parallel asset fetching (A6: ≈4 keeps inline ingest
 * latency acceptable; the stage is sequential-safe fallback). */
export declare const ASSET_FETCH_CONCURRENCY = 4;
/** Per-article figure count cap (image-spam page stopper; D20-11). 120 covers
 * the most figure-dense longform (photo essays run 20-60). */
export declare const MAX_FIGURES_PER_ARTICLE = 120;
/** Model-level per-article total asset bytes (the D20-15 article-owned budget
 * upper bound — dev/persistence side; the transport-side number is the tighter
 * MAX_ASSET_RESPONSE_BYTES below). */
export declare const MAX_ARTICLE_ASSET_BYTES: number;
/** Decoded asset total allowed in the single-article JSON transport path.
 * Base64 inflation (~4/3) puts a 3MB decoded budget at ≈4MB on the wire —
 * keeping the Vercel 4.5MB response ceiling honest; assets beyond it refuse
 * per-figure (D20-05). Dev middleware is uncapped but the constant keeps
 * dev/prod behavior uniform. */
export declare const MAX_ASSET_RESPONSE_BYTES: number;
/** AssetEnvelopeSchema — the wire shape of ONE accepted image asset on the
 * ingest response (base64-in-JSON, mirroring the pdf/epub upload transport
 * decision; the server-side twin is server/ingest.ts AssetEnvelope).
 * `assetId` is the assetRef BODY — `img-<12 lowercase hex>`, i.e. exactly the
 * FigureBlock `asset:img-…` reference minus the scheme prefix (the schema
 * module's assetRef regex carries the prefixed form; this dedicated chain
 * keeps the envelope field self-describing at the network boundary).
 * `dataBase64` is validated by the CLIENT re-validation pipeline
 * (IngestionClient: decode + byteLength re-check + assetId re-hash —
 * Pitfall 10: the server is not trusted), not by length here — Zod's job is
 * shape, the crypto check is the load-bearing integrity gate. */
export declare const AssetEnvelopeSchema: z.ZodObject<{
    assetId: z.ZodString;
    contentType: z.ZodEnum<{
        "image/avif": "image/avif";
        "image/gif": "image/gif";
        "image/jpeg": "image/jpeg";
        "image/png": "image/png";
        "image/webp": "image/webp";
    }>;
    byteLength: z.ZodNumber;
    dataBase64: z.ZodString;
}, z.core.$strip>;
export type AssetEnvelope = z.infer<typeof AssetEnvelopeSchema>;
/** IngestionFailureReasonEnum — the 20 honest-failure reasons surfaced to the
 * reader. Cataloged at 07-RESEARCH.md §Code Examples Example 1 L793-795 (the 9
 * pipeline reasons) plus `already-in-library` (D7-07 dedupe-refuse) plus
 * `extraction-unsupported` (ING-06 three-state — the "couldn't reliably read
 * this page" refusal). The "server-error" catch-all closes the catalog. The
 * Phase 11 PDF members (Pattern 7 of 11-RESEARCH.md) slot in after
 * `round-trip-anchor-failed`: pdf-unreadable (parser refuses — includes the
 * corrupt-fixture class), pdf-encrypted (password-protected), pdf-scanned (no
 * text layer — zero extractable items), pdf-multi-column (refuse rather than
 * silently reorder reading order), pdf-too-large (over PDF_MAX_BYTES decoded /
 * PDF_MAX_PAGES). The Phase 12 EPUB members slot in after `pdf-too-large`:
 * epub-protected (DRM — ADEPT/LCP/FairPlay/unknown-vendor detection-only
 * refusal, never decrypt), epub-unreadable (corrupt/unparseable
 * container/OPF/zip, Zip Slip, entity/proto hostility), epub-empty (zero
 * chapters admit — whole-document refusal per D12-11), epub-too-large (over
 * EPUB_MAX_BYTES / EPUB_MAX_CHAPTERS). `already-in-library` and
 * `server-error` stay LAST. The client maps each to a calm DOC-06 phrase in
 * the `.status` live region (D7-04). */
export declare const IngestionFailureReasonEnum: z.ZodEnum<{
    "already-in-library": "already-in-library";
    "epub-empty": "epub-empty";
    "epub-protected": "epub-protected";
    "epub-too-large": "epub-too-large";
    "epub-unreadable": "epub-unreadable";
    "extraction-unsupported": "extraction-unsupported";
    "feed-unreadable": "feed-unreadable";
    "fetch-failed": "fetch-failed";
    "pdf-encrypted": "pdf-encrypted";
    "pdf-multi-column": "pdf-multi-column";
    "pdf-scanned": "pdf-scanned";
    "pdf-too-large": "pdf-too-large";
    "pdf-unreadable": "pdf-unreadable";
    "response-too-large": "response-too-large";
    "round-trip-anchor-failed": "round-trip-anchor-failed";
    "server-error": "server-error";
    "ssrf-blocked-metadata": "ssrf-blocked-metadata";
    "ssrf-blocked-private-ip": "ssrf-blocked-private-ip";
    "ssrf-blocked-scheme": "ssrf-blocked-scheme";
    "unsupported-content-type": "unsupported-content-type";
    "youtube-age-gated": "youtube-age-gated";
    "youtube-bot-check": "youtube-bot-check";
    "youtube-no-captions": "youtube-no-captions";
    "youtube-unavailable-private": "youtube-unavailable-private";
}>;
export type IngestionFailureReason = z.infer<typeof IngestionFailureReasonEnum>;
/** FeedPreviewSchema — the wire shape of ONE accepted feed candidate
 * (issue #121). `url` is the NORMALIZED post-redirect feed URL (the import
 * merge key — normalizeFeedUrl over safeFetch's finalUrl); `title` is the
 * feed's own channel/feed name; `items` is the bounded recent-preview cache
 * the Discover surface renders and the subscription persists. Composed from
 * the record schemas in ../content/schema (never re-declared — the schemas
 * are the trust boundary); bounds are enforced here so a hostile server
 * response cannot smuggle oversized/overcounted rows past the client
 * re-validation (STATE-04 — the ArticleSchema.parse discipline). */
export declare const FeedPreviewSchema: z.ZodObject<{
    url: z.ZodString;
    title: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    items: z.ZodArray<z.ZodObject<{
        title: z.ZodString;
        link: z.ZodOptional<z.ZodString>;
        datePublished: z.ZodOptional<z.ZodString>;
        excerpt: z.ZodOptional<z.ZodString>;
        image: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type FeedPreview = z.infer<typeof FeedPreviewSchema>;
/** IngestionResponse — discriminated envelope. Single-article success carries
 * the validated `CanonicalArticle` plus the two-state `confidence` derived
 * signal (confident | low); book success (Phase 12) carries the validated
 * `Book` plus its chapter articles (min 1) and the D12-11 skip disclosure
 * count; feed success (issue #121) carries the validated `FeedPreview`.
 * Failure carries the cataloged reason. `extractionConfidence:
 * "unsupported"` never reaches this envelope — it is refused upstream as
 * `extraction-unsupported`. The article(s) are RE-VALIDATED through
 * ArticleSchema here (Zod-at-boundary — defense-in-depth; the server also
 * runs parse() but the network is a trust boundary per STATE-04). */
export declare const IngestionResponseSchema: z.ZodUnion<readonly [z.ZodObject<{
    ok: z.ZodLiteral<true>;
    article: z.ZodObject<{
        id: z.ZodString;
        revision: z.ZodNumber;
        lang: z.ZodString;
        provenance: z.ZodObject<{
            sourceUrl: z.ZodOptional<z.ZodString>;
            sourceAliases: z.ZodOptional<z.ZodArray<z.ZodString>>;
            title: z.ZodString;
            author: z.ZodOptional<z.ZodString>;
            publishedAt: z.ZodOptional<z.ZodString>;
            retrievedAt: z.ZodString;
            originalHtmlHash: z.ZodString;
            license: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
        blocks: z.ZodArray<z.ZodType<import("../content/schema").Block, unknown, z.core.$ZodTypeInternals<import("../content/schema").Block, unknown>>>;
        footnotes: z.ZodDefault<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            content: z.ZodArray<z.ZodObject<{
                text: z.ZodString;
                marks: z.ZodDefault<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                    type: z.ZodLiteral<"link">;
                    href: z.ZodString;
                    title: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>, z.ZodObject<{
                    type: z.ZodLiteral<"code">;
                }, z.core.$strip>, z.ZodObject<{
                    type: z.ZodLiteral<"strong">;
                }, z.core.$strip>, z.ZodObject<{
                    type: z.ZodLiteral<"em">;
                }, z.core.$strip>, z.ZodObject<{
                    type: z.ZodLiteral<"footnote-ref">;
                    footnoteId: z.ZodString;
                    occurrence: z.ZodDefault<z.ZodNumber>;
                }, z.core.$strip>]>>>;
            }, z.core.$strip>>;
            laterParagraphs: z.ZodOptional<z.ZodArray<z.ZodArray<z.ZodObject<{
                text: z.ZodString;
                marks: z.ZodDefault<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                    type: z.ZodLiteral<"link">;
                    href: z.ZodString;
                    title: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>, z.ZodObject<{
                    type: z.ZodLiteral<"code">;
                }, z.core.$strip>, z.ZodObject<{
                    type: z.ZodLiteral<"strong">;
                }, z.core.$strip>, z.ZodObject<{
                    type: z.ZodLiteral<"em">;
                }, z.core.$strip>, z.ZodObject<{
                    type: z.ZodLiteral<"footnote-ref">;
                    footnoteId: z.ZodString;
                    occurrence: z.ZodDefault<z.ZodNumber>;
                }, z.core.$strip>]>>>;
            }, z.core.$strip>>>>;
        }, z.core.$strip>>>;
        ingestionMeta: z.ZodOptional<z.ZodObject<{
            source: z.ZodEnum<{
                "epub-chapter": "epub-chapter";
                fixture: "fixture";
                "html-upload": "html-upload";
                markdown: "markdown";
                paste: "paste";
                pdf: "pdf";
                url: "url";
                youtube: "youtube";
            }>;
            origin: z.ZodOptional<z.ZodEnum<{
                paste: "paste";
                upload: "upload";
                url: "url";
            }>>;
            sourceUrl: z.ZodOptional<z.ZodString>;
            originalHtmlHash: z.ZodString;
            fetchedAt: z.ZodOptional<z.ZodString>;
            extractionConfidence: z.ZodEnum<{
                high: "high";
                low: "low";
            }>;
            extractionWarnings: z.ZodDefault<z.ZodArray<z.ZodString>>;
            annotationsDegraded: z.ZodOptional<z.ZodBoolean>;
            bookId: z.ZodOptional<z.ZodString>;
            chapterIndex: z.ZodOptional<z.ZodNumber>;
            transcript: z.ZodOptional<z.ZodObject<{
                videoId: z.ZodString;
                durationSeconds: z.ZodNumber;
                captionSource: z.ZodEnum<{
                    asr: "asr";
                    manual: "manual";
                    pasted: "pasted";
                }>;
                captionLanguage: z.ZodString;
                segments: z.ZodArray<z.ZodObject<{
                    blockIndex: z.ZodNumber;
                    startMs: z.ZodNumber;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        tags: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString>>>;
        readerTitle: z.ZodOptional<z.ZodString>;
        readerAuthor: z.ZodOptional<z.ZodString>;
        readerPublishedAt: z.ZodOptional<z.ZodString>;
        readerSourceUrl: z.ZodOptional<z.ZodString>;
        structure: z.ZodOptional<z.ZodObject<{
            schemaVersion: z.ZodLiteral<1>;
            generatorVersion: z.ZodNumber;
            revision: z.ZodNumber;
            corrections: z.ZodOptional<z.ZodString>;
            destinations: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                kind: z.ZodEnum<{
                    chapter: "chapter";
                    part: "part";
                }>;
                title: z.ZodString;
                titleSource: z.ZodEnum<{
                    generated: "generated";
                    heading: "heading";
                    publisher: "publisher";
                }>;
                parentChapterId: z.ZodOptional<z.ZodString>;
                startBlock: z.ZodNumber;
                endBlock: z.ZodNumber;
                startGrapheme: z.ZodOptional<z.ZodNumber>;
                endGrapheme: z.ZodOptional<z.ZodNumber>;
                startOffset: z.ZodNumber;
                endOffset: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        addedAt: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    confidence: z.ZodObject<{
        state: z.ZodEnum<{
            confident: "confident";
            low: "low";
        }>;
    }, z.core.$strip>;
    assets: z.ZodDefault<z.ZodArray<z.ZodObject<{
        assetId: z.ZodString;
        contentType: z.ZodEnum<{
            "image/avif": "image/avif";
            "image/gif": "image/gif";
            "image/jpeg": "image/jpeg";
            "image/png": "image/png";
            "image/webp": "image/webp";
        }>;
        byteLength: z.ZodNumber;
        dataBase64: z.ZodString;
    }, z.core.$strip>>>;
}, z.core.$strip>, z.ZodObject<{
    ok: z.ZodLiteral<true>;
    book: z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        authors: z.ZodDefault<z.ZodArray<z.ZodString>>;
        language: z.ZodString;
        chapterArticleIds: z.ZodArray<z.ZodString>;
        publisher: z.ZodOptional<z.ZodString>;
        publishedDate: z.ZodOptional<z.ZodString>;
        identifier: z.ZodOptional<z.ZodString>;
        skippedChapterCount: z.ZodDefault<z.ZodNumber>;
        source: z.ZodLiteral<"epub-upload">;
        originalFileHash: z.ZodString;
        tags: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString>>>;
        addedAt: z.ZodString;
    }, z.core.$strip>;
    articles: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        revision: z.ZodNumber;
        lang: z.ZodString;
        provenance: z.ZodObject<{
            sourceUrl: z.ZodOptional<z.ZodString>;
            sourceAliases: z.ZodOptional<z.ZodArray<z.ZodString>>;
            title: z.ZodString;
            author: z.ZodOptional<z.ZodString>;
            publishedAt: z.ZodOptional<z.ZodString>;
            retrievedAt: z.ZodString;
            originalHtmlHash: z.ZodString;
            license: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
        blocks: z.ZodArray<z.ZodType<import("../content/schema").Block, unknown, z.core.$ZodTypeInternals<import("../content/schema").Block, unknown>>>;
        footnotes: z.ZodDefault<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            content: z.ZodArray<z.ZodObject<{
                text: z.ZodString;
                marks: z.ZodDefault<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                    type: z.ZodLiteral<"link">;
                    href: z.ZodString;
                    title: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>, z.ZodObject<{
                    type: z.ZodLiteral<"code">;
                }, z.core.$strip>, z.ZodObject<{
                    type: z.ZodLiteral<"strong">;
                }, z.core.$strip>, z.ZodObject<{
                    type: z.ZodLiteral<"em">;
                }, z.core.$strip>, z.ZodObject<{
                    type: z.ZodLiteral<"footnote-ref">;
                    footnoteId: z.ZodString;
                    occurrence: z.ZodDefault<z.ZodNumber>;
                }, z.core.$strip>]>>>;
            }, z.core.$strip>>;
            laterParagraphs: z.ZodOptional<z.ZodArray<z.ZodArray<z.ZodObject<{
                text: z.ZodString;
                marks: z.ZodDefault<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                    type: z.ZodLiteral<"link">;
                    href: z.ZodString;
                    title: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>, z.ZodObject<{
                    type: z.ZodLiteral<"code">;
                }, z.core.$strip>, z.ZodObject<{
                    type: z.ZodLiteral<"strong">;
                }, z.core.$strip>, z.ZodObject<{
                    type: z.ZodLiteral<"em">;
                }, z.core.$strip>, z.ZodObject<{
                    type: z.ZodLiteral<"footnote-ref">;
                    footnoteId: z.ZodString;
                    occurrence: z.ZodDefault<z.ZodNumber>;
                }, z.core.$strip>]>>>;
            }, z.core.$strip>>>>;
        }, z.core.$strip>>>;
        ingestionMeta: z.ZodOptional<z.ZodObject<{
            source: z.ZodEnum<{
                "epub-chapter": "epub-chapter";
                fixture: "fixture";
                "html-upload": "html-upload";
                markdown: "markdown";
                paste: "paste";
                pdf: "pdf";
                url: "url";
                youtube: "youtube";
            }>;
            origin: z.ZodOptional<z.ZodEnum<{
                paste: "paste";
                upload: "upload";
                url: "url";
            }>>;
            sourceUrl: z.ZodOptional<z.ZodString>;
            originalHtmlHash: z.ZodString;
            fetchedAt: z.ZodOptional<z.ZodString>;
            extractionConfidence: z.ZodEnum<{
                high: "high";
                low: "low";
            }>;
            extractionWarnings: z.ZodDefault<z.ZodArray<z.ZodString>>;
            annotationsDegraded: z.ZodOptional<z.ZodBoolean>;
            bookId: z.ZodOptional<z.ZodString>;
            chapterIndex: z.ZodOptional<z.ZodNumber>;
            transcript: z.ZodOptional<z.ZodObject<{
                videoId: z.ZodString;
                durationSeconds: z.ZodNumber;
                captionSource: z.ZodEnum<{
                    asr: "asr";
                    manual: "manual";
                    pasted: "pasted";
                }>;
                captionLanguage: z.ZodString;
                segments: z.ZodArray<z.ZodObject<{
                    blockIndex: z.ZodNumber;
                    startMs: z.ZodNumber;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        tags: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString>>>;
        readerTitle: z.ZodOptional<z.ZodString>;
        readerAuthor: z.ZodOptional<z.ZodString>;
        readerPublishedAt: z.ZodOptional<z.ZodString>;
        readerSourceUrl: z.ZodOptional<z.ZodString>;
        structure: z.ZodOptional<z.ZodObject<{
            schemaVersion: z.ZodLiteral<1>;
            generatorVersion: z.ZodNumber;
            revision: z.ZodNumber;
            corrections: z.ZodOptional<z.ZodString>;
            destinations: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                kind: z.ZodEnum<{
                    chapter: "chapter";
                    part: "part";
                }>;
                title: z.ZodString;
                titleSource: z.ZodEnum<{
                    generated: "generated";
                    heading: "heading";
                    publisher: "publisher";
                }>;
                parentChapterId: z.ZodOptional<z.ZodString>;
                startBlock: z.ZodNumber;
                endBlock: z.ZodNumber;
                startGrapheme: z.ZodOptional<z.ZodNumber>;
                endGrapheme: z.ZodOptional<z.ZodNumber>;
                startOffset: z.ZodNumber;
                endOffset: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        addedAt: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    skippedCount: z.ZodNumber;
    assets: z.ZodDefault<z.ZodArray<z.ZodObject<{
        assetId: z.ZodString;
        contentType: z.ZodEnum<{
            "image/avif": "image/avif";
            "image/gif": "image/gif";
            "image/jpeg": "image/jpeg";
            "image/png": "image/png";
            "image/webp": "image/webp";
        }>;
        byteLength: z.ZodNumber;
        dataBase64: z.ZodString;
    }, z.core.$strip>>>;
}, z.core.$strip>, z.ZodObject<{
    ok: z.ZodLiteral<true>;
    feed: z.ZodObject<{
        url: z.ZodString;
        title: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        items: z.ZodArray<z.ZodObject<{
            title: z.ZodString;
            link: z.ZodOptional<z.ZodString>;
            datePublished: z.ZodOptional<z.ZodString>;
            excerpt: z.ZodOptional<z.ZodString>;
            image: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    ok: z.ZodLiteral<false>;
    reason: z.ZodEnum<{
        "already-in-library": "already-in-library";
        "epub-empty": "epub-empty";
        "epub-protected": "epub-protected";
        "epub-too-large": "epub-too-large";
        "epub-unreadable": "epub-unreadable";
        "extraction-unsupported": "extraction-unsupported";
        "feed-unreadable": "feed-unreadable";
        "fetch-failed": "fetch-failed";
        "pdf-encrypted": "pdf-encrypted";
        "pdf-multi-column": "pdf-multi-column";
        "pdf-scanned": "pdf-scanned";
        "pdf-too-large": "pdf-too-large";
        "pdf-unreadable": "pdf-unreadable";
        "response-too-large": "response-too-large";
        "round-trip-anchor-failed": "round-trip-anchor-failed";
        "server-error": "server-error";
        "ssrf-blocked-metadata": "ssrf-blocked-metadata";
        "ssrf-blocked-private-ip": "ssrf-blocked-private-ip";
        "ssrf-blocked-scheme": "ssrf-blocked-scheme";
        "unsupported-content-type": "unsupported-content-type";
        "youtube-age-gated": "youtube-age-gated";
        "youtube-bot-check": "youtube-bot-check";
        "youtube-no-captions": "youtube-no-captions";
        "youtube-unavailable-private": "youtube-unavailable-private";
    }>;
}, z.core.$strip>]>;
export type IngestionResponse = z.infer<typeof IngestionResponseSchema>;
