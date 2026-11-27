// server/epubFootnotes.ts
// Spec #66 / issue #61 — EPUB footnotes. EPUB chapters ride the shared
// link-graph detection (server/footnoteLinks.ts, with its epub:type option);
// this module adds the two things only a BOOK needs:
//
// 1. Cross-file notes. Many books keep every note in a separate Notes
//    document (`<a epub:type="noteref" href="notes.xhtml#n12">`). Before a
//    chapter is detected, each note it references in another spine document
//    is COPIED into the chapter's DOM (a trailing endnotes section) and the
//    reference is pointed at the copy, so the shared detection extracts it
//    like any in-chapter note: every chapter article carries the notes it
//    references and works on its own. The Notes document is never changed;
//    it stays in the book as an ordinary chapter.
// 2. Chapter numbering. A chapter unit can merge several spine documents
//    (a publisher split); each document is detected on its own, so its notes
//    are renumbered into one fn-1…fn-N sequence for the chapter, a note
//    copied into two documents of one chapter is kept once, and every
//    reference occurrence is recounted in document order.
//
// Pure DOM reading and rewriting over already-open archive text: nothing is
// fetched or executed. The copied markup is sanitized with every other note
// (footnoteBodiesParagraphs → sanitizeExtractedHtmlEach).
import { footnoteParagraphs, type FootnoteBodyT } from "../src/content/footnoteBody";
import type { Block, InlineRun } from "../src/content/schema";
import {
  declaresEpubNote,
  inNotesSection,
  isMarkerLike,
  isReferencePoint,
  noteContaining,
} from "./footnoteLinks";

/** A book-internal link target: a spine document path and an element id. */
export interface BookTarget {
  path: string;
  fragment: string;
}

/** Resolve a raw href written in the document at `fromPath` to a
 * book-internal target, or null (external, no fragment, unresolvable). */
export type BookHrefResolver = (rawHref: string, fromPath: string) => BookTarget | null;

/** The id prefix copied notes carry inside the referencing chapter's DOM
 * (ids are discarded by the sanitizer; this only has to be unique there). */
const COPY_ID_PREFIX = "lem-note-copy";

const HREF_ATTR = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/** Record the fragments `xhtml` (at `path`) links to in OTHER documents
 * into `out` (path → fragments) — a cheap string prefilter, before parsing. */
export function collectCrossFileTargets(
  xhtml: string,
  path: string,
  resolve: BookHrefResolver,
  out: Map<string, Set<string>>,
): void {
  for (const m of xhtml.matchAll(HREF_ATTR)) {
    const target = resolve(m[1] ?? m[2] ?? "", path);
    if (target === null || target.path === path) continue;
    const fragments = out.get(target.path) ?? new Set<string>();
    fragments.add(target.fragment);
    out.set(target.path, fragments);
  }
}

/** Can `document` hold a note at any of the linked `fragments`? A note-like
 * container that is declared (epub:type), sits in a notes section, or has a
 * link that could be a back-link. Documents that cannot (chapters an HTML
 * contents page links into) are not kept parsed as note sources. */
export function mayHoldNotes(document: Document, fragments: Iterable<string>): boolean {
  const body = document.body;
  if (!body) return false;
  for (const fragment of fragments) {
    const target = document.getElementById(fragment);
    const note = target === null ? null : noteContaining(target);
    if (note === null) continue;
    if (
      declaresEpubNote(note, note, body) ||
      inNotesSection(note, body) ||
      note.querySelector("a[href]") !== null
    ) {
      return true;
    }
  }
  return false;
}

/** The notes copied into one chapter document, in copy order. */
export interface CopiedNotes {
  wrapper: Element;
  copies: { element: Element; source: string; notePath: string }[];
}

/** Stable identity of a source note across the chapters it is copied into. */
const sourceKeys = new WeakMap<Element, string>();
let nextSourceKey = 0;
function sourceKey(note: Element): string {
  let key = sourceKeys.get(note);
  if (key === undefined) {
    key = `note-${(nextSourceKey += 1)}`;
    sourceKeys.set(note, key);
  }
  return key;
}

