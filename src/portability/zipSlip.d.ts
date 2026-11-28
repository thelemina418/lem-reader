/**
 * isSafeEntryName — true iff the raw archive entry name cannot escape the
 * virtual extraction root. Refuses, in order: control characters (incl.
 * NUL), any backslash (Windows separator smuggled into a POSIX-style name),
 * drive-letter prefixes, leading slash or tilde, URL-encoded separators
 * (decoded and re-judged — decode failure itself refuses), traversal
 * escapes (`..` popping an empty virtual stack), OS-reserved segments,
 * colon-bearing segments (NTFS alternate data streams), and names that
 * resolve to nothing.
 */
export declare function isSafeEntryName(rawName: string): boolean;
/**
 * sanitizeFilename — sanitize a reader-facing download filename (the
 * per-article .md export derives it from article titles, which are
 * arbitrary web text). Strips control characters and the reserved
 * punctuation set (slash, backslash, angle brackets, colon, quote, pipe,
 * question mark, asterisk), collapses whitespace, trims, and caps at 120
 * chars. Returns `fallback` when the cleaned result is empty or an
 * OS-reserved name (sanitize-then-fallback — the server/slugify.ts
 * discipline). Pure function; no I/O.
 */
export declare function sanitizeFilename(title: string, fallback: string): string;
