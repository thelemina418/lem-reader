// server/footnoteLinks.ts
// Spec #66 / issue #55 — link-graph footnote detection, the ONE seam every
// footnote style feeds (Pandoc today; Wikipedia/Substack/WordPress/notes-
// section fallback in #56, the cap disclosure in #60, EPUB in #61).
//
// Detection follows links, never class names: an in-text same-page link is a
// Footnote reference when its target is a note (a list item following the
// reference) that links BACK to the reference. It runs on the ORIGINAL source
// DOM, before Readability and sanitization — sanitization discards every id,
// so the link graph is only readable here (the collectOutlineEvidence
// precedent). Pure DOM reading and rewriting: nothing is fetched or executed.
//
// The DOM is rewritten into a controlled form that survives the strict
// sanitizer:
//   - each detected reference becomes `<a href="#fn-N">marker</a>` (marker =
//     the publisher's own wording), which htmlToBlocks' inline walk turns
//     into the `footnote-ref` mark — and ONLY when N names a detected note;
//   - every other same-page link whose fragment already looks like `fn-N`
//     loses its href first, so source markup can never forge a reference;
//   - matched notes are removed from the body flow (they appear once, in the
//     article's notes) and handed back as raw HTML with their back-links
//     removed; the caller sanitizes each one through the shared sanitizer.
// Issue #60 — honest handling of imperfect footnotes:
//   - a marker-like same-page link that is not a detected reference (its note
//     is missing, or was cut by the cap) loses its href: plain marker text,
//     never a link that leads nowhere;
//   - a note nothing references, sitting beside detected notes in the same
//     notes structure, is kept as a note (in note order) rather than left
//     for Readability to keep or drop;
//   - notes past MAX_LINKED_FOOTNOTES are cut, and counted so the caller can
//     disclose the cut and admit the article flagged (ADR 0003).

/** The most notes one article keeps (Markdown shares it). Notes past it are
 * left out and counted in `omittedCount` for the ingest disclosure. */
export const MAX_LINKED_FOOTNOTES = 1000;

/** The controlled reference href the rewrite emits for note `n` (1-based). */
export function footnoteHref(n: number): string {
  return `#fn-${n}`;
}

/** Parse a controlled reference href back to its note number, or null. */
export function footnoteNumberFromHref(href: string): number | null {
  const m = /^#fn-([1-9]\d*)$/.exec(href);
  return m ? Number(m[1]) : null;
}

export interface LinkedFootnotes {
  /** Raw (UNSANITIZED) inner HTML of each detected note, in note order:
   * index i is note `fn-(i+1)`. Back-links are already removed. */
  noteHtml: string[];
  /** Notes found past MAX_LINKED_FOOTNOTES and left out (issue #60). */
  omittedCount: number;
}

function decodeFragment(fragment: string): string | null {
  if (fragment.length === 0) return null;
  try {
    return decodeURIComponent(fragment);
  } catch {
    return null; // malformed escape — never a link-graph edge
  }
}

/** The element id a same-document link points at, or null for any other
 * link (external, other page, script scheme, empty fragment). */
function sameDocumentFragment(link: Element, document: Document): string | null {
  const href = link.getAttribute("href");
  if (!href) return null;
  if (href.startsWith("#")) return decodeFragment(href.slice(1));
  try {
    const self = new URL(document.URL);
    if (!/^https?:$/.test(self.protocol)) return null;
    const target = new URL(href, document.baseURI);
    if (
      target.hash.length > 1 &&
      target.origin === self.origin &&
      target.pathname === self.pathname &&
      target.search === self.search
    ) {
      return decodeFragment(target.hash.slice(1));
    }
  } catch {
    /* unresolvable — not same-document */
  }
  return null;
}

function targetOf(link: Element, document: Document): Element | null {
  const id = sameDocumentFragment(link, document);
  return id === null ? null : document.getElementById(id);
}

/** Inline wrappers a back-link may target instead of the anchor itself
 * (`<sup id="fnref1"><a href="#fn1">1</a></sup>`). Block ancestors are not
 * accepted — a link to a whole paragraph or section is not a back-link. */
const INLINE_WRAPPERS = new Set(["sup", "span", "a", "small", "cite"]);

function isBackLinkTo(link: Element, reference: Element, document: Document): boolean {
  const target = targetOf(link, document);
  if (target === null) return false;
  if (target === reference) return true;
  if (target.contains(reference)) return INLINE_WRAPPERS.has(target.tagName.toLowerCase());
  // An empty anchor placed just before the reference (WordPress's Easy
  // Footnotes: `<span id="easy-footnote-1"></span><span><a>1</a></span>`).
  if (!isEmptyAnchor(target)) return false;
  const next = target.nextElementSibling;
  return (
    next !== null &&
    (next === reference ||
      (next.contains(reference) && INLINE_WRAPPERS.has(next.tagName.toLowerCase())))
  );
}