/** Does the note at `notePath` link back to `link` in `doc`? */
function linksBackTo(
  note: Element,
  notePath: string,
  link: Element,
  doc: { path: string; document: Document },
  resolve: BookHrefResolver,
): boolean {
  return Array.from(note.querySelectorAll("a[href]")).some((a) => {
    const t = resolve(a.getAttribute("href") ?? "", notePath);
    if (t === null || t.path !== doc.path) return false;
    const point = doc.document.getElementById(t.fragment);
    return point !== null && isReferencePoint(point, link);
  });
}

const RETURN_GLYPHS_ONLY = /^(?:\s|[↩↪↑^]|︎|️)+$/u;

/** A link that returns to a reference in some chapter (by EPUB/DPUB
 * semantics, or a bare return glyph). */
function isDeclaredBackLink(a: Element): boolean {
  const types = (a.getAttribute("epub:type") ?? "").toLowerCase().split(/\s+/);
  return (
    types.includes("backlink") ||
    a.getAttribute("role") === "doc-backlink" ||
    RETURN_GLYPHS_ONLY.test(a.textContent ?? "")
  );
}

/**
 * copyReferencedNotes — copy into `doc` every note it references in another
 * spine document (`sources`, parsed separately and never mutated), and point
 * each reference at its copy. A cross-file link is a reference by the same
 * evidence the shared detection accepts: EPUB note semantics, a back-link
 * to the link, or a marker-like link into a notes section. The copies sit in
 * a trailing `epub:type="endnotes"` section, so the shared detection then
 * accepts every one of them. Links in `doc` that name `doc` itself
 * (`ch1.xhtml#n1` inside ch1.xhtml) become plain fragments, so in-chapter
 * notes linked that way are found too. Returns undefined when nothing was
 * copied.
 */
export function copyReferencedNotes(
  doc: { path: string; document: Document },
  sources: ReadonlyMap<string, Document>,
  resolve: BookHrefResolver,
): CopiedNotes | undefined {
  const body = doc.document.body;
  if (!body) return undefined;

  // Pass 1 (read only): edges reference → source note.
  const edges: { link: Element; note: Element; notePath: string; fragment: string }[] = [];
  const selfLinks: { link: Element; fragment: string }[] = [];
  for (const link of Array.from(body.querySelectorAll("a[href]"))) {
    const href = link.getAttribute("href") ?? "";
    if (href.startsWith("#")) continue;
    const t = resolve(href, doc.path);
    if (t === null) continue;
    if (t.path === doc.path) {
      selfLinks.push({ link, fragment: t.fragment });
      continue;
    }
    const source = sources.get(t.path);
    const target = source?.getElementById(t.fragment) ?? null;
    if (source === undefined || target === null || source.body === null) continue;
    const note = noteContaining(target);
    if (note === null) continue;
    const isReference =
      declaresEpubNote(link, note, source.body) ||
      linksBackTo(note, t.path, link, doc, resolve) ||
      (isMarkerLike(link) && inNotesSection(note, source.body));
    if (isReference) edges.push({ link, note, notePath: t.path, fragment: t.fragment });
  }
  for (const { link, fragment } of selfLinks)
    link.setAttribute("href", `#${encodeURIComponent(fragment)}`);
  if (edges.length === 0) return undefined;

  // Pass 2: one copy per source note, in first-reference order.
  const wrapper = doc.document.createElement("section");
  wrapper.setAttribute("epub:type", "endnotes");
  const copies: CopiedNotes["copies"] = [];
  const prefixByNote = new Map<Element, string>();
  for (const { link, note, notePath, fragment } of edges) {
    let prefix = prefixByNote.get(note);
    if (prefix === undefined) {
      prefix = `${COPY_ID_PREFIX}-${prefixByNote.size + 1}-`;
      prefixByNote.set(note, prefix);
      const copy = doc.document.importNode(note, true) as Element;
      for (const el of [copy, ...Array.from(copy.querySelectorAll("[id]"))]) {
        const id = el.getAttribute("id");
        if (id) el.setAttribute("id", `${prefix}${id}`);
      }
      for (const a of Array.from(copy.querySelectorAll("a[href]"))) {
        const href = a.getAttribute("href") ?? "";
        const t = resolve(href, notePath);
        if (t === null) continue;
        if (t.path === doc.path) {
          // A back-link to this chapter: the shared detection removes it.
          a.setAttribute("href", `#${encodeURIComponent(t.fragment)}`);
        } else if (isDeclaredBackLink(a)) {
          a.remove(); // a return to ANOTHER chapter's reference
        }
      }
      wrapper.append(copy);
      copies.push({ element: copy, source: sourceKey(note), notePath });
    }
    link.setAttribute("href", `#${encodeURIComponent(`${prefix}${fragment}`)}`);
  }
  body.append(wrapper);
  return { wrapper, copies };
}

