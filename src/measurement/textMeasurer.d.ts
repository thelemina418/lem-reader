import type { ReaderSettings } from "../content/schema";
export declare const HEADING_GEOMETRY: {
    readonly 1: {
        readonly sizePx: 32;
        readonly lineHeight: 1.2;
        readonly weight: 600;
    };
    readonly 2: {
        readonly sizePx: 22;
        readonly lineHeight: 1.3;
        readonly weight: 600;
    };
    readonly 3: {
        readonly sizePx: 22;
        readonly lineHeight: 1.3;
        readonly weight: 600;
    };
    readonly 4: {
        readonly sizePx: 22;
        readonly lineHeight: 1.3;
        readonly weight: 600;
    };
    readonly 5: {
        readonly sizePx: 22;
        readonly lineHeight: 1.3;
        readonly weight: 600;
    };
    readonly 6: {
        readonly sizePx: 22;
        readonly lineHeight: 1.3;
        readonly weight: 600;
    };
};
/** Canvas font shorthand inputs needed for measurement. */
export interface FontGeometry {
    /** Canvas font shorthand string, e.g. "400 18px Georgia, serif". */
    font: string;
    /** Resolved line-height in pixels (size × lineHeight-multiplier). */
    lineHeightPx: number;
}
/**
 * Derive the canvas `font` shorthand + lineHeight PER KIND. Paragraphs use
 * body geometry derived from `settings.size` + the active spacing preset's
 * lineHeight multiplier; headings use the HARDCODED HEADING_GEOMETRY
 * (Pitfall 7). The font family still tracks `settings.font` so the reader's
 * chosen family is measured.
 *
 * @param kind "paragraph" or "heading"
 * @param level heading level 1–6 (ignored for paragraphs)
 * @param settings the active ReaderSettings (font family + body size + spacing)
 */
export declare function fontStringFor(kind: "paragraph" | "heading", level: 1 | 2 | 3 | 4 | 5 | 6, settings: ReaderSettings): FontGeometry;
/** Args shared by both measurement functions. */
export interface MeasureArgs {
    text: string;
    /** Canvas font shorthand (from `fontStringFor`). */
    font: string;
    /** Letter spacing in pixels (from the spacing preset's letterSpacing CSS). */
    letterSpacingPx: number;
    /** Line height in pixels (from `fontStringFor`). */
    lineHeightPx: number;
    /** Content-box max width in pixels (the rendered block's inline-size). */
    maxWidthPx: number;
}
/**
 * Measure a paragraph-like block: predicted height + line count.
 *
 * Calls `prepare(text, font, { letterSpacing })` once (canvas measurement +
 * segment-width cache), then `layout(prepared, maxWidthPx, lineHeightPx)`.
 * `layout` is PURE ARITHMETIC over cached widths — no reflow — so re-layout
 * at a new width is cheap. Do NOT re-prepare for the same text+font pair
 * (RESEARCH §Code Examples L466–469).
 */
export declare function measureParagraphHeight(args: MeasureArgs): {
    height: number;
    lineCount: number;
};
/**
 * Measure a paragraph-like block WITH predicted line-break positions.
 *
 * Uses `prepareWithSegments` (segments retained) + `layoutWithLines` so each
 * returned line carries its text + width. Calibration needs this for the
 * D3-02 break-position fidelity metric; Phase 4 pagination will need it for
 * page-boundary decisions.
 *
 * NOTE: Pretext's `LayoutCursor` is `{ segmentIndex, graphemeIndex }`, NOT a
 * raw string offset. Phase 4 maps these back to the D-05 grapheme substrate
 * (src/content/normalizeText.ts). Phase 3 only needs height + break
 * COUNT/POSITION for calibration (RESEARCH §Code Examples L485–488).
 */
export declare function measureParagraphWithBreaks(args: MeasureArgs): {
    height: number;
    lineCount: number;
    lines: {
        text: string;
        width: number;
    }[];
};
