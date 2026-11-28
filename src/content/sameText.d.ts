/** The identity of the text a stored record's coordinates refer to. */
export interface TextStamp {
    readonly revision: number;
    /** Fingerprint of the applied corrections; absent = the original. */
    readonly corrections?: string;
}
/** Engine-only: record the corrections fingerprint of a corrected article. */
export declare function registerCorrectionsFingerprint(article: object, fingerprint: string): void;
/** The stamp a record saved against `article` carries (and is keyed by). */
export declare function textStamp(article: TextStamp): TextStamp;
/**
 * Was `stored` saved against the same text as `shown`? True → trust its
 * coordinates directly; false → re-match by quote (or treat as unmatched).
 */
export declare function isSameText(stored: TextStamp, shown: TextStamp): boolean;