function isEmptyAnchor(el: Element): boolean {
  return (
    INLINE_WRAPPERS.has(el.tagName.toLowerCase()) &&
    el.children.length === 0 &&
    (el.textContent ?? "").trim() === ""
  );
}

/** Block containers a note may be when it is not a list item (Substack's
 * `<div class="footnote">`, a `<p id="note-3">`, an `<aside>`). */
const NOTE_BLOCKS = new Set(["div", "p", "aside", "section", "footer", "dd", "blockquote"]);
/** Never a single note: the page's own content roots. */
const CONTENT_ROOTS = new Set(["body", "main", "article", "html"]);

/** The note a reference's target sits in: its list item, else the nearest
 * block that holds the target (the target itself when it is a block). */
function noteContaining(target: Element): Element | null {
  const item = target.closest("li");
  if (item !== null) return item;
  for (let el: Element | null = target; el !== null; el = el.parentElement) {
    const tag = el.tagName.toLowerCase();
    if (CONTENT_ROOTS.has(tag)) return null;
    if (NOTE_BLOCKS.has(tag)) return el;
  }
  return null;
}

function follows(a: Element, b: Element): boolean {
  return (a.compareDocumentPosition(b) & 4) /* DOCUMENT_POSITION_FOLLOWING */ !== 0;
}

/** Content a container must keep even when it carries no text. */
const NON_TEXT_CONTENT = "img, figure, picture, video, audio, iframe, table, pre, svg, math";

/** After a note leaves its list, remove the containers it leaves empty (the
 * list itself, a notes section holding only an <hr>), stopping at the body
 * and at anything that still carries text or media. Returns the element that
 * preceded the outermost removed container (a notes heading, often). */
function removeEmptiedContainers(start: Element | null, body: Element): Element | null {
  let node = start;
  let previous: Element | null = null;
  while (
    node !== null &&
    node !== body &&
    (node.textContent ?? "").trim() === "" &&
    node.querySelector(NON_TEXT_CONTENT) === null
  ) {
    const parent = node.parentElement;
    previous = node.previousElementSibling;
    node.remove();
    node = parent;
  }
  return previous;
}

/** The headings under which publishers put their notes. */
const NOTES_HEADING = /^(?:(?:foot|end)?notes|references|notes and references|citations|sources)$/i;

function isHeading(el: Element): boolean {
  return /^h[1-6]$/i.test(el.tagName);
}

/** The heading `el` is, or the heading it only wraps (MediaWiki's
 * `<div class="mw-heading"><h2>…</h2></div>`). */
function headingWithin(el: Element): Element | null {
  if (isHeading(el)) return el;
  const only = el.children.length === 1 ? el.children[0]! : null;
  if (only === null || (el.textContent ?? "").trim() !== (only.textContent ?? "").trim())
    return null;
  return headingWithin(only);
}

function isNotesHeading(el: Element): boolean {
  const heading = headingWithin(el);
  if (heading === null) return false;
  const text = (heading.textContent ?? "").replace(/\s+/g, " ").trim().replace(/:$/, "");
  return NOTES_HEADING.test(text);
}

/** Publisher marker wording: "1", "[12]", "(iv)", "a", "*", "†". Prose
 * ("see the second note") is never a marker. */