/**
 * settleCopiedNotes — after the shared detection ran on a document holding
 * copies: the source key of each detected note (undefined for the
 * document's own notes), and the leftover copies removed. Detected notes
 * are in document order and the copies trail the document, so the
 * extracted copies are the tail of the found notes; notes past the cap
 * (issue #60, `omittedCount`) leave the flow too but are not kept.
 */
export function settleCopiedNotes(
  copied: CopiedNotes | undefined,
  detectedCount: number,
  omittedCount = 0,
): (string | undefined)[] {
  const sources: (string | undefined)[] = new Array(detectedCount).fill(undefined);
  if (copied === undefined) return sources;
  const extracted = copied.copies.filter((c) => !c.element.isConnected);
  const firstCopy = detectedCount + omittedCount - extracted.length;
  extracted.forEach((c, i) => {
    if (firstCopy + i < detectedCount) sources[firstCopy + i] = c.source;
  });
  copied.wrapper.remove(); // anything not detected never reaches the flow
  return sources;
}

/** One spine document's walked blocks and notes (local ids fn-1…fn-k). */
export interface DocumentNotes {
  blocks: Block[];
  footnotes: FootnoteBodyT[];
  /** Parallel to `footnotes`: the source note a copy came from. */
  sources: (string | undefined)[];
}

/**
 * numberChapterNotes — one chapter's notes from its documents: renumbered
 * fn-1…fn-N in document order, a copied note kept once per chapter, and
 * each reference occurrence recounted in document order. A note with no
 * text is dropped and its references read as plain text (never a dead
 * link).
 */
export function numberChapterNotes(docs: DocumentNotes[]): {
  blocks: Block[][];
  footnotes: FootnoteBodyT[];
} {
  const footnotes: FootnoteBodyT[] = [];
  const idBySource = new Map<string, string>();
  const occurrences = new Map<string, number>();
  const blocks = docs.map((doc) => {
    const ids = new Map<string, string | null>();
    doc.footnotes.forEach((fn, i) => {
      const source = doc.sources[i];
      if (footnoteParagraphs(fn).every((p) => p.length === 0)) {
        ids.set(fn.id, null);
        return;
      }
      const known = source !== undefined ? idBySource.get(source) : undefined;
      if (known !== undefined) {
        ids.set(fn.id, known);
        return;
      }
      const id = `fn-${footnotes.length + 1}`;
      footnotes.push({ ...fn, id });
      if (source !== undefined) idBySource.set(source, id);
      ids.set(fn.id, id);
    });
    return renumberBlocks(doc.blocks, ids, occurrences);
  });
  return { blocks, footnotes };
}

/** Rewrite reference marks through `ids`, recounting occurrences in the
 * traversal order of footnoteReferenceSpans (src/content/footnoteReferences). */
function renumberBlocks(
  blocks: Block[],
  ids: ReadonlyMap<string, string | null>,
  occurrences: Map<string, number>,
): Block[] {
  const runs = (content: InlineRun[]): InlineRun[] =>
    content.map((run) => {
      if (!run.marks.some((m) => m.type === "footnote-ref")) return run;
      const marks = run.marks.flatMap((m): InlineRun["marks"] => {
        if (m.type !== "footnote-ref") return [m];
        const id = ids.get(m.footnoteId);
        if (id === null || id === undefined) return [];
        const occurrence = (occurrences.get(id) ?? 0) + 1;
        occurrences.set(id, occurrence);
        return [{ ...m, footnoteId: id, occurrence }];
      });
      return { ...run, marks };
    });
  const visit = (block: Block): Block => {
    switch (block.kind) {
      case "paragraph":
      case "heading":
        return { ...block, content: runs(block.content) };
      case "figure":
        return { ...block, caption: runs(block.caption) };
      case "blockquote":
        return { ...block, children: block.children.map(visit) };
      case "bulleted-list":
      case "numbered-list":
        return {
          ...block,
          items: block.items.map((item) => ({ ...item, content: item.content.map(visit) })),
        };
      default:
        return block;
    }
  };
  return blocks.map(visit);
}
