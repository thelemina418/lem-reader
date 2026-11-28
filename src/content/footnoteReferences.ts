// src/content/footnoteReferences.ts
// Spec #66 / issue #55 — the ONE derivation of where every Footnote reference
// sits in an article: its controlled anchor identity and its canonical D-05
// span. Anchor resolution (src/reader/footnoteAnchors.ts), the renderer's
// anchor ids and returns, and the read-aloud marker skip all read it, so the
// three never disagree. Later tickets (excursion origin #57, one return per
// reference #57/#56, notes-aren't-reading #58) build on the same list.
//
// Both reference forms are covered: the inline `footnote-ref` mark (new
// ingests) and the legacy block-level `footnote-reference` kind (stored rows,
// never produced any more). Pure — no DOM, no React.
import type { Block, CanonicalArticle, InlineRun } from "./types";
import {
  articleGraphemeIndex,
  BLOCK_SEPARATOR,
  graphemeClusters,
  inlineText,
  normalizeRunText,
  runSeparators,
} from "./normalizeText";
import { blockGraphemeLength } from "../pagination/anchor";

/** One reference occurrence. `start`/`end` are article-global canonical
 * grapheme offsets of the visible marker (end exclusive). */
export interface FootnoteReferenceSpan {
  readonly footnoteId: string;
  /** 1-based, document order among the references to this note. */
  readonly occurrence: number;
  readonly anchorId: string;
  readonly start: number;
  readonly end: number;
}

/** The controlled DOM id of a reference occurrence: `fn-ref-N` for the
 * first (the historical id, so stored returns keep working) and
 * `fn-ref-N-K` for the K-th. Never collides with a note's `fn-N`. */
export function footnoteReferenceAnchorId(footnoteId: string, occurrence: number): string {
  const n = footnoteId.replace(/^fn-/, "");
  return occurrence <= 1 ? `fn-ref-${n}` : `fn-ref-${n}-${occurrence}`;
}

/** Inverse of footnoteReferenceAnchorId; null for anything else. */
export function parseFootnoteReferenceAnchorId(
  id: string,
): { footnoteId: string; occurrence: number } | null {
  const m = /^fn-ref-(\d+)(?:-([2-9]|[1-9]\d+))?$/.exec(id);
  if (!m) return null;
  return { footnoteId: `fn-${m[1]}`, occurrence: m[2] === undefined ? 1 : Number(m[2]) };
}

/** The footnote-ref mark on a run, if any. */
export function footnoteRefOf(run: InlineRun) {
  for (const mark of run.marks) if (mark.type === "footnote-ref") return mark;
  return undefined;
}

type Found = {
  footnoteId: string;
  occurrence: number;
  start: number;
  end: number;
  /** The legacy block-level reference this occurrence came from. */
  legacyBlock?: Block;
};

/** Marker spans within one inline-run array whose stream starts at `origin`,
 * under inlineText's exact rule (runs normalized, empties dropped, joined per
 * runSeparators — a marker glued to its word joins with no space). */
function runSpans(runs: InlineRun[], origin: number, lang: string, out: Found[]): void {
  if (!runs.some((r) => footnoteRefOf(r) !== undefined)) return;
  const separators = runSeparators(runs);
  let prefix = "";
  for (const [i, run] of runs.entries()) {
    const norm = normalizeRunText(run.text);
    if (norm.length === 0) continue;
    const lead = separators[i] === 1 ? `${prefix} ` : prefix;
    const ref = footnoteRefOf(run);
    if (ref !== undefined) {
      const start = origin + graphemeClusters(lead, lang).length;
      out.push({
        footnoteId: ref.footnoteId,
        occurrence: ref.occurrence,
        start,
        end: start + graphemeClusters(norm, lang).length,
      });
    }
    prefix = lead + norm;
  }
}

