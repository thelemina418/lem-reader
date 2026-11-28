import { z } from "zod";
/** http/https only — for figure sources and provenance sourceUrl (no mailto/data).
 * Exported so `src/ingestion/types.ts` can reuse the SAME refinement (single
 * source of truth for the URL-safety refinement — the Phase 7 ingestion
 * envelope imports this rather than re-declaring it inline). */
export declare const httpUrl: z.ZodString;
export declare const LinkMark: z.ZodObject<{
    type: z.ZodLiteral<"link">;
    href: z.ZodString;
    title: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const CodeMark: z.ZodObject<{
    type: z.ZodLiteral<"code">;
}, z.core.$strip>;
export declare const StrongMark: z.ZodObject<{
    type: z.ZodLiteral<"strong">;
}, z.core.$strip>;
export declare const EmMark: z.ZodObject<{
    type: z.ZodLiteral<"em">;
}, z.core.$strip>;
/** Spec #66 / issue #55 — the inline Footnote reference (the fifth member of
 * the locked mark set). The run's text is the publisher's marker ("1",
 * "[12]", "†") and stays in the D-05 stream; `footnoteId` names the note in
 * the controlled `fn-<n>` format (DOM-clobbering guard, Pitfall 4), and
 * `occurrence` (1-based, document order per note) gives each reference its
 * own controlled anchor identity — see src/content/footnoteReferences.ts. */
export declare const FootnoteRefMark: z.ZodObject<{
    type: z.ZodLiteral<"footnote-ref">;
    footnoteId: z.ZodString;
    occurrence: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export declare const Mark: z.ZodUnion<readonly [z.ZodObject<{
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
}, z.core.$strip>]>;
export declare const InlineRun: z.ZodObject<{
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
}, z.core.$strip>;
export declare const HeadingBlock: z.ZodObject<{
    kind: z.ZodLiteral<"heading">;
    level: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>, z.ZodLiteral<4>, z.ZodLiteral<5>, z.ZodLiteral<6>]>;
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
}, z.core.$strip>;
export declare const ParagraphBlock: z.ZodObject<{
    kind: z.ZodLiteral<"paragraph">;
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
}, z.core.$strip>;
export declare const BulletedListBlock: z.ZodObject<{
    kind: z.ZodLiteral<"bulleted-list">;
    items: z.ZodArray<z.ZodObject<{
        content: z.ZodArray<z.ZodType<Block, unknown, z.core.$ZodTypeInternals<Block, unknown>>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const NumberedListBlock: z.ZodObject<{
    kind: z.ZodLiteral<"numbered-list">;
    items: z.ZodArray<z.ZodObject<{
        content: z.ZodArray<z.ZodType<Block, unknown, z.core.$ZodTypeInternals<Block, unknown>>>;
    }, z.core.$strip>>;
    start: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
/** Phase 20 (D20-12) — the local-asset reference arm of FigureBlock.src.
 * `asset:img-<12 lowercase hex>`: the img- prefix is the D7-07 shortHash
 * locality precedent; the regex-locked shape means the union can never
 * smuggle a javascript:/data: URI through this arm (Pitfall 5 discipline
 * survives at parse time). Exported for the asset-id construction contract
 * (server/fetchImageAsset.ts) and renderer discrimination. */
export declare const assetRef: z.ZodString;
/** Phase 20 (20-RESEARCH Pattern 2) — the three figure states, all ONE block
 * kind (D20-06 — no new block kinds):
 *   - legacy row:  src = remote httpUrl (hydration-only; the renderer NEVER
 *     fetches it — IMG-03 for pre-v2.1 articles)
 *   - accepted:    src = asset:img-… (+ optional originalSrc/width/height)
 *   - refused:     src omitted (alt + caption render with the placeholder)
 * `width`/`height` are the D20-13 orientation-corrected intrinsic pixels the
 * pagination reserved box consumes; `originalSrc` is provenance/diagnostic
 * (D20-12) — where the bytes came from, never a fetch target. alt + caption
 * are byte-identical in every state (D-05 substrate; D19-01 caption marks). */
export declare const FigureBlock: z.ZodObject<{
    kind: z.ZodLiteral<"figure">;
    alt: z.ZodString;
    src: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodString]>>;
    originalSrc: z.ZodOptional<z.ZodString>;
    width: z.ZodOptional<z.ZodNumber>;
    height: z.ZodOptional<z.ZodNumber>;
    caption: z.ZodDefault<z.ZodArray<z.ZodObject<{
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
    }, z.core.$strip>>>;
}, z.core.$strip>;
export declare const CodeBlock: z.ZodObject<{
    kind: z.ZodLiteral<"code-block">;
    language: z.ZodOptional<z.ZodString>;
    source: z.ZodString;
}, z.core.$strip>;
export declare const FootnoteReferenceBlock: z.ZodObject<{
    kind: z.ZodLiteral<"footnote-reference">;
    footnoteId: z.ZodString;
    marker: z.ZodString;
}, z.core.$strip>;
export declare const UnsupportedBlock: z.ZodObject<{
    kind: z.ZodLiteral<"unsupported">;
    originalKind: z.ZodString;
    plainDescription: z.ZodString;
}, z.core.$strip>;
type HeadingT = z.infer<typeof HeadingBlock>;
type ParagraphT = z.infer<typeof ParagraphBlock>;
type FigureT = z.infer<typeof FigureBlock>;
type CodeT = z.infer<typeof CodeBlock>;
type FootnoteRefT = z.infer<typeof FootnoteReferenceBlock>;
type UnsupportedT = z.infer<typeof UnsupportedBlock>;
export declare const BlockquoteBlock: z.ZodObject<{
    kind: z.ZodLiteral<"blockquote">;
    children: z.ZodArray<z.ZodType<Block, unknown, z.core.$ZodTypeInternals<Block, unknown>>>;
}, z.core.$strip>;
export type Block = HeadingT | ParagraphT | {
    kind: "blockquote";
    children: Block[];
} | {
    kind: "bulleted-list";
    items: {
        content: Block[];
    }[];
} | {
    kind: "numbered-list";
    items: {
        content: Block[];
    }[];
    start: number;
} | FigureT | CodeT | FootnoteRefT | UnsupportedT;
export declare const BlockSchema: z.ZodType<Block>;
export declare const FootnoteBody: z.ZodObject<{
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
}, z.core.$strip>;
export declare const WORK_STRUCTURE_SCHEMA_VERSION = 1;
export declare const StructureDestinationSchema: z.ZodObject<{
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
}, z.core.$strip>;
export type StructureDestination = z.infer<typeof StructureDestinationSchema>;
export declare const WorkStructureSchema: z.ZodObject<{
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
}, z.core.$strip>;
export type WorkStructure = z.infer<typeof WorkStructureSchema>;
export declare const Provenance: z.ZodObject<{
    sourceUrl: z.ZodOptional<z.ZodString>;
    sourceAliases: z.ZodOptional<z.ZodArray<z.ZodString>>;
    title: z.ZodString;
    author: z.ZodOptional<z.ZodString>;
    publishedAt: z.ZodOptional<z.ZodString>;
    retrievedAt: z.ZodString;
    originalHtmlHash: z.ZodString;
    license: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** ArticleSourceSchema — D7-08 + D8-15 + D8-16 origin discriminator. The enum
 * is CLOSED; future phases widen it additively ("pdf" Phase 11, "epub-chapter"
 * Phase 12). Phase 8 adds "markdown" (D8-16 — `.md` upload via
 * markdownToBlocks) and "html-upload" (D8-15 — `.html` file-upload reuses the
 * paste path but carries a distinct badge per D8-02). Both widenings are
 * anticipated by ARCHITECTURE.md L390 and are forward-compatible. */
export declare const ArticleSourceSchema: z.ZodEnum<{
    "epub-chapter": "epub-chapter";
    fixture: "fixture";
    "html-upload": "html-upload";
    markdown: "markdown";
    paste: "paste";
    pdf: "pdf";
    url: "url";
    youtube: "youtube";
}>;
export type ArticleSource = z.infer<typeof ArticleSourceSchema>;
/** YOUTUBE_VIDEO_ID_REGEX — the canonical 11-character YouTube video id
 * alphabet (A-Za-z0-9_-). Lives HERE (not in src/ingestion/youtube.ts, which
 * re-exports it) because TranscriptMetaSchema below validates videoId with it
 * and the /src→ingestion import direction is forbidden — ingestion imports
 * content, never the reverse (the httpUrl single-source-of-truth precedent
 * above). Server/youtubeTranscript.ts keeps consuming it via the re-export. */
export declare const YOUTUBE_VIDEO_ID_REGEX: RegExp;
/** BCP47_LANGUAGE_TAG_REGEX — a pragmatic BCP-47 language-tag shape:
 * language subtag (2-3 alpha), optional script (4 alpha), optional region
 * (2 alpha or 3 digits — "en", "pt-BR", "zh-Hans", "zh-Hant-TW", "es-419"),
 * optional variant subtags (5-8 alphanumerics). Deliberately NOT the full
 * RFC 5646 grammar (grandfathered and private-use primary subtags excluded)
 * — the boundary's job is refusing junk strings, not certifying compliance.
 * Decision #26: captionLanguage carries the chosen track's FULL code here,
 * so it is validated as a language tag, not merely min(1). */
export declare const BCP47_LANGUAGE_TAG_REGEX: RegExp;
/** TranscriptSegmentAnchorSchema — ONE block-keyed timestamp: `blockIndex`
 * indexes the article's persisted `blocks` array (stable per revision — the
 * same stability the pagination annotations depend on; any future change that
 * re-derives blocks must re-derive `segments` with them), `startMs` is the
 * block's start time. START-only granularity (decision #26): a block's end
 * time is derivable from the next mapped block's start (the last ends at
 * `durationSeconds`). Timestamps are metadata — NEVER rendered, never part of
 * normalizeText — so selectors, highlights, and reading position are
 * untouched. */
export declare const TranscriptSegmentAnchorSchema: z.ZodObject<{
    blockIndex: z.ZodNumber;
    startMs: z.ZodNumber;
}, z.core.$strip>;
export type TranscriptSegmentAnchor = z.infer<typeof TranscriptSegmentAnchorSchema>;
/** TranscriptMetaSchema — the cohesive optional `ingestionMeta.transcript`
 * object (decision #26). Block-keyed metadata on the additive bag, NOT new
 * block fields: the block unions stay untouched (D20-06 — no new block
 * kinds). `captionSource` distinguishes human tracks from auto-generated ASR
 * (which forces `extractionConfidence: "low"` — never a silent upgrade to
 * trusted); "pasted" marks a transcript the reader pasted manually (the
 * youtube-bot-check fallback) — it ALSO forces "low" (unverified provenance).
 * `captionLanguage` is the chosen track's full BCP-47 code (the article's
 * `lang` carries its base language); "und" is the honest value when the
 * paste's language is unknowable. Nothing here is Dexie-indexed — the
 * bookId/chapterIndex additive precedent (no schema bump). */
export declare const TranscriptMetaSchema: z.ZodObject<{
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
}, z.core.$strip>;
export type TranscriptMeta = z.infer<typeof TranscriptMetaSchema>;
/** IngestionMetaSchema — derived per-article metadata written at ingest time.
 * Shape per 07-RESEARCH.md §IngestionMeta/ArticleSource Schema L566-574.
 * `extractionConfidence` is two-state "high" | "low" (ADR-0003): readable
 * text is never refused — thin/imperfect extraction admits flagged "low";
 * the only content-based web refusal left is ZERO extracted blocks (the
 * client sees that as the failure envelope reason `extraction-unsupported`). */
export declare const IngestionMetaSchema: z.ZodObject<{
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
}, z.core.$strip>;
export type IngestionMeta = z.infer<typeof IngestionMetaSchema>;
export declare const ArticleSchema: z.ZodObject<{
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
    blocks: z.ZodArray<z.ZodType<Block, unknown, z.core.$ZodTypeInternals<Block, unknown>>>;
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
export type CanonicalArticle = z.infer<typeof ArticleSchema>;
export type InlineRun = z.infer<typeof InlineRun>;
/** BookSchema — the thin book record grouping epub-chapter articles
 * (ARCHITECTURE Pattern 4; shape per 12-RESEARCH.md L565-577 lifted verbatim
 * PLUS two planner additions the sketch omitted: `tags` (D12-04 — tags live
 * on the Book record, mirroring the ArticleSchema.tags Phase 8 mechanism)
 * and `addedAt` (library default-sort + continue-strip ordering)).
 * `chapterArticleIds` is ORDERED — the book's own TOC per D12-06: "Chapter
 * N of M" numbering runs over this list, and `skippedChapterCount` is
 * disclosed additively (D12-11) rather than renumbering it. `source` is the
 * literal "epub-upload" (the only book-producing source in Phase 12). */
export declare const BookSchema: z.ZodObject<{
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
export type Book = z.infer<typeof BookSchema>;
export declare const COLLECTION_SCHEMA_VERSION = 1;
/** The WORK_STRUCTURE destination-id grammar restricted to CHAPTERS —
 * `ch-<startBlock>.<b|grapheme>`. Generated reading parts carry `pt-*` ids
 * (StructureDestinationSchema) and are deliberately UNREPRESENTABLE here:
 * generated parts are not collection targets (issue #244 AC), so a part id
 * fails the shape itself (`invalid-target`), before any library lookup. */
export declare const WORK_CHAPTER_DESTINATION_ID_REGEX: RegExp;
/** Where one collection entry points: a whole standalone article, a whole
 * book/works (the issue #242 slice), or a particular chapter (issue #244 —
 * an existing EPUB chapter article, or a chapter destination of a saved
 * web work's structure). The id charsets match the validated record
 * grammars (article/book ids `^[a-z0-9-]+$`; destination ids the
 * StructureDestinationSchema rule restricted to chapters), so a record id
 * from any side of the library parses unchanged. */
export declare const CollectionEntryTargetSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"article">;
    articleId: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"book">;
    bookId: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"book-chapter">;
    bookId: z.ZodString;
    articleId: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"work-chapter">;
    articleId: z.ZodString;
    destinationId: z.ZodString;
}, z.core.$strip>], "kind">;
export type CollectionEntryTarget = z.infer<typeof CollectionEntryTargetSchema>;
/** One place in a collection's order. `id` is the STABLE entry identity
 * (crypto.randomUUID) — later slices (#243 reorder/remove, #247 continue)
 * address entries by it, never by array position alone. */
export declare const CollectionEntrySchema: z.ZodObject<{
    id: z.ZodString;
    target: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"article">;
        articleId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"book">;
        bookId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"book-chapter">;
        bookId: z.ZodString;
        articleId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"work-chapter">;
        articleId: z.ZodString;
        destinationId: z.ZodString;
    }, z.core.$strip>], "kind">;
    addedAt: z.ZodString;
}, z.core.$strip>;
export type CollectionEntry = z.infer<typeof CollectionEntrySchema>;
/** The whole collection record. `name` is min(1) AFTER the store seam trims
 * (an unnamed collection is unrepresentable — the readerTitle min(1)
 * discipline). `entries` is the ordered arrangement; array order IS the
 * collection order. `updatedAt` drives the collections-list recency sort. */
export declare const CollectionSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodString;
    name: z.ZodString;
    entries: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        target: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"article">;
            articleId: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"book">;
            bookId: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"book-chapter">;
            bookId: z.ZodString;
            articleId: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"work-chapter">;
            articleId: z.ZodString;
            destinationId: z.ZodString;
        }, z.core.$strip>], "kind">;
        addedAt: z.ZodString;
    }, z.core.$strip>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type Collection = z.infer<typeof CollectionSchema>;
