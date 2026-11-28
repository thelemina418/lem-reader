import { normalizeForTitleMatch } from "./titleMatch";
// ── Grouping budgets (decision #26, decided character budgets) ───────────────
/** Paragraph TARGET length in characters. Accumulated caption segments keep
 * joining a paragraph until it reaches this target; the NEXT segment then
 * starts a fresh paragraph (the budget is a target, not a clamp — a segment
 * is never split to hit it exactly). */
export const TRANSCRIPT_PARAGRAPH_TARGET_CHARS = 380;
/** Paragraph HARD CAP in characters. A segment that would push a non-empty
 * paragraph past this cap forces a break BEFORE it (the cap forces a break —
 * it never splits a segment). A lone segment longer than the cap still forms
 * ONE unsplit paragraph (never split a segment across paragraphs — decision
 * #26); pagination's fragment splitter owns that pathological case. */
export const TRANSCRIPT_PARAGRAPH_CAP_CHARS = 600;
// ── Chapter edge rules (decision #26 — all five accepted) ────────────────────
/** restatesVideoTitle — rule 3's predicate: the chapter RESTATES the video
 * title when the two share the shared D11-09 title-match key (see
 * server/titleMatch.ts — the same algebra the PDF doubled-title consume
 * uses; case/whitespace-insensitive equality, the common creator pattern of
 * repeating the video title as the 0:00 chapter marker). Deliberately NOT
 * substring containment: a 0:00 chapter like "Introduction" under a video
 * titled "Introduction to X" is a legitimate chapter, and an over-broad
 * drop would silently discard real structure (a kept near-duplicate h2 is
 * harmless; a dropped chapter is lost). */
function restatesVideoTitle(chapterTitle, videoTitle) {
    const chapterKey = normalizeForTitleMatch(chapterTitle);
    const videoKey = normalizeForTitleMatch(videoTitle);
    return chapterKey.length > 0 && chapterKey === videoKey;
}
/** countWarning — one calm count-form omission warning entry (the
 * extractionWarnings tone: "3 unsupported blocks omitted" / "1 image could
 * not be included"). NOUN carries the number ("chapter" / "caption cue"),
 * DESCRIPTOR the omission reason; every dropped item discloses its RULE,
 * never silent. */
function countWarning(n, noun, descriptor) {
    return n === 1
        ? `1 ${noun} ${descriptor} was omitted`
        : `${n} ${noun}s ${descriptor} were omitted`;
}
/**
 * admitChapters — apply edge rules 2/3/5 (the state-independent drops) and
 * return the chapters eligible for the block stream, stable-sorted by
 * startMs, plus the warnings they cost:
 *   rule 2 — empty/whitespace title → drop + warning (never invent "Chapter 4")
 *   rule 3 — a 0:00 chapter restating the video title → drop + warning
 *   rule 5 — chapter starting after the last caption segment (truncated
 *            transcript) → drop + warning
 * Rules 1 (missing chapters → no h2 at all) and 4 (mid-group start forces a
 * break) are structural and live in transcriptToBlocks itself.
 */
function admitChapters(chapters, videoTitle, lastSegmentStartMs) {
    const sorted = [...chapters].sort((a, b) => a.startMs - b.startMs);
    const admitted = [];
    let untitled = 0;
    let duplicates = 0;
    let beyondEnd = 0;
    for (const chapter of sorted) {
        if (chapter.title.trim().length === 0) {
            untitled += 1; // rule 2
            continue;
        }
        if (chapter.startMs === 0 && restatesVideoTitle(chapter.title, videoTitle)) {
            duplicates += 1; // rule 3
            continue;
        }
        if (chapter.startMs > lastSegmentStartMs) {
            beyondEnd += 1; // rule 5
            continue;
        }
        admitted.push(chapter);
    }
    const warnings = [];
    if (untitled > 0)
        warnings.push(countWarning(untitled, "chapter", "without a title"));
    if (duplicates > 0) {
        warnings.push(countWarning(duplicates, "chapter", "duplicating the video title"));
    }
    if (beyondEnd > 0)
        warnings.push(countWarning(beyondEnd, "chapter", "past the last caption"));
    return { admitted, warnings };
}
// ── The normalizer ───────────────────────────────────────────────────────────
/**
 * transcriptToBlocks — group caption segments into paragraph blocks under the
 * char budgets, emit chapter `h2` boundaries, and produce the block-keyed
 * timestamp anchors. The SAME policy applies to manual and ASR tracks
 * (per-line manual cues merge into print-like paragraphs exactly like ASR
 * lines — decision #26).
 *
 * Grouping policy (deterministic):
 *   - segments join their paragraph with a single space while the paragraph
 *     is below the ~380 target;
 *   - once at/above the target, the NEXT segment starts a new paragraph;
 *   - a segment that would push a non-empty paragraph past the ~600 hard cap
 *     starts a new paragraph instead (never splitting a segment);
 *   - a chapter boundary always forces a break, and the chapter's first
 *     segment begins the new paragraph (rule 4) — the `h2` joins the anchor
 *     map with the chapter's own startMs (heading blocks participate).
 */
