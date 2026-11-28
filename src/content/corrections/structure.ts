// src/content/corrections/structure.ts
// Spec #68 / issue #72 — the corrected article's chapters. Pure.
//
// The corrected article's structure is derived from the corrected blocks
// (ADR 0014: the original's frozen snapshot describes the original and is
// never rewritten), but a chapter the correction did not touch keeps what
// it was:
//
//   - its IDENTITY — the original destination id. Ids are range-encoded
//     (`ch-<block>.<g|b>`), so hiding one paragraph would otherwise re-id
//     every later chapter and break every completion and collection entry
//     that refers to them. A chapter is "the same chapter" when its heading
//     is found again by text (the heading's quote, narrowed by context —
//     the highlight re-matching rules, confident matches only), never by
//     block index;
//   - its TITLE and title source — publisher chapter titles captured at
//     ingest exist only in the original's snapshot, so they are carried
//     over, and the publisher outline is re-offered to derivation so the
//     same chapter boundaries win.
//
// A chapter whose heading is gone (hidden) is gone; a heading that becomes
// a chapter without an original counterpart gets a fresh id. Those are the
// genuine chapter changes the consequences step reports (chapterConsequences).

import { resolveWorkStructure } from "../chapterTargets";
import {
  articleGraphemeIndex,
  deriveQuoteSelector,
  normalizeRunText,
  resolveQuoteSelector,
} from "../normalizeText";
import type { StructureDestination, WorkStructure } from "../schema";
import { textStamp } from "../sameText";
import {
  deriveWorkStructure,
  publisherEntryMatchesHeading,
  validateWorkStructure,
} from "../structure";
import type { CanonicalArticle } from "../types";

function headingTextAt(article: CanonicalArticle, index: number): string | null {
  const block = article.blocks[index];
  if (block?.kind !== "heading") return null;
  return normalizeRunText(block.content.map((r) => r.text).join(""));
}

/** The heading block that opens `chapter` (the first chapter's range also
 * owns the work's leading text, so its heading may sit deeper in). */
function headingBlockOf(article: CanonicalArticle, chapter: StructureDestination): number | null {
  for (let i = chapter.startBlock; i < chapter.endBlock; i++) {
    const text = headingTextAt(article, i);
    if (text === null) continue;
    if (
      text === normalizeRunText(chapter.title) ||
      publisherEntryMatchesHeading(chapter.title, text)
    ) {
      return i;
    }
  }
  return null;
}

/** Where `original`'s heading block `index` is in `corrected` (by text). */
function findHeading(
  original: CanonicalArticle,
  index: number,
  corrected: CanonicalArticle,
): number | null {
  const from = articleGraphemeIndex(original);
  const start = from.blockStartOffsets[index]!;
  const range = { start, end: start + from.perBlockLengths[index]! };
  if (range.end <= range.start) return null;
  const resolved = resolveQuoteSelector(corrected, deriveQuoteSelector(original, range), range);
  if (typeof resolved === "string") return null;
  const to = articleGraphemeIndex(corrected);
  const at = to.blockStartOffsets.findIndex(
    (offset, i) =>
      i < corrected.blocks.length &&
      offset === resolved.start &&
      offset + to.perBlockLengths[i]! === resolved.end,
  );
  if (at < 0) return null;
  return headingTextAt(corrected, at) === headingTextAt(original, index) ? at : null;
}

/**
 * The structure of `corrected` (a corrected article of `original`, carrying
 * its corrections fingerprint), with unchanged chapters keeping their
 * original ids and titles. Undefined when no valid structure exists.
 */
export function correctedStructure(
  original: CanonicalArticle,
  corrected: CanonicalArticle,
): WorkStructure | undefined {
  const before = resolveWorkStructure(original);
  const originalChapters = (before?.destinations ?? []).filter((d) => d.kind === "chapter");

  // Original chapters still opened by their heading, keyed by its corrected block.
  const carried = new Map<number, StructureDestination>();
  for (const chapter of originalChapters) {
    const heading = headingBlockOf(original, chapter);
    if (heading === null) continue;
    const at = findHeading(original, heading, corrected);
    if (at !== null && !carried.has(at)) carried.set(at, chapter);
  }
  const evidence = [...carried.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, chapter]) => chapter)
    .filter((chapter) => chapter.titleSource === "publisher")
    .map((chapter) => chapter.title);

  const derived = deriveWorkStructure(
    { ...corrected, provenanceTitle: corrected.provenance.title },
    evidence.length >= 2 ? evidence : undefined,
  );
  if (derived === undefined) return undefined;

  const keptIds = new Set([...carried.values()].map((c) => c.id));
  const renamed = new Map<string, string>();
  const used = new Set<string>();
  let spare = corrected.blocks.length;
  const destinations = derived.destinations.map((d): StructureDestination => {
    if (d.kind !== "chapter") return d;
    const heading = headingBlockOf(corrected, d);
    const was = heading === null ? undefined : carried.get(heading);
    let id = d.id;
    if (was !== undefined) id = was.id;
    else if (keptIds.has(id) || used.has(id)) {
      // A new chapter whose range-encoded id an unchanged chapter already
      // carries: give it an unused id of the same shape.
      while (keptIds.has(`ch-${spare}.b`) || used.has(`ch-${spare}.b`)) spare += 1;
      id = `ch-${spare}.b`;
    }
    used.add(id);
    if (id !== d.id) renamed.set(d.id, id);
    return was === undefined
      ? { ...d, id }
      : { ...d, id, title: was.title, titleSource: was.titleSource };
  });
  const structure = {
    ...derived,
    ...textStamp(corrected),
    destinations: destinations.map((d) =>
      d.parentChapterId !== undefined && renamed.has(d.parentChapterId)
        ? { ...d, parentChapterId: renamed.get(d.parentChapterId)! }
        : d,
    ),
  };
  return validateWorkStructure(corrected, structure) ?? undefined;
}
