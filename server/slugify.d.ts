/**
 * slugifyUrl — canonical-URL → stable ASCII slug. The slug is the article's
 * durable identity (D7-07 save-once-read-forever dedupe key). Pure function;
 * no I/O except the deterministic node:crypto SHA-256 fallback.
 */
export declare function slugifyUrl(canonicalUrl: string): string;