export function transcriptToBlocks(transcript) {
    // Whitespace-only cue bodies carry no readable text (their timing is
    // meaningless without text) — drop them before grouping so every paragraph
    // run satisfies the InlineRun min(1) contract after normalization. The
    // drop is DISCLOSED, never silent (the honesty guardrail): one calm count
    // warning joins the chapter edge-rule warnings.
    const whitespaceOnlyCount = transcript.segments.filter((s) => s.text.trim().length === 0).length;
    const cueWarnings = whitespaceOnlyCount > 0
        ? [countWarning(whitespaceOnlyCount, "caption cue", "without readable text")]
        : [];
    const segments = transcript.segments
        .filter((s) => s.text.trim().length > 0)
        .sort((a, b) => a.startMs - b.startMs);
    const blocks = [];
    const anchors = [];
    if (segments.length === 0) {
        // The client schema guarantees min(1) segment, but every one of them
        // could be whitespace-only. An empty block list would fail
        // ArticleSchema.blocks min(1) downstream — the orchestrator's honest
        // extraction-unsupported refusal is the right outcome, so return the
        // empty shape (with the drop still disclosed) and let the shared
        // refusal fire.
        return { blocks, anchors, warnings: cueWarnings };
    }
    const { admitted: chapters, warnings } = admitChapters(transcript.chapters, transcript.title, segments[segments.length - 1].startMs);
    let group = [];
    let groupLen = 0; // joined length: sum of segment lengths + (count-1) joining spaces
    let groupStartMs = 0;
    let chapterIdx = 0;
    const flushGroup = () => {
        if (group.length === 0)
            return;
        blocks.push({ kind: "paragraph", content: [{ text: group.join(" "), marks: [] }] });
        anchors.push({ blockIndex: blocks.length - 1, startMs: groupStartMs });
        group = [];
        groupLen = 0;
    };
    for (const segment of segments) {
        // Chapters starting at or before this segment's start emit their h2
        // first (rule 4 — the chapter's first segment begins a new paragraph;
        // a chapter exactly at a segment boundary breaks before that segment).
        // All admitted chapters have startMs ≤ the last segment's start, so the
        // loop consumes every one of them.
        while (chapterIdx < chapters.length && chapters[chapterIdx].startMs <= segment.startMs) {
            flushGroup();
            const chapter = chapters[chapterIdx];
            blocks.push({ kind: "heading", level: 2, content: [{ text: chapter.title, marks: [] }] });
            anchors.push({ blockIndex: blocks.length - 1, startMs: chapter.startMs });
            chapterIdx += 1;
        }
        // The budget head: a non-empty paragraph hands over to a fresh one when
        //   (a) it already reached the ~380 target (the target forces the NEXT
        //       segment to start a new paragraph), or
        //   (b) this segment would push it past the ~600 hard cap (the cap
        //       forces a break BEFORE the segment — never a split).
        // An empty paragraph always admits the segment — a lone segment longer
        // than the cap stays ONE unsplit paragraph (decision #26; pagination's
        // fragment splitter owns that pathological case).
        if (group.length > 0 &&
            (groupLen >= TRANSCRIPT_PARAGRAPH_TARGET_CHARS ||
                groupLen + 1 + segment.text.length > TRANSCRIPT_PARAGRAPH_CAP_CHARS)) {
            flushGroup();
        }
        if (group.length === 0) {
            groupStartMs = segment.startMs;
        }
        group.push(segment.text);
        groupLen = group.length === 1 ? segment.text.length : groupLen + 1 + segment.text.length;
    }
    flushGroup();
    return { blocks, anchors, warnings: [...cueWarnings, ...warnings] };
}
