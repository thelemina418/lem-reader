import { z } from "zod";
export declare const PageFragmentSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    pageIndex: z.ZodNumber;
    blocks: z.ZodArray<z.ZodObject<{
        blockIndex: z.ZodNumber;
        startGrapheme: z.ZodNumber;
        endGrapheme: z.ZodNumber;
        footnoteIndex: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type PageFragment = z.infer<typeof PageFragmentSchema>;
/** First unconsumed source position, always in the original article. */
export declare const SourceCursorSchema: z.ZodObject<{
    blockIndex: z.ZodNumber;
    startGrapheme: z.ZodNumber;
    footnoteIndex: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type SourceCursor = z.infer<typeof SourceCursorSchema>;
export declare const FragmentationResultSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    status: z.ZodEnum<{
        fallback: "fallback";
        ok: "ok";
    }>;
    pages: z.ZodArray<z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        pageIndex: z.ZodNumber;
        blocks: z.ZodArray<z.ZodObject<{
            blockIndex: z.ZodNumber;
            startGrapheme: z.ZodNumber;
            endGrapheme: z.ZodNumber;
            footnoteIndex: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    reason: z.ZodOptional<z.ZodString>;
    continuation: z.ZodOptional<z.ZodObject<{
        blockIndex: z.ZodNumber;
        startGrapheme: z.ZodNumber;
        footnoteIndex: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type FragmentationResult = z.infer<typeof FragmentationResultSchema>;
export declare const OverflowGuardResultSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    status: z.ZodEnum<{
        fallback: "fallback";
        ok: "ok";
    }>;
    pages: z.ZodArray<z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        pageIndex: z.ZodNumber;
        blocks: z.ZodArray<z.ZodObject<{
            blockIndex: z.ZodNumber;
            startGrapheme: z.ZodNumber;
            endGrapheme: z.ZodNumber;
            footnoteIndex: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type OverflowGuardResult = z.infer<typeof OverflowGuardResultSchema>;
import type { LineBox } from "../measurement/types";
export type { LineBox };
export type SplitDecision = {
    kind: "atomic";
} | {
    kind: "split";
};