const MARKER = /^[[(]?(?:\d{1,4}|[a-z]|[ivxlc]{1,6}|[*†‡§¶#]{1,3})[\])]?$/iu;

function isMarkerLike(link: Element): boolean {
  return MARKER.test((link.textContent ?? "").replace(/\s+/g, "").trim());
}

/** ARIA roles (DPUB-ARIA) that declare a notes structure. */
const NOTES_ROLES = new Set(["doc-endnotes", "doc-footnotes"]);

/** Is `note` inside a structure the page declares as its notes — by DPUB
 * role or by a notes heading just before it or leading it? */
function inNotesSection(note: Element, body: Element): boolean {
  for (let el = note.parentElement; el !== null && el !== body; el = el.parentElement) {
    if (NOTES_ROLES.has(el.getAttribute("role") ?? "")) return true;
    const before = el.previousElementSibling;
    if (before !== null && isNotesHeading(before)) return true;
    const first = el.firstElementChild;
    if (first !== null && first !== note && !first.contains(note) && isNotesHeading(first))
      return true;
  }
  return false;
}

/** A notes heading the extraction left with nothing under it is clutter:
 * remove it (and any container it leaves empty). */
function removeOrphanedNotesHeading(candidate: Element | null, body: Element): void {
  if (candidate === null || !body.contains(candidate) || !isNotesHeading(candidate)) return;
  const next = candidate.nextElementSibling;
  if (next !== null && headingWithin(next) === null) return; // the section still has content
  const parent = candidate.parentElement;
  candidate.remove();
  removeEmptiedContainers(parent, body);
}

/** Text a publisher's return link carries: a marker or return glyphs only. */
const RETURN_TEXT = /^(?:\s|\^|[\u21A9\u21AA\u2191]|\uFE0E|\uFE0F)*$/u;

/** Notes nothing in the body references (issue #60): the other entries of a
 * structure that holds detected notes — list items beside a detected list
 * item, or blocks sharing a detected block note's tag and class (Substack's
 * `div.footnote`; the class is only a hint that the block is one of the same
 * notes, never what makes a page's notes notes). */
function unreferencedSiblings(notes: readonly Element[]): Element[] {
  const known = new Set(notes);
  const shapeOf = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    return tag === "li" ? "li" : `${tag}.${el.getAttribute("class") ?? ""}`;
  };
  // The note shapes each container holds: one scan per container, never one
  // per note (a heavily annotated work would make that quadratic). A block
  // note without a class names no shape to match.
  const shapesByParent = new Map<Element, Set<string>>();
  for (const note of notes) {
    const parent = note.parentElement;
    if (parent === null || shapeOf(note).endsWith(".")) continue;
    shapesByParent.set(parent, (shapesByParent.get(parent) ?? new Set()).add(shapeOf(note)));
  }
  const found: Element[] = [];
  for (const [parent, shapes] of shapesByParent) {
    for (const sibling of Array.from(parent.children)) {
      if (known.has(sibling) || !shapes.has(shapeOf(sibling))) continue;
      if ((sibling.textContent ?? "").trim() === "") continue;
      if (notes.some((n) => sibling.contains(n))) continue;
      found.push(sibling);
    }
  }
  return found;
}

/** An unreferenced note's own return links (to a reference that no longer
 * exists, or back into the body), recognised by their marker or glyph text. */
function orphanedReturnLinks(
  note: Element,
  notes: readonly Element[],
  document: Document,
): Set<Element> {
  const links = new Set<Element>();
  for (const a of Array.from(note.querySelectorAll("a[href]"))) {
    if (sameDocumentFragment(a, document) === null) continue;
    const text = (a.textContent ?? "").replace(/\s+/g, "");
    if (!RETURN_TEXT.test(text) && !MARKER.test(text)) continue;
    const target = targetOf(a, document);
    if (target === null || !notes.some((n) => n.contains(target))) links.add(a);
  }
  return links;
}

/** Same-page links that read as markers but are not live references (issue
 * #60): their href goes, so the marker stays plain text, never a dead link.
 * Also the forgery guard — a source link already shaped like a controlled
 * `#fn-N` reference loses its href whatever its text. */
function unlinkNonReferences(
  body: Element,
  references: ReadonlySet<Element>,
  document: Document,
): void {
  for (const link of Array.from(body.querySelectorAll("a[href]"))) {
    if (references.has(link)) continue;
    const id = sameDocumentFragment(link, document);
    if (id === null) continue;
    if (/^fn-\d+$/.test(id) || isMarkerLike(link)) link.removeAttribute("href");
  }
}

/**
 * detectLinkedFootnotes — find Footnote references by their link graph and
 * rewrite `document` in place (see the module comment). Returns the detected
 * notes' raw HTML in note order.
 */
export function detectLinkedFootnotes(document: Document): LinkedFootnotes {
  const body = document.body;
  if (!body) return { noteHtml: [], omittedCount: 0 };

  // 1. Candidate edges: reference link → note that follows it and links back.
  const refsByNote = new Map<Element, Element[]>();
  const targetsByNote = new Map<Element, Set<Element>>();
  const backLinksByNote = new Map<Element, Set<Element>>();
  for (const link of Array.from(body.querySelectorAll("a[href]"))) {
    const target = targetOf(link, document);
    if (target === null) continue;
    const note = noteContaining(target);
    if (note === null || note.contains(link) || !follows(link, note)) continue;
    const backLinks = Array.from(note.querySelectorAll("a[href]")).filter((a) =>
      isBackLinkTo(a, link, document),
    );
    // Fallback for notes that never link back: a marker-like link into a
    // recognisable notes section.
    if (backLinks.length === 0 && !(isMarkerLike(link) && inNotesSection(note, body))) continue;
    if (!refsByNote.has(note)) refsByNote.set(note, []);
    targetsByNote.set(note, (targetsByNote.get(note) ?? new Set<Element>()).add(target));
    refsByNote.get(note)!.push(link);
    const set = backLinksByNote.get(note) ?? new Set<Element>();
    for (const a of backLinks) set.add(a);
    backLinksByNote.set(note, set);
  }

  // 2. A reference inside a note is not a body reference (note-to-note
  // citations stay plain text); a note left with no body reference stays in
  // the flow untouched. Notes are numbered by note (document) order.
  // A block that several distinct targets resolve to holds several notes we
  // cannot separate: never merge them — leave them all in the flow.
  for (const [note, targets] of targetsByNote) {
    if (targets.size > 1) refsByNote.delete(note);
  }
  const allNotes = Array.from(refsByNote.keys());
  const referenced = allNotes.filter((note) => {
    const refs = refsByNote.get(note)!.filter((ref) => !allNotes.some((n) => n.contains(ref)));
    refsByNote.set(note, refs);
    return refs.length > 0;
  });
  // Issue #60: the unreferenced entries of the same notes structures are
  // notes too; every note is numbered in document order, then capped.
  const unreferenced = unreferencedSiblings(referenced);
  for (const note of unreferenced) {
    refsByNote.set(note, []);
    backLinksByNote.set(note, orphanedReturnLinks(note, referenced, document));
  }
  const found = [...referenced, ...unreferenced].sort((a, b) => (follows(a, b) ? -1 : 1));
  const notes = found.slice(0, MAX_LINKED_FOOTNOTES);
  const omitted = found.slice(MAX_LINKED_FOOTNOTES);

  const detectedRefs = new Set(notes.flatMap((note) => refsByNote.get(note)!));
  if (found.length === 0) {
    unlinkNonReferences(body, detectedRefs, document);
    return { noteHtml: [], omittedCount: 0 };
  }

  // 3. Extract each note (back-links removed), then lift every found note —
  // kept or cut by the cap — out of the flow. Containers they leave empty go
  // once per container, after all its notes are gone (not once per note: a
  // heavily annotated work would make that quadratic).
  const noteHtml: string[] = [];
  notes.forEach((note) => {
    const clone = note.cloneNode(true) as Element;
    const backLinks = backLinksByNote.get(note)!;
    // Map back-links onto the clone by their position among the note's links.
    const originals = Array.from(note.querySelectorAll("a[href]"));
    const copies = Array.from(clone.querySelectorAll("a[href]"));
    originals.forEach((a, k) => {
      if (backLinks.has(a)) copies[k]?.remove();
    });
    noteHtml.push(clone.innerHTML);
  });
  const leaving = new Set(found);
  const lastInContainer = new Map<Element | null, Element>();
  for (const note of found) lastInContainer.set(note.parentElement, note);
  const cleanups = Array.from(lastInContainer, ([container, last]) => {
    let previous = last.previousElementSibling;
    while (previous !== null && leaving.has(previous)) previous = previous.previousElementSibling;
    return { container, previous };
  });
  for (const note of found) note.remove();
  for (const { container, previous } of cleanups.reverse()) {
    removeOrphanedNotesHeading(removeEmptiedContainers(container, body) ?? previous, body);
  }

  // 4. Unlink every same-page marker left in the body that is not a kept
  // reference (forgery guard included) — after the notes leave (their own
  // back-links are theirs to drop) and before the rewrite, so ours are never
  // touched. References to notes the cap cut become plain text here.
  unlinkNonReferences(body, detectedRefs, document);

  // 5. Rewrite each reference into the controlled marker link.
  notes.forEach((note, i) => {
    for (const ref of refsByNote.get(note)!) {
      const marker = (ref.textContent ?? "").replace(/\s+/g, " ").trim();
      if (marker.length === 0) continue; // nothing visible to link — leave it
      const replacement = document.createElement("a");
      replacement.setAttribute("href", footnoteHref(i + 1));
      replacement.textContent = marker;
      // A <sup> wrapping only the reference is publisher typography the
      // renderer supplies itself.
      const parent = ref.parentElement;
      const wrapper =
        parent !== null &&
        parent.tagName.toLowerCase() === "sup" &&
        (parent.textContent ?? "").trim() === (ref.textContent ?? "").trim()
          ? parent
          : ref;
      wrapper.replaceWith(replacement);
    }
  });

  return { noteHtml, omittedCount: omitted.length };
}
