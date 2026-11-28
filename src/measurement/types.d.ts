import { z } from "zod";
export declare const ConstraintsSchema: z.ZodObject<{
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
    viewportWidthPx: z.ZodNumber;
    lang: z.ZodString;
}, z.core.$strip>;
export type Constraints = z.infer<typeof ConstraintsSchema>;
export declare const LineBoxSchema: z.ZodObject<{
    charOffset: z.ZodNumber;
    topPx: z.ZodNumber;
    bottomPx: z.ZodNumber;
}, z.core.$strip>;
export type LineBox = z.infer<typeof LineBoxSchema>;
export declare const BlockMeasurementSchema: z.ZodObject<{
    kind: z.ZodString;
    heightPx: z.ZodNumber;
    marginBlockStartPx: z.ZodOptional<z.ZodNumber>;
    marginBlockEndPx: z.ZodOptional<z.ZodNumber>;
    lineCount: z.ZodNumber;
    lineBoxes: z.ZodDefault<z.ZodArray<z.ZodObject<{
        charOffset: z.ZodNumber;
        topPx: z.ZodNumber;
        bottomPx: z.ZodNumber;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type BlockMeasurement = z.infer<typeof BlockMeasurementSchema>;
export declare const MeasurementResultSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<2>;
    constraints: z.ZodObject<{
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
        viewportWidthPx: z.ZodNumber;
        lang: z.ZodString;
    }, z.core.$strip>;
    blocks: z.ZodArray<z.ZodObject<{
        kind: z.ZodString;
        heightPx: z.ZodNumber;
        marginBlockStartPx: z.ZodOptional<z.ZodNumber>;
        marginBlockEndPx: z.ZodOptional<z.ZodNumber>;
        lineCount: z.ZodNumber;
        lineBoxes: z.ZodDefault<z.ZodArray<z.ZodObject<{
            charOffset: z.ZodNumber;
            topPx: z.ZodNumber;
            bottomPx: z.ZodNumber;
        }, z.core.$strip>>>;
    }, z.core.$strip>>;
    scope: z.ZodOptional<z.ZodObject<{
        includeFootnotes: z.ZodOptional<z.ZodBoolean>;
        startBlock: z.ZodNumber;
        endBlock: z.ZodNumber;
        startGrapheme: z.ZodOptional<z.ZodNumber>;
        endGrapheme: z.ZodOptional<z.ZodNumber>;
        startFootnote: z.ZodOptional<z.ZodNumber>;
        endFootnote: z.ZodOptional<z.ZodNumber>;
        startFootnoteGrapheme: z.ZodOptional<z.ZodNumber>;
        endFootnoteGrapheme: z.ZodOptional<z.ZodNumber>;
        articleId: z.ZodString;
        revision: z.ZodNumber;
    }, z.core.$strip>>;
    computedAt: z.ZodString;
}, z.core.$strip>;
export type MeasurementResult = z.infer<typeof MeasurementResultSchema>;
export declare const EligibilityStateSchema: z.ZodObject<{
    paragraph: z.ZodObject<{
        pretextEligible: z.ZodBoolean;
    }, z.core.$strip>;
    heading: z.ZodObject<{
        pretextEligible: z.ZodBoolean;
    }, z.core.$strip>;
}, z.core.$strip>;
export type EligibilityState = z.infer<typeof EligibilityStateSchema>;
export declare const DiagnosticEventSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"drift-exceedance">;
    ts: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"dom-fallback">;
    ts: z.ZodString;
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"late-epoch-drop">;
    captured: z.ZodNumber;
    current: z.ZodNumber;
    ts: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"calibration-failure">;
    ts: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"runtime-guard-downgrade">;
    "kind-downgraded": z.ZodString;
    heightDriftPx: z.ZodNumber;
    ts: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"measurement-error">;
    message: z.ZodString;
    ts: z.ZodString;
}, z.core.$strip>], "kind">;
export type DiagnosticEvent = z.infer<typeof DiagnosticEventSchema>;