function blockSpans(block: Block, origin: number, lang: string, out: Found[]): void {
  switch (block.kind) {
    case "heading":
    case "paragraph":
      runSpans(block.content, origin, lang, out);
      return;
    case "figure": {
      // Contribution is [alt, caption].filter(Boolean).join(separator).
      const caption = inlineText(block.caption);
      if (caption.length === 0) return;
      const altLen = block.alt ? graphemeClusters(block.alt, lang).length : 0;
      runSpans(
        block.caption,
        origin + (altLen > 0 ? altLen + BLOCK_SEPARATOR.length : 0),
        lang,
        out,
      );
      return;
    }
    case "footnote-reference":
      out.push({
        footnoteId: block.footnoteId,
        occurrence: 0, // numbered below — legacy rows carry no occurrence
        start: origin,
        end: origin + graphemeClusters(block.marker, lang).length,
        legacyBlock: block,
      });
      return;
    case "blockquote":
    case "bulleted-list":
    case "numbered-list": {
      // Child lengths use the shared D-05 substrate; separators between
      // children and list items follow blockNormalizedText's join rules.
      const groups =
        block.kind === "blockquote" ? [block.children] : block.items.map((item) => item.content);
      let cursor = origin;
      for (const children of groups) {
        for (const child of children) {
          blockSpans(child, cursor, lang, out);
          cursor += blockGraphemeLength(child, lang) + BLOCK_SEPARATOR.length;
        }
        // An empty list item still contributes its inter-item separator.
        if (children.length === 0) cursor += BLOCK_SEPARATOR.length;
      }
      return;
    }
    case "code-block":
    case "unsupported":
      return;
  }
}

const spanCache = new WeakMap<CanonicalArticle["blocks"], readonly FootnoteReferenceSpan[]>();

/** Every reference occurrence in the article body, in document order. */
export function footnoteReferenceSpans(
  article: CanonicalArticle,
): readonly FootnoteReferenceSpan[] {
  const cached = spanCache.get(article.blocks);
  if (cached) return cached;
  const { blockStartOffsets } = articleGraphemeIndex(article);
  const found: Found[] = [];
  article.blocks.forEach((block, i) =>
    blockSpans(block, blockStartOffsets[i]!, article.lang, found),
  );
  const legacyCount = new Map<string, number>();
  const legacyIds = new Map<Block, string>();
  const spans = found.map((f) => {
    let occurrence = f.occurrence;
    if (occurrence === 0) {
      occurrence = (legacyCount.get(f.footnoteId) ?? 0) + 1;
      legacyCount.set(f.footnoteId, occurrence);
    }
    const anchorId = footnoteReferenceAnchorId(f.footnoteId, occurrence);
    if (f.legacyBlock !== undefined) legacyIds.set(f.legacyBlock, anchorId);
    return { footnoteId: f.footnoteId, occurrence, anchorId, start: f.start, end: f.end };
  });
  spanCache.set(article.blocks, spans);
  legacyIdCache.set(article.blocks, legacyIds);
  return spans;
}

const legacyIdCache = new WeakMap<CanonicalArticle["blocks"], ReadonlyMap<Block, string>>();

/**
 * The anchor id of every legacy block-level reference, keyed by its block
 * (review H1): legacy rows carry no occurrence, so the renderer reads the
 * document-order numbering footnoteReferenceSpans gives them — a note cited
 * twice gets `fn-ref-N` and `fn-ref-N-2`, matching its returns.
 */
export function legacyReferenceAnchorIds(article: CanonicalArticle): ReadonlyMap<Block, string> {
  footnoteReferenceSpans(article);
  return legacyIdCache.get(article.blocks)!;
}

/** The first reference to a note — the target of the note's return. */
export function firstFootnoteReference(
  article: CanonicalArticle,
  footnoteId: string,
): FootnoteReferenceSpan | undefined {
  return footnoteReferenceSpans(article).find((s) => s.footnoteId === footnoteId);
}

// ── Reference/return vocabulary (shared by the renderer and the excursion) ──

/** a, b, …, z, aa, ab, … — the K-th (1-based) return's letter. */
export function footnoteReturnLetter(occurrence: number): string {
  let k = occurrence;
  let out = "";
  while (k > 0) {
    k -= 1;
    out = String.fromCharCode(97 + (k % 26)) + out;
    k = Math.floor(k / 26);
  }
  return out;
}

/** Issue #57 / story 9 — a reference marker is announced as a footnote link
 * with its number. The publisher's marker text stays in the name
 * (label-in-name), so "1" reads "Footnote 1" and "[2]" reads "Footnote [2]". */
export function footnoteMarkerLabel(marker: string): string {
  return `Footnote ${marker.trim()}`;
}

/** Marks the plain ↩ return; the excursion redirects it to its origin. */
export const PLAIN_RETURN_ATTR = "data-footnote-return";
