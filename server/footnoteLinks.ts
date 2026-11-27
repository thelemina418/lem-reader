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
// Unmatched markers and notes nothing references are left exactly where they
// were (the pre-#55 behaviour — no content is dropped).

/** Notes beyond this are left in the body flow, unextracted. Issue #60 owns
 * the visible over-cap disclosure and flagged admission (ADR 0003). */
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
  return target.contains(reference) && INLINE_WRAPPERS.has(target.tagName.toLowerCase());
}

function follows(a: Element, b: Element): boolean {
  return (a.compareDocumentPosition(b) & 4) /* DOCUMENT_POSITION_FOLLOWING */ !== 0;
}

/** Content a container must keep even when it carries no text. */
const NON_TEXT_CONTENT = "img, figure, picture, video, audio, iframe, table, pre, svg, math";

/** After a note leaves its list, remove the containers it leaves empty (the
 * list itself, a notes section holding only an <hr>), stopping at the body
 * and at anything that still carries text or media. */
function removeEmptiedContainers(start: Element | null, body: Element): void {
  let node = start;
  while (
    node !== null &&
    node !== body &&
    (node.textContent ?? "").trim() === "" &&
    node.querySelector(NON_TEXT_CONTENT) === null
  ) {
    const parent = node.parentElement;
    node.remove();
    node = parent;
  }
}

/**
 * detectLinkedFootnotes — find Footnote references by their link graph and
 * rewrite `document` in place (see the module comment). Returns the detected
 * notes' raw HTML in note order.
 */
export function detectLinkedFootnotes(document: Document): LinkedFootnotes {
  const body = document.body;
  if (!body) return { noteHtml: [] };

  // 1. Candidate edges: reference link → note that follows it and links back.
  const refsByNote = new Map<Element, Element[]>();
  const backLinksByNote = new Map<Element, Set<Element>>();
  for (const link of Array.from(body.querySelectorAll("a[href]"))) {
    const target = targetOf(link, document);
    if (target === null) continue;
    const note = target.tagName.toLowerCase() === "li" ? target : target.closest("li");
    if (note === null || note.contains(link) || !follows(link, note)) continue;
    const backLinks = Array.from(note.querySelectorAll("a[href]")).filter((a) =>
      isBackLinkTo(a, link, document),
    );
    if (backLinks.length === 0) continue;
    if (!refsByNote.has(note)) refsByNote.set(note, []);
    refsByNote.get(note)!.push(link);
    const set = backLinksByNote.get(note) ?? new Set<Element>();
    for (const a of backLinks) set.add(a);
    backLinksByNote.set(note, set);
  }

  // 2. A reference inside a note is not a body reference (note-to-note
  // citations stay plain text); a note left with no body reference stays in
  // the flow untouched. Notes are numbered by note (document) order.
  const allNotes = Array.from(refsByNote.keys());
  const notes = allNotes
    .filter((note) => {
      const refs = refsByNote.get(note)!.filter((ref) => !allNotes.some((n) => n.contains(ref)));
      refsByNote.set(note, refs);
      return refs.length > 0;
    })
    .sort((a, b) => (follows(a, b) ? -1 : 1))
    .slice(0, MAX_LINKED_FOOTNOTES);
  if (notes.length === 0) return { noteHtml: [] };

  // 3. Neutralize source links that already look like controlled references
  // (forgery guard) — before any rewrite, so ours are never touched.
  const detectedRefs = new Set(notes.flatMap((note) => refsByNote.get(note)!));
  for (const link of Array.from(body.querySelectorAll("a[href]"))) {
    if (detectedRefs.has(link)) continue;
    const id = sameDocumentFragment(link, document);
    if (id !== null && /^fn-\d+$/.test(id)) link.removeAttribute("href");
  }

  // 4. Extract each note (back-links removed), then lift it out of the flow.
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
    const list = note.parentElement;
    note.remove();
    removeEmptiedContainers(list, body);
  });

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

  return { noteHtml };
}
