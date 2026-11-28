import type { Block } from "../src/content/schema";
import { type FootnoteBodyT } from "../src/content/footnoteBody";
/** ProvenancePartial — same shape as `server/htmlToBlocks.ts` L37-42. The
 * orchestrator merges this into a full Provenance + computes originalHtmlHash
 * from the raw markdown bytes. */
type ProvenancePartial = {
    sourceUrl?: string;
    title?: string;
    author?: string;
    publishedAt?: string;
};
declare const SCHEMA_KINDS: Set<string>;
/** MarkdownToBlocksResult — byte-identical shape to
 * `server/htmlToBlocks.ts` `ExtractAndNormalizeResult` (L462-464). The
 * orchestrator destructures both with the same code. */
export interface MarkdownToBlocksResult {
    blocks: Block[];
    footnotes: FootnoteBodyT[];
    lang: string;
    provenancePartial: ProvenancePartial;
    isReaderable: boolean;
    /** Definitions past MAX_LINKED_FOOTNOTES that were left out (issue #60);
     * absent when none were. */
    omittedFootnoteCount?: number;
}
/**
 * markdownToBlocks — the strict-CommonMark → Block tree adapter. Pure function
 * (no I/O); safe to call concurrently. Returns the same shape as
 * `extractAndNormalize` so `server/ingest.ts` dispatches both identically.
 *
 * Front-matter handling (D8-17): a leading `---\ntitle: T\nauthor: A\ndate: D\n---`
 * block is parsed via strict YAML 1.2 and merged into `provenancePartial`.
 * Only `title` / `author` / `date` string fields are carried; non-string
 * fields are dropped. `date` becomes an ISO-8601 string via
 * `new Date(date).toISOString()` — the schema's `.datetime()` refinement
 * re-validates at ArticleSchema.parse.
 *
 * The filename → title fallback chain (D8-17) runs in `server/ingest.ts`
 * (Task 2), not here — this adapter is filename-agnostic.
 */
export declare function markdownToBlocks(md: string): Promise<MarkdownToBlocksResult>;
/**
 * stripMarkdownExtension — pure string-only helper that strips a trailing
 * `.md` or `.markdown` extension (case-insensitive). Implements the D8-17
 * filename-fallback channel that `server/ingest.ts` consumes when deriving a
 * title from the uploaded filename (front-matter absent). The File API
 * returns just the filename (no leading path), so this helper does NO
 * path-basename logic — it operates on the raw string the client passes.
 *
 * Examples (mirrored in the unit suite):
 *   stripMarkdownExtension("essay.md")         === "essay"
 *   stripMarkdownExtension("essay.markdown")   === "essay"
 *   stripMarkdownExtension("Essay.MD")         === "Essay"
 *   stripMarkdownExtension("no-extension")     === "no-extension"
 *   stripMarkdownExtension("archive.post.md")  === "archive.post"
 */
export declare function stripMarkdownExtension(filename: string): string;
export { SCHEMA_KINDS };