export declare const COMPLETION_SCHEMA_VERSION = 1;
/** Where a completion record's truth came from. "reading" — a valid
 * chapter-reading transition observed by the reader (traversing past a
 * chapter's end, finishing a chapter assignment by page, scroll, or ear);
 * "reader" — the explicit finished/unfinished correction control. The
 * source rides the row for honesty (a correction and a traversal are
 * different assertions) — no behavior branches on it today. */
export declare const CompletionRecordSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    targetKey: z.ZodString;
    target: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"article">;
        articleId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"book">;
        bookId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"book-chapter">;
        bookId: z.ZodString;
        articleId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"work-chapter">;
        articleId: z.ZodString;
        destinationId: z.ZodString;
    }, z.core.$strip>], "kind">;
    finished: z.ZodBoolean;
    source: z.ZodEnum<{
        reader: "reader";
        reading: "reading";
    }>;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type CompletionRecord = z.infer<typeof CompletionRecordSchema>;
export declare const COLLECTION_ACTIVE_ENTRY_SCHEMA_VERSION = 1;
export declare const CollectionActiveEntrySchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    collectionId: z.ZodString;
    entryId: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type CollectionActiveEntry = z.infer<typeof CollectionActiveEntrySchema>;
declare const CustomThemeRecordSchema: z.ZodObject<{
    baseTheme: z.ZodEnum<{
        dark: "dark";
        light: "light";
        sepia: "sepia";
    }>;
    tokens: z.ZodObject<{
        surface: z.ZodString;
        surfaceRaised: z.ZodString;
        ink: z.ZodString;
        accent: z.ZodString;
        hairline: z.ZodString;
        board: z.ZodOptional<z.ZodString>;
        boardText: z.ZodOptional<z.ZodString>;
        lit: z.ZodOptional<z.ZodString>;
        brass: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>;
/** The named highlight-color vocabulary (issue #118): the Default fill plus
 * exactly four named colors. The closed set is the single source of truth —
 * the Zod enum below, the UI picker, the CSS tokens, and the custom-theme
 * derivation all key off these literal ids. */
export declare const HIGHLIGHT_COLOR_NAMES: readonly ["default", "yellow", "green", "blue", "pink"];
export type HighlightColor = (typeof HIGHLIGHT_COLOR_NAMES)[number];
export declare const HighlightColorSchema: z.ZodEnum<{
    blue: "blue";
    default: "default";
    green: "green";
    pink: "pink";
    yellow: "yellow";
}>;
/** Issue #41 (ADR 0012) — the slot list's bounds: an ordered list of one to
 * ten slots. The schema's `.min/.max` contract, the editor's Add/Remove
 * availability, and the digit vocabulary (1–9, then 0 for slot 10) all read
 * these ONE constants. */
export declare const MIN_HIGHLIGHT_SLOTS = 1;
export declare const MAX_HIGHLIGHT_SLOTS = 10;
/** Issue #41 — the identities the shipped five slots carry, and the
 * identities the pre-parse migration gives a legacy (id-less) row's slots,
 * by position. Deterministic so a migrated row is byte-stable across every
 * settings-entry seam (store, mirror, import); slots the reader ADDS mint
 * random identities (newSlotId in src/annotations/highlightSlots.ts) in a
 * different spelling, so the two can never collide. */
export declare function legacySlotId(index: number): string;
/** One numbered highlight slot: an editable short name, ONE existing color
 * choice, and zero or more highlight tags. Stored on ReaderSettings — a
 * reusable preset, never a live relation to historical highlights.
 * Issue #196 — the color choice widens from the closed named set to an
 * ARBITRARY color: `customColor` (strict 6-digit sRGB hex — the same grammar
 * the custom-theme tokens enforce) carries the reader-chosen color beside
 * the named `color` fallback. Additive optional (Pitfall 9): records without
 * the field parse unchanged. Rendering derives the readable tint from
 * `customColor` + the ACTIVE theme; `color` stays the closed-set fallback
 * (older clients and the named picker still speak it).
 * Issue #222 (ADR 0008, amended) — the hex becomes a DORMANT memory:
 * `customColorActive` says which source the slot's color choice IS right
 * now — `true` + hex = Custom active; `false` + hex = a named fill active
 * with the hex RETAINED (dormant until Custom is chosen again, which
 * reactivates the remembered hex instead of re-seeding). `true` without a
 * hex is unrepresentable — the superRefine below polices it into the
 * honest corrupt routing. The field is REQUIRED (no hydration default) so
 * a written v8 row round-trips byte-stably through every parse (a hydrated
 * default would mint a key absent rows never wrote). A pre-#222 row (no
 * key) is mapped pre-parse at every settings-entry seam by
 * migrateReaderSettings (existing customColor ⇒ true, else false). */
export declare const HighlightSlotSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    color: z.ZodEnum<{
        blue: "blue";
        default: "default";
        green: "green";
        pink: "pink";
        yellow: "yellow";
    }>;
    customColor: z.ZodOptional<z.ZodString>;
    customColorActive: z.ZodBoolean;
    tags: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export type HighlightSlot = z.infer<typeof HighlightSlotSchema>;
/**
 * The shipped slot set (issue #195): Default/Yellow/Green/Blue/Pink with
 * empty tags — the exact five choices the color picker has always offered,
 * numbered 1–5. Returns a FRESH deep copy per call: the schema's hydration
 * default and DEFAULT_SETTINGS both use it, so no parse output ever shares
 * an array or slot object with another settings record.
 */
export declare function defaultHighlightSlots(): HighlightSlot[];
export declare const ReaderSettingsSchema: z.ZodObject<{
    schemaVersion: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>, z.ZodLiteral<4>, z.ZodLiteral<5>, z.ZodLiteral<6>, z.ZodLiteral<7>, z.ZodLiteral<8>, z.ZodLiteral<9>]>;
    font: z.ZodEnum<{
        dyslexic: "dyslexic";
        sans: "sans";
        serif: "serif";
    }>;
    size: z.ZodUnion<readonly [z.ZodLiteral<16>, z.ZodLiteral<18>, z.ZodLiteral<20>, z.ZodLiteral<22>, z.ZodLiteral<24>]>;
    measure: z.ZodUnion<readonly [z.ZodLiteral<40>, z.ZodLiteral<46>, z.ZodLiteral<52>, z.ZodLiteral<58>, z.ZodLiteral<64>, z.ZodLiteral<70>, z.ZodLiteral<76>, z.ZodLiteral<82>, z.ZodLiteral<88>]>;
    spacing: z.ZodEnum<{
        comfortable: "comfortable";
        compact: "compact";
        spacious: "spacious";
    }>;
    theme: z.ZodEnum<{
        "bi-dark": "bi-dark";
        "custom-dark": "custom-dark";
        "custom-light": "custom-light";
        dark: "dark";
        light: "light";
        "marxism-dark": "marxism-dark";
        "marxism-light": "marxism-light";
        sepia: "sepia";
        "trans-light": "trans-light";
    }>;
    customLightTheme: z.ZodOptional<z.ZodObject<{
        baseTheme: z.ZodEnum<{
            dark: "dark";
            light: "light";
            sepia: "sepia";
        }>;
        tokens: z.ZodObject<{
            surface: z.ZodString;
            surfaceRaised: z.ZodString;
            ink: z.ZodString;
            accent: z.ZodString;
            hairline: z.ZodString;
            board: z.ZodOptional<z.ZodString>;
            boardText: z.ZodOptional<z.ZodString>;
            lit: z.ZodOptional<z.ZodString>;
            brass: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    customDarkTheme: z.ZodOptional<z.ZodObject<{
        baseTheme: z.ZodEnum<{
            dark: "dark";
            light: "light";
            sepia: "sepia";
        }>;
        tokens: z.ZodObject<{
            surface: z.ZodString;
            surfaceRaised: z.ZodString;
            ink: z.ZodString;
            accent: z.ZodString;
            hairline: z.ZodString;
            board: z.ZodOptional<z.ZodString>;
            boardText: z.ZodOptional<z.ZodString>;
            lit: z.ZodOptional<z.ZodString>;
            brass: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    animatePageTurns: z.ZodOptional<z.ZodBoolean>;
    readingMode: z.ZodDefault<z.ZodEnum<{
        paginated: "paginated";
        scrolling: "scrolling";
    }>>;
    showReadAloud: z.ZodDefault<z.ZodBoolean>;
    speechNoticeDismissed: z.ZodDefault<z.ZodBoolean>;
    voice: z.ZodOptional<z.ZodString>;
    rate: z.ZodDefault<z.ZodNumber>;
    librarySort: z.ZodDefault<z.ZodEnum<{
        "recently-added": "recently-added";
        "recently-opened": "recently-opened";
        title: "title";
    }>>;
    openAfterAdd: z.ZodDefault<z.ZodBoolean>;
    highlightSlots: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        color: z.ZodEnum<{
            blue: "blue";
            default: "default";
            green: "green";
            pink: "pink";
            yellow: "yellow";
        }>;
        customColor: z.ZodOptional<z.ZodString>;
        customColorActive: z.ZodBoolean;
        tags: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>>;
    defaultHighlightSlotId: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export type ReaderSettings = z.infer<typeof ReaderSettingsSchema>;
/** The two independently saved custom slots (issue #120). */
export type CustomThemeSlot = "custom-light" | "custom-dark";
export type CustomTheme = z.infer<typeof CustomThemeRecordSchema>;
export type CustomThemeTokens = CustomTheme["tokens"];
export declare const LocationRecordSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    articleId: z.ZodString;
    revision: z.ZodNumber;
    graphemeOffset: z.ZodNumber;
    savedAt: z.ZodString;
    corrections: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type LocationRecord = z.infer<typeof LocationRecordSchema>;
/** Grapheme offset range into normalizeText(article); start inclusive, end exclusive.
 * Mirrors the TextPositionSelector interface at normalizeText.ts L117-120. */
export declare const TextPositionSelectorSchema: z.ZodObject<{
    start: z.ZodNumber;
    end: z.ZodNumber;
}, z.core.$strip>;
/** A TextQuote selector over the normalized grapheme text (prefix/exact/suffix).
 * Mirrors the TextQuoteSelector interface at normalizeText.ts L123-127. */
export declare const TextQuoteSelectorSchema: z.ZodObject<{
    prefix: z.ZodString;
    exact: z.ZodString;
    suffix: z.ZodString;
}, z.core.$strip>;
/** HighlightRecord — one durable highlight (D5-03 dual-selector persistence).
 * schemaVersion for STATE-04 migration; id is crypto.randomUUID() at the call
 * site (05-RESEARCH.md Open Question #2 — no collision with fn-N footnote ids). */
export declare const HighlightRecordSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodString;
    articleId: z.ZodString;
    revision: z.ZodNumber;
    corrections: z.ZodOptional<z.ZodString>;
    position: z.ZodObject<{
        start: z.ZodNumber;
        end: z.ZodNumber;
    }, z.core.$strip>;
    quote: z.ZodObject<{
        prefix: z.ZodString;
        exact: z.ZodString;
        suffix: z.ZodString;
    }, z.core.$strip>;
    createdAt: z.ZodString;
    tags: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString>>>;
    color: z.ZodDefault<z.ZodEnum<{
        blue: "blue";
        default: "default";
        green: "green";
        pink: "pink";
        yellow: "yellow";
    }>>;
    customColor: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type HighlightRecord = z.infer<typeof HighlightRecordSchema>;
export declare const CORRECTIONS_SCHEMA_VERSION = 1;
export declare const CorrectableBlockKindSchema: z.ZodEnum<{
    blockquote: "blockquote";
    "bulleted-list": "bulleted-list";
    "code-block": "code-block";
    figure: "figure";
    "footnote-reference": "footnote-reference";
    heading: "heading";
    "numbered-list": "numbered-list";
    paragraph: "paragraph";
    unsupported: "unsupported";
}>;
/** A whole block, found by its text: `quote.exact` is the block's entire
 * normalized text, `kind` and `depth` (0 = top level, 1 = inside one
 * quotation, …) tell apart blocks that share a range (a quotation and its
 * only paragraph). */
export declare const BlockTargetSchema: z.ZodObject<{
    quote: z.ZodObject<{
        prefix: z.ZodString;
        exact: z.ZodString;
        suffix: z.ZodString;
    }, z.core.$strip>;
    kind: z.ZodEnum<{
        blockquote: "blockquote";
        "bulleted-list": "bulleted-list";
        "code-block": "code-block";
        figure: "figure";
        "footnote-reference": "footnote-reference";
        heading: "heading";
        "numbered-list": "numbered-list";
        paragraph: "paragraph";
        unsupported: "unsupported";
    }>;
    depth: z.ZodNumber;
}, z.core.$strip>;
export type BlockTarget = z.infer<typeof BlockTargetSchema>;
export declare const HideCorrectionSchema: z.ZodObject<{
    id: z.ZodString;
    createdAt: z.ZodString;
    kind: z.ZodLiteral<"hide">;
    target: z.ZodObject<{
        quote: z.ZodObject<{
            prefix: z.ZodString;
            exact: z.ZodString;
            suffix: z.ZodString;
        }, z.core.$strip>;
        kind: z.ZodEnum<{
            blockquote: "blockquote";
            "bulleted-list": "bulleted-list";
            "code-block": "code-block";
            figure: "figure";
            "footnote-reference": "footnote-reference";
            heading: "heading";
            "numbered-list": "numbered-list";
            paragraph: "paragraph";
            unsupported: "unsupported";
        }>;
        depth: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const UnhideCorrectionSchema: z.ZodObject<{
    id: z.ZodString;
    createdAt: z.ZodString;
    kind: z.ZodLiteral<"unhide">;
    target: z.ZodObject<{
        quote: z.ZodObject<{
            prefix: z.ZodString;
            exact: z.ZodString;
            suffix: z.ZodString;
        }, z.core.$strip>;
        kind: z.ZodEnum<{
            blockquote: "blockquote";
            "bulleted-list": "bulleted-list";
            "code-block": "code-block";
            figure: "figure";
            "footnote-reference": "footnote-reference";
            heading: "heading";
            "numbered-list": "numbered-list";
            paragraph: "paragraph";
            unsupported: "unsupported";
        }>;
        depth: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const CorrectionSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    id: z.ZodString;
    createdAt: z.ZodString;
    kind: z.ZodLiteral<"hide">;
    target: z.ZodObject<{
        quote: z.ZodObject<{
            prefix: z.ZodString;
            exact: z.ZodString;
            suffix: z.ZodString;
        }, z.core.$strip>;
        kind: z.ZodEnum<{
            blockquote: "blockquote";
            "bulleted-list": "bulleted-list";
            "code-block": "code-block";
            figure: "figure";
            "footnote-reference": "footnote-reference";
            heading: "heading";
            "numbered-list": "numbered-list";
            paragraph: "paragraph";
            unsupported: "unsupported";
        }>;
        depth: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    id: z.ZodString;
    createdAt: z.ZodString;
    kind: z.ZodLiteral<"unhide">;
    target: z.ZodObject<{
        quote: z.ZodObject<{
            prefix: z.ZodString;
            exact: z.ZodString;
            suffix: z.ZodString;
        }, z.core.$strip>;
        kind: z.ZodEnum<{
            blockquote: "blockquote";
            "bulleted-list": "bulleted-list";
            "code-block": "code-block";
            figure: "figure";
            "footnote-reference": "footnote-reference";
            heading: "heading";
            "numbered-list": "numbered-list";
            paragraph: "paragraph";
            unsupported: "unsupported";
        }>;
        depth: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strip>], "kind">;
export type Correction = z.infer<typeof CorrectionSchema>;
export declare const CorrectionsRecordSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    articleId: z.ZodString;
    corrections: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        id: z.ZodString;
        createdAt: z.ZodString;
        kind: z.ZodLiteral<"hide">;
        target: z.ZodObject<{
            quote: z.ZodObject<{
                prefix: z.ZodString;
                exact: z.ZodString;
                suffix: z.ZodString;
            }, z.core.$strip>;
            kind: z.ZodEnum<{
                blockquote: "blockquote";
                "bulleted-list": "bulleted-list";
                "code-block": "code-block";
                figure: "figure";
                "footnote-reference": "footnote-reference";
                heading: "heading";
                "numbered-list": "numbered-list";
                paragraph: "paragraph";
                unsupported: "unsupported";
            }>;
            depth: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
        createdAt: z.ZodString;
        kind: z.ZodLiteral<"unhide">;
        target: z.ZodObject<{
            quote: z.ZodObject<{
                prefix: z.ZodString;
                exact: z.ZodString;
                suffix: z.ZodString;
            }, z.core.$strip>;
            kind: z.ZodEnum<{
                blockquote: "blockquote";
                "bulleted-list": "bulleted-list";
                "code-block": "code-block";
                figure: "figure";
                "footnote-reference": "footnote-reference";
                heading: "heading";
                "numbered-list": "numbered-list";
                paragraph: "paragraph";
                unsupported: "unsupported";
            }>;
            depth: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>], "kind">>;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type CorrectionsRecord = z.infer<typeof CorrectionsRecordSchema>;
/** NoteRecord — one note attached to a highlight (1:1 via highlightId).
 * text is z.string() (NEVER HTML — Pitfall 8). Empty string = no note
 * (the caller deletes or never creates the NoteRecord per D5-10). */
export declare const NoteRecordSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodString;
    highlightId: z.ZodString;
    text: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type NoteRecord = z.infer<typeof NoteRecordSchema>;
/** ArticleNote — issue #206: one independent reflection attached to an
 * ARTICLE (not to a highlighted passage). Multiple notes per article; each
 * editable and deletable. Deliberately NO highlightId, position, or quote
 * selector — an article note never synthesizes a passage attachment (the
 * parent spec's locked decision), so the schema has no such field and
 * z.object strips any bundle-supplied key. Lives HERE next to the other
 * record schemas (the STATE-04 trust boundary shared by the Dexie store
 * AND the export bundle — the SubscriptionRecordSchema precedent); the
 * store re-exports it so its call sites stay one-hop.
 *
 * Issue #209 — `tags` is the note's OWN zero-or-more annotation tags,
 * separate from article tags and from every other annotation's. Additive
 * with the exact highlight-record discipline (issue #116): rows written
 * before the field omit it and hydrate to [] via `.default([])`; the field
 * stays type-optional so in-memory values built before the hydration point
 * may omit the key (consumers read `?? []`). Plain non-indexed row fields —
 * no Dexie version bump (the tags precedent).
 *
 * Issue #211 — the record rides the v8 export bundle: identity (id),
 * created/updated timestamps, plain text, tags, and the articleId
 * association must all survive export → import verbatim. */
export declare const ArticleNoteSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodString;
    articleId: z.ZodString;
    text: z.ZodString;
    tags: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString>>>;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strip>;
export type ArticleNote = z.infer<typeof ArticleNoteSchema>;
/** NoteDraftRecord — issue #178: the LOCAL-ONLY recovery draft for a note
 * edit whose save has not landed yet (the write-through mirror of the
 * annotation state hook's in-memory pending draft, so tab closure cannot
 * depend on a browser unload event). Keyed by highlightId — the recovery
 * scope is exactly the original highlight; a draft never attaches to
 * another one. text is z.string() (NEVER HTML — Pitfall 8). updatedAt is
 * the staleness key: a landed note write newer than the draft (e.g. an
 * edit from the cross-library review panel) retires the draft at restore
 * instead of resurrecting older writing over newer.
 *
 * Deliberately OUTSIDE the versioned export bundle: recovery is local-first
 * device state (like the settings mirror), so the bundle schema, the
 * manifest blocks, and the import merge are untouched. */
export declare const NoteDraftRecordSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    highlightId: z.ZodString;
    text: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type NoteDraftRecord = z.infer<typeof NoteDraftRecordSchema>;
export declare const ReadingSessionRecordSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodString;
    articleId: z.ZodString;
    startedAt: z.ZodString;
    endedAt: z.ZodString;
    startOffset: z.ZodNumber;
    endOffset: z.ZodNumber;
    activeSeconds: z.ZodNumber;
}, z.core.$strip>;
export type ReadingSessionRecord = z.infer<typeof ReadingSessionRecordSchema>;
/** MAX_FEED_ITEMS — the bounded recent-preview count per subscription. The
 * Discover surface shows recent items, not an archive; 30 covers every real
 * feed's visible window with headroom while bounding the persisted row. */
export declare const MAX_FEED_ITEMS = 30;
/** MAX_FEED_TEXT_CHARS — the per-field text cap for feed titles,
 * descriptions, and excerpts (and each preview's title/excerpt). Feeds
 * routinely embed full article HTML in description/content; the excerpt is
 * a PREVIEW, bounded here and truncated server-side at parse time. */
export declare const MAX_FEED_TEXT_CHARS = 2048;
/** FeedItemPreview — ONE bounded recent-item preview. Every field is
 * optional-but-title except the URLs, which are httpUrl-refined (the SAME
 * refinement as provenance sourceUrl — a `javascript:` or `data:` link
 * never reaches a rendered anchor). The server supplies datePublished ONLY
 * when it parses as a real date (ISO-8601; "date when supplied" — honesty). */
export declare const FeedItemPreviewSchema: z.ZodObject<{
    title: z.ZodString;
    link: z.ZodOptional<z.ZodString>;
    datePublished: z.ZodOptional<z.ZodString>;
    excerpt: z.ZodOptional<z.ZodString>;
    image: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type FeedItemPreview = z.infer<typeof FeedItemPreviewSchema>;
/** SubscriptionRecord — one saved feed subscription + its local preview
 * cache. `feedUrl` is the NORMALIZED validated feed URL (lowercased
 * scheme/host, default port dropped, fragment dropped — the import merge
 * key); `subscribedAt` is the save-time stamp; `items` is the bounded cache
 * captured at subscribe time and replaced only by an explicit refresh
 * (issue #123). `lastFetchedAt` is the LAST SUCCESSFUL fetch stamp (set at
 * subscribe — subscribe itself fetches — and advanced only when a refresh
 * both returns and persists; a failed refresh never touches it, so the
 * stale state can show the honest last-known-good time). Additive-optional
 * (issue #123): pre-#123 rows and v1..v6 bundles parse unchanged (the
 * readerTitle mechanism — a non-indexed additive field needs no Dexie
 * version bump). */
export declare const SubscriptionRecordSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodString;
    feedUrl: z.ZodString;
    title: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    items: z.ZodArray<z.ZodObject<{
        title: z.ZodString;
        link: z.ZodOptional<z.ZodString>;
        datePublished: z.ZodOptional<z.ZodString>;
        excerpt: z.ZodOptional<z.ZodString>;
        image: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    subscribedAt: z.ZodString;
    lastFetchedAt: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type SubscriptionRecord = z.infer<typeof SubscriptionRecordSchema>;
export {};
