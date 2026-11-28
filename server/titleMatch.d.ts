/**
 * normalizeForTitleMatch — lowercase + separator-collapse (the D11-09 fuzzy
 * matching basis: case/whitespace-insensitive equality and containment).
 * Hyphens and underscores count as whitespace because the filename channel
 * slugifies spaces ("calm-report.pdf" ↔ page-1 heading "Calm Report") and
 * the transcript's chapter titles slugify the same way — comparisons only
 * match when word separators are normalized uniformly on both sides.
 */
export declare function normalizeForTitleMatch(s: string): string;
