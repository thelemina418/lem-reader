// tests/unit/server/footnote-ingest.spec.ts
// Spec #66 / issue #55 — linked footnotes at the ingest seam (source HTML →
// canonical article). Detection follows the link graph (reference → same-page
// note that links back), never class names. Fixtures are small realistic
// source documents pinned by the canonical article they produce.
import { describe, expect, it } from "vitest";
import { extractAndNormalize } from "../../../server/htmlToBlocks";
import { ingest as ingestRequest } from "../../../server/ingest";
import { ArticleSchema } from "../../../src/content/schema";
import { normalizeText } from "../../../src/content/normalizeText";

const FILLER =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam quis nostrud exercitation ullamco laboris.";

/** Pandoc's own footnote output (pandoc 3, `--to html5`), class and role
 * attributes included exactly as pandoc writes them. */
const PANDOC_HTML = `<!doctype html>
<html lang="en">
<head><title>An essay with notes</title></head>
<body>
<article>
  <h1>An essay with notes</h1>
  <p>${FILLER}</p>
  <p>The claim<a href="#fn1" class="footnote-ref" id="fnref1" role="doc-noteref"><sup>1</sup></a> holds up. ${FILLER}</p>
  <p>A second point<a href="#fn2" class="footnote-ref" id="fnref2" role="doc-noteref"><sup>2</sup></a> follows. ${FILLER}</p>
  <section id="footnotes" class="footnotes footnotes-end-of-document" role="doc-endnotes">
    <hr />
    <ol>
      <li id="fn1"><p>The first note’s text.<a href="#fnref1" class="footnote-back" role="doc-backlink">↩︎</a></p></li>
      <li id="fn2"><p>The second note’s text.<a href="#fnref2" class="footnote-back" role="doc-backlink">↩︎</a></p></li>
    </ol>
  </section>
</article>
</body>
</html>`;

async function ingest(html: string, url: string | undefined = "https://example.com/essay") {
  const result = await extractAndNormalize(html, url);
  return { result, article: canonical(result) };
}

function canonical(result: Awaited<ReturnType<typeof extractAndNormalize>>) {
  return ArticleSchema.parse({
    id: "essay",
    revision: 1,
    lang: result.lang,
    provenance: {
      title: "An essay with notes",
      retrievedAt: "2026-11-27T00:00:00Z",
      originalHtmlHash: "test",
    },
    blocks: result.blocks,
    footnotes: result.footnotes,
  });
}

describe("linked footnotes — Pandoc-style HTML (issue #55)", () => {
  it("keeps the marker inline in its sentence as a footnote reference", async () => {
    const { article } = await ingest(PANDOC_HTML);
    const paragraph = article.blocks.find(
      (b) => b.kind === "paragraph" && b.content.some((r) => r.text.includes("holds up")),
    );
    expect(paragraph).toBeDefined();
    if (paragraph?.kind !== "paragraph") throw new Error("unreachable");
    expect(paragraph.content.slice(0, 3)).toEqual([
      { text: "The claim", marks: [] },
      { text: "1", marks: [{ type: "footnote-ref", footnoteId: "fn-1", occurrence: 1 }] },
      { text: expect.stringMatching(/^ holds up\. /), marks: [] },
    ]);
  });

  it("lists the notes once, in note order, without their back-link glyphs", async () => {
    const { article } = await ingest(PANDOC_HTML);
    expect(article.footnotes).toEqual([
      { id: "fn-1", content: [{ text: "The first note’s text.", marks: [] }] },
      { id: "fn-2", content: [{ text: "The second note’s text.", marks: [] }] },
    ]);
    const text = normalizeText(article);
    expect(text.split("The first note’s text.")).toHaveLength(2); // exactly once
    expect(text).not.toMatch(/[↩↩]/);
    // No duplicate notes list left in the body.
    expect(article.blocks.some((b) => b.kind === "numbered-list")).toBe(false);
  });

  it("never produces the legacy block-level reference", async () => {
    const { article } = await ingest(PANDOC_HTML);
    expect(JSON.stringify(article.blocks)).not.toContain('"footnote-reference"');
  });

  it("paste input (no URL) detects the same footnotes", async () => {
    const fromUrl = await ingest(PANDOC_HTML);
    const pasted = await ingest(PANDOC_HTML, undefined);
    expect(pasted.article.blocks).toEqual(fromUrl.article.blocks);
    expect(pasted.article.footnotes).toEqual(fromUrl.article.footnotes);
  });

  it("numbers notes by note order and counts each reference occurrence", async () => {
    // Notes referenced out of order, one note cited twice.
    const html = `<!doctype html><html lang="en"><head><title>T</title></head><body><article>
      <h1>T</h1>
      <p>${FILLER}</p>
      <p>Later note first<a href="#n-b" id="r-b1"><sup>b</sup></a>. ${FILLER}</p>
      <p>Then the early note<a href="#n-a" id="r-a"><sup>a</sup></a> and b again<a href="#n-b" id="r-b2"><sup>b</sup></a>. ${FILLER}</p>
      <section><ol>
        <li id="n-a">Note A. <a href="#r-a">↩</a></li>
        <li id="n-b">Note B. <a href="#r-b1">↩</a> <a href="#r-b2">↩</a></li>
      </ol></section>
    </article></body></html>`;
    const { article } = await ingest(html);
    const refs = article.blocks.flatMap((b) =>
      b.kind === "paragraph"
        ? b.content.flatMap((r) => r.marks.filter((m) => m.type === "footnote-ref"))
        : [],
    );
    expect(refs).toEqual([
      { type: "footnote-ref", footnoteId: "fn-2", occurrence: 1 },
      { type: "footnote-ref", footnoteId: "fn-1", occurrence: 1 },
      { type: "footnote-ref", footnoteId: "fn-2", occurrence: 2 },
    ]);
    expect(article.footnotes.map((f) => f.content[0]!.text)).toEqual(["Note A.", "Note B."]);
  });

  it("a same-page link whose target does not link back stays ordinary text", async () => {
    const html = `<!doctype html><html lang="en"><head><title>T</title></head><body><article>
      <h1>T</h1>
      <p>See <a href="#later">the later section</a> for more. ${FILLER}</p>
      <h2 id="later">Later</h2>
      <p>${FILLER}</p>
      <ol><li id="fake-fn">A list item that links nowhere. ${FILLER}</li><li>Another item. ${FILLER}</li></ol>
      <p>Also <a href="#fake-fn">this</a> and a forged <a href="#fn-1">fn-1 link</a>. ${FILLER}</p>
    </article></body></html>`;
    const { article } = await ingest(html);
    expect(article.footnotes).toEqual([]);
    expect(JSON.stringify(article.blocks)).not.toContain("footnote-ref");
    expect(normalizeText(article)).toContain("Also this and a forged fn-1 link.");
  });

  it("an article without footnotes ingests exactly as before", async () => {
    const html = `<!doctype html><html lang="en"><head><title>T</title></head><body><article>
      <h1>T</h1><p>${FILLER}</p><p>Plain <a href="https://example.com/x">link</a>. ${FILLER}</p>
    </article></body></html>`;
    const { article } = await ingest(html);
    expect(article.footnotes).toEqual([]);
    expect(article.blocks).toEqual([
      // (Readability drops the title-duplicating h1, as it always has.)
      { kind: "paragraph", content: [{ text: FILLER, marks: [] }] },
      {
        kind: "paragraph",
        content: [
          { text: "Plain ", marks: [] },
          { text: "link", marks: [{ type: "link", href: "https://example.com/x" }] },
          { text: `. ${FILLER}`, marks: [] },
        ],
      },
    ]);
  });
});

describe("notes with several paragraphs (issue #59)", () => {
  const SCHOLARLY_HTML = `<!doctype html><html lang="en"><head><title>T</title></head><body><article>
    <h1>T</h1>
    <p>${FILLER}</p>
    <p>A long-noted claim<a href="#fn1" id="fnref1"><sup>1</sup></a> stands. ${FILLER}</p>
    <p>A short-noted claim<a href="#fn2" id="fnref2"><sup>2</sup></a> too. ${FILLER}</p>
    <section class="footnotes"><ol>
      <li id="fn1">
        <p>The note opens with <em>context</em>.</p>
        <blockquote><p>A quoted source line.</p><p>Its second line.</p></blockquote>
        <ul><li>First listed point;</li><li>second listed point.</li></ul>
        <p>The note closes.<a href="#fnref1">↩︎</a></p>
      </li>
      <li id="fn2"><p>A one-paragraph note.<a href="#fnref2">↩︎</a></p></li>
    </ol></section>
  </article></body></html>`;

  it("keeps a note's paragraphs, flattening its quotation and list into paragraphs", async () => {
    const { article } = await ingest(SCHOLARLY_HTML);
    expect(article.footnotes[0]).toEqual({
      id: "fn-1",
      content: [
        { text: "The note opens with ", marks: [] },
        { text: "context", marks: [{ type: "em" }] },
        { text: ".", marks: [] },
      ],
      laterParagraphs: [
        [{ text: "A quoted source line.", marks: [] }],
        [{ text: "Its second line.", marks: [] }],
        [{ text: "First listed point;", marks: [] }],
        [{ text: "second listed point.", marks: [] }],
        [{ text: "The note closes.", marks: [] }],
      ],
    });
  });

  it("a one-paragraph note keeps today's single-content shape", async () => {
    const { article } = await ingest(SCHOLARLY_HTML);
    expect(article.footnotes[1]).toEqual({
      id: "fn-2",
      content: [{ text: "A one-paragraph note.", marks: [] }],
    });
  });

  it("joins a note's paragraphs with the block separator in the normalized text", async () => {
    const { article } = await ingest(SCHOLARLY_HTML);
    expect(normalizeText(article)).toContain(
      [
        "The note opens with context .", // (runs join with one space — the D-05 rule)
        "A quoted source line.",
        "Its second line.",
        "First listed point;",
        "second listed point.",
        "The note closes.",
        "A one-paragraph note.",
      ].join("\n"),
    );
  });

  it("a back-link in its own trailing paragraph leaves no empty paragraph", async () => {
    const html = `<!doctype html><html lang="en"><head><title>T</title></head><body><article>
      <h1>T</h1><p>${FILLER}</p>
      <p>Claim<a href="#n1" id="r1"><sup>1</sup></a> here. ${FILLER}</p>
      <ol><li id="n1"><p>One.</p><p>Two.</p><p><a href="#r1">↩</a></p></li></ol>
    </article></body></html>`;
    const { article } = await ingest(html);
    expect(article.footnotes).toEqual([
      {
        id: "fn-1",
        content: [{ text: "One.", marks: [] }],
        laterParagraphs: [[{ text: "Two.", marks: [] }]],
      },
    ]);
  });
});

/** Collect every footnote-ref mark in the body, in document order. */
function refMarks(article: ReturnType<typeof canonical>) {
  return JSON.parse(JSON.stringify(article.blocks), (_k, v) => v).flatMap(function walk(
    node: unknown,
  ): unknown[] {
    if (Array.isArray(node)) return node.flatMap(walk);
    if (node === null || typeof node !== "object") return [];
    const o = node as Record<string, unknown>;
    if (typeof o.text === "string" && Array.isArray(o.marks)) {
      return (o.marks as { type: string }[])
        .filter((m) => m.type === "footnote-ref")
        .map((m) => ({ marker: o.text, ...m }));
    }
    return Object.values(o).flatMap(walk);
  });
}

function noteTexts(article: ReturnType<typeof canonical>): string[] {
  return article.footnotes.map((f) => f.content.map((r) => r.text).join(""));
}

/** MediaWiki's parser output (Cite extension), trimmed to one section: a
 * cited-once note with a "^" back-link, a cited-twice note with "^ a b"
 * back-links, the modern `mw-heading` wrapper, and the reflist container. */
const WIKIPEDIA_HTML = `<!doctype html>
<html lang="en">
<head><title>Lighthouse - Wikipedia</title></head>
<body>
<main id="content"><div id="bodyContent"><div id="mw-content-text" class="mw-body-content"><div class="mw-content-ltr mw-parser-output" lang="en" dir="ltr">
  <p>A <b>lighthouse</b> is a tower designed to emit light.<sup id="cite_ref-1" class="reference"><a href="#cite_note-1"><span class="cite-bracket">&#91;</span>1<span class="cite-bracket">&#93;</span></a></sup> ${FILLER}</p>
  <p>Lighthouses mark dangerous coastlines<sup id="cite_ref-Stevenson_2-0" class="reference"><a href="#cite_note-Stevenson-2"><span class="cite-bracket">&#91;</span>2<span class="cite-bracket">&#93;</span></a></sup> and safe entries to harbours.<sup id="cite_ref-Stevenson_2-1" class="reference"><a href="#cite_note-Stevenson-2"><span class="cite-bracket">&#91;</span>2<span class="cite-bracket">&#93;</span></a></sup> ${FILLER}</p>
  <p>${FILLER}</p>
  <div class="mw-heading mw-heading2"><h2 id="References">References</h2></div>
  <div class="reflist">
    <div class="mw-references-wrap"><ol class="references">
      <li id="cite_note-1"><span class="mw-cite-backlink"><b><a href="#cite_ref-1">^</a></b></span> <span class="reference-text">Smith, J. (2001). <i>Lights at Sea</i>. Harbour Press.</span></li>
      <li id="cite_note-Stevenson-2"><span class="mw-cite-backlink">^ <a href="#cite_ref-Stevenson_2-0"><sup><i><b>a</b></i></sup></a> <a href="#cite_ref-Stevenson_2-1"><sup><i><b>b</b></i></sup></a></span> <span class="reference-text">Stevenson, A. (1850). <i>Lighthouse Illumination</i>.</span></li>
    </ol></div>
  </div>
</div></div></div></main>
</body>
</html>`;

describe("linked footnotes — Wikipedia citation notes (issue #56)", () => {
  it("links each bracketed citation marker inline", async () => {
    const { article } = await ingest(WIKIPEDIA_HTML, "https://en.wikipedia.org/wiki/Lighthouse");
    expect(refMarks(article)).toEqual([
      { marker: "[1]", type: "footnote-ref", footnoteId: "fn-1", occurrence: 1 },
      { marker: "[2]", type: "footnote-ref", footnoteId: "fn-2", occurrence: 1 },
      { marker: "[2]", type: "footnote-ref", footnoteId: "fn-2", occurrence: 2 },
    ]);
  });

  it("lists the notes without the leading caret or back-link letters", async () => {
    const { article } = await ingest(WIKIPEDIA_HTML, "https://en.wikipedia.org/wiki/Lighthouse");
    expect(noteTexts(article)).toEqual([
      "Smith, J. (2001). Lights at Sea. Harbour Press.",
      "Stevenson, A. (1850). Lighthouse Illumination.",
    ]);
    const text = normalizeText(article);
    expect(text).not.toContain("^");
  });

  it("leaves no empty References heading or duplicate list in the body", async () => {
    const { article } = await ingest(WIKIPEDIA_HTML, "https://en.wikipedia.org/wiki/Lighthouse");
    expect(article.blocks.map((b) => b.kind)).toEqual(["paragraph", "paragraph", "paragraph"]);
  });
});

/** Substack's post body markup (FootnoteAnchorToDOM / FootnoteToDOM): the
 * note's own number is its back-link, and notes are divs, not list items. */
const SUBSTACK_HTML = `<!doctype html>
<html lang="en">
<head><title>On harbours</title></head>
<body>
<div class="available-content"><div dir="auto" class="body markup">
  <p>${FILLER}</p>
  <p>Harbours were built for trade<a class="footnote-anchor" data-component-name="FootnoteAnchorToDOM" id="footnote-anchor-1" href="#footnote-1" target="_self">1</a>, not for comfort. ${FILLER}</p>
  <p>Later the navy arrived<a class="footnote-anchor" data-component-name="FootnoteAnchorToDOM" id="footnote-anchor-2" href="#footnote-2" target="_self">2</a>. ${FILLER}</p>
  <div class="footnote" data-component-name="FootnoteToDOM"><a id="footnote-1" href="#footnote-anchor-1" class="footnote-number" contenteditable="false" target="_self">1</a><div class="footnote-content"><p>Mostly grain and timber.</p></div></div>
  <div class="footnote" data-component-name="FootnoteToDOM"><a id="footnote-2" href="#footnote-anchor-2" class="footnote-number" contenteditable="false" target="_self">2</a><div class="footnote-content"><p>In 1805, after the blockade.</p></div></div>
</div></div>
</body>
</html>`;

describe("linked footnotes — Substack footnotes (issue #56)", () => {
  it("links the references and makes the notes footnotes, not body paragraphs", async () => {
    const { article } = await ingest(SUBSTACK_HTML, "https://example.substack.com/p/on-harbours");
    expect(refMarks(article)).toEqual([
      { marker: "1", type: "footnote-ref", footnoteId: "fn-1", occurrence: 1 },
      { marker: "2", type: "footnote-ref", footnoteId: "fn-2", occurrence: 1 },
    ]);
    expect(noteTexts(article)).toEqual([
      "Mostly grain and timber.",
      "In 1805, after the blockade.",
    ]);
    expect(article.blocks).toHaveLength(3);
    expect(normalizeText(article).split("Mostly grain and timber.")).toHaveLength(2);
  });
});

describe("linked footnotes — ambiguous note containers (issue #56)", () => {
  it("never merges two notes that share one block into a single note", async () => {
    const html = `<!doctype html><html lang="en"><head><title>T</title></head><body><article>
      <h1>T</h1>
      <p>One<a href="#n1" id="r1">1</a> and two<a href="#n2" id="r2">2</a>. ${FILLER}</p>
      <p>${FILLER}</p>
      <p><span id="n1"><a href="#r1">1</a> First note.</span><br><span id="n2"><a href="#r2">2</a> Second note.</span></p>
    </article></body></html>`;
    const { article } = await ingest(html);
    expect(article.footnotes).toEqual([]);
    expect(normalizeText(article)).toContain("First note.");
    expect(normalizeText(article)).toContain("Second note.");
  });
});

/** WordPress core's Footnotes block (core/footnotes, WP 6.3+). */
const WORDPRESS_CORE_HTML = `<!doctype html>
<html lang="en">
<head><title>Garden notes</title></head>
<body>
<div class="entry-content wp-block-post-content">
  <p>${FILLER}</p>
  <p>Tomatoes want sun<sup data-fn="0d2c5a91-6a3e-4c1f-9b77-2f0c1f5f7e10" class="fn"><a href="#0d2c5a91-6a3e-4c1f-9b77-2f0c1f5f7e10" id="0d2c5a91-6a3e-4c1f-9b77-2f0c1f5f7e10-link">1</a></sup> and water. ${FILLER}</p>
  <ol class="wp-block-footnotes"><li id="0d2c5a91-6a3e-4c1f-9b77-2f0c1f5f7e10">At least six hours a day. <a href="#0d2c5a91-6a3e-4c1f-9b77-2f0c1f5f7e10-link" aria-label="Jump to footnote reference 1">↩︎</a></li></ol>
</div>
</body>
</html>`;

/** The Easy Footnotes plugin: back-links point at an empty anchor span placed
 * just before the reference, and its notes list carries a "Notes" title. */
const WORDPRESS_EASY_FOOTNOTES_HTML = `<!doctype html>
<html lang="en">
<head><title>Garden notes</title></head>
<body>
<div class="entry-content">
  <p>${FILLER}</p>
  <p>Beans climb<span id="easy-footnote-1-42" class="easy-footnote-margin-adjust"></span><span class="easy-footnote"><a href="#easy-footnote-bottom-1-42" title="Give them a pole."><sup>1</sup></a></span> quickly. ${FILLER}</p>
  <p>Peas too<span id="easy-footnote-2-42" class="easy-footnote-margin-adjust"></span><span class="easy-footnote"><a href="#easy-footnote-bottom-2-42" title="Or netting."><sup>2</sup></a></span>. ${FILLER}</p>
  <div class="easy-footnote-title"><h4>Notes</h4></div>
  <ol class="easy-footnotes-wrapper">
    <li class="easy-footnote-single"><span id="easy-footnote-bottom-1-42" class="easy-footnote-margin-adjust"></span>Give them a pole.<a class="easy-footnote-to-top" href="#easy-footnote-1-42"></a></li>
    <li class="easy-footnote-single"><span id="easy-footnote-bottom-2-42" class="easy-footnote-margin-adjust"></span>Or netting.<a class="easy-footnote-to-top" href="#easy-footnote-2-42"></a></li>
  </ol>
</div>
</body>
</html>`;

describe("linked footnotes — WordPress (issue #56)", () => {
  it("core Footnotes block: linked reference, note without its return glyph", async () => {
    const { article } = await ingest(WORDPRESS_CORE_HTML, "https://example.org/garden");
    expect(refMarks(article)).toEqual([
      { marker: "1", type: "footnote-ref", footnoteId: "fn-1", occurrence: 1 },
    ]);
    expect(noteTexts(article)).toEqual(["At least six hours a day."]);
    expect(article.blocks).toHaveLength(2);
  });

  it("Easy Footnotes plugin: back-links to the anchor beside the reference", async () => {
    const { article } = await ingest(WORDPRESS_EASY_FOOTNOTES_HTML, "https://example.org/garden");
    expect(refMarks(article)).toEqual([
      { marker: "1", type: "footnote-ref", footnoteId: "fn-1", occurrence: 1 },
      { marker: "2", type: "footnote-ref", footnoteId: "fn-2", occurrence: 1 },
    ]);
    expect(noteTexts(article)).toEqual(["Give them a pole.", "Or netting."]);
    // The plugin's "Notes" title leaves with its list.
    expect(article.blocks.map((b) => b.kind)).toEqual(["paragraph", "paragraph", "paragraph"]);
  });
});

/** A hand-written endnotes section: in-text markers link into a list under a
 * "Notes" heading, and the notes never link back. */
const NOTES_SECTION_HTML = `<!doctype html>
<html lang="en">
<head><title>A quiet history</title></head>
<body>
<article>
  <nav><a href="#notes">Jump to the notes</a></nav>
  <p>${FILLER}</p>
  <p>The archive opened in 1921<sup><a href="#note-1">1</a></sup>, and closed again in 1939.<sup><a href="#note-2">2</a></sup> ${FILLER}</p>
  <p>See <a href="#note-2">the second note</a> for the closure. ${FILLER}</p>
  <h2 id="notes">Notes</h2>
  <ol>
    <li id="note-1">Municipal records, box 4.</li>
    <li id="note-2">The war, mostly.</li>
  </ol>
</article>
</body>
</html>`;

describe("linked footnotes — notes section without back-links (issue #56)", () => {
  it("matches short markers to the notes the section holds", async () => {
    const { article } = await ingest(NOTES_SECTION_HTML);
    expect(refMarks(article)).toEqual([
      { marker: "1", type: "footnote-ref", footnoteId: "fn-1", occurrence: 1 },
      { marker: "2", type: "footnote-ref", footnoteId: "fn-2", occurrence: 1 },
    ]);
    expect(noteTexts(article)).toEqual(["Municipal records, box 4.", "The war, mostly."]);
    const text = normalizeText(article);
    // A prose link into the notes is not a marker: it stays ordinary text.
    expect(text).toContain("See the second note for the closure.");
    expect(article.blocks.some((b) => b.kind === "heading")).toBe(false);
    expect(article.blocks.some((b) => b.kind === "numbered-list")).toBe(false);
  });

  it("a list nobody calls notes is not a notes section", async () => {
    const html = NOTES_SECTION_HTML.replace(
      '<h2 id="notes">Notes</h2>',
      '<h2 id="notes">Timeline</h2>',
    );
    const { article } = await ingest(html);
    expect(article.footnotes).toEqual([]);
    expect(refMarks(article)).toEqual([]);
  });
});

describe("half-matched footnotes (issue #60)", () => {
  it("keeps a note nothing references as a note, in note order, not in the body", async () => {
    // Pandoc output where the author deleted the second marker but not its
    // note. Readability would drop the short leftover list on its own.
    const html = PANDOC_HTML.replace(
      '<a href="#fn2" class="footnote-ref" id="fnref2" role="doc-noteref"><sup>2</sup></a>',
      "",
    ).replace(
      "</ol>",
      '<li id="fn3"><p>The third note’s text.<a href="#fnref3" class="footnote-back" role="doc-backlink">↩︎</a></p></li></ol>',
    );
    const { article } = await ingest(html);
    expect(refMarks(article)).toEqual([
      { marker: "1", type: "footnote-ref", footnoteId: "fn-1", occurrence: 1 },
    ]);
    expect(noteTexts(article)).toEqual([
      "The first note’s text.",
      "The second note’s text.",
      "The third note’s text.",
    ]);
    const text = normalizeText(article);
    expect(text.split("The second note’s text.")).toHaveLength(2); // exactly once
    expect(article.blocks.some((b) => b.kind === "numbered-list")).toBe(false);
  });

  it("keeps unreferenced Substack-style notes beside the referenced ones", async () => {
    const html = SUBSTACK_HTML.replace(
      '<a class="footnote-anchor" data-component-name="FootnoteAnchorToDOM" id="footnote-anchor-2" href="#footnote-2" target="_self">2</a>',
      "",
    );
    const { article } = await ingest(html, "https://example.substack.com/p/on-harbours");
    expect(refMarks(article)).toHaveLength(1);
    expect(noteTexts(article)).toEqual([
      "Mostly grain and timber.",
      "In 1805, after the blockade.",
    ]);
    expect(normalizeText(article).split("In 1805, after the blockade.")).toHaveLength(2);
  });

  it("a marker whose note cannot be found stays plain text, never a link", async () => {
    const html = PANDOC_HTML.replace(`<p>${FILLER}</p>`, "").replace(
      "follows.",
      'follows<a href="#fn9" id="fnref9"><sup>9</sup></a> and<a href="https://example.com/essay#fn8"><sup>8</sup></a> again.',
    );
    const { article } = await ingest(html);
    expect(refMarks(article).map((r: { marker: string }) => r.marker)).toEqual(["1", "2"]);
    const json = JSON.stringify(article.blocks);
    expect(json).not.toContain("#fn9");
    expect(json).not.toContain("#fn8");
    expect(normalizeText(article)).toContain("A second point2 follows9 and8 again.");
  });

  it("a note whose only reference sits in a figure caption is still listed", async () => {
    const html = PANDOC_HTML.replace(
      `<p>${FILLER}</p>`,
      `<figure><img src="https://example.com/map.png" alt="A map"><figcaption>The map<a href="#fn2" id="fnref2b"><sup>2</sup></a>.</figcaption></figure><p>${FILLER}</p>`,
    )
      .replace(
        '<a href="#fn2" class="footnote-ref" id="fnref2" role="doc-noteref"><sup>2</sup></a>',
        "",
      )
      .replace('href="#fnref2"', 'href="#fnref2b"');
    const { article } = await ingest(html);
    expect(noteTexts(article)).toContain("The second note’s text.");
    expect(refMarks(article).map((r: { footnoteId: string }) => r.footnoteId)).not.toContain(
      "fn-2",
    );
  });

  it("keeps every note of an article with several hundred", async () => {
    const { article } = await ingest(manyNotesHtml(400));
    expect(article.footnotes).toHaveLength(400);
    expect(refMarks(article)).toHaveLength(400);
    expect(noteTexts(article)[399]).toBe("Note number 400.");
  });
});

/** A Pandoc-style article with `n` referenced notes. */
function manyNotesHtml(n: number): string {
  const refs = Array.from(
    { length: n },
    (_, i) => `Point ${i + 1}<a href="#fn${i + 1}" id="fnref${i + 1}"><sup>${i + 1}</sup></a>.`,
  ).join(" ");
  const notes = Array.from(
    { length: n },
    (_, i) => `<li id="fn${i + 1}"><p>Note number ${i + 1}.<a href="#fnref${i + 1}">↩︎</a></p></li>`,
  ).join("");
  return `<!doctype html><html lang="en"><head><title>Annotated</title></head><body><article>
    <h1>Annotated</h1><p>${FILLER}</p><p>${refs} ${FILLER}</p>
    <section role="doc-endnotes"><hr /><ol>${notes}</ol></section>
  </article></body></html>`;
}

describe("the note cap (issue #60)", () => {
  it("past about 1,000 notes, keeps the first 1,000 and admits the article flagged with the count", async () => {
    const result = await ingestRequest({ html: manyNotesHtml(1003) });
    expect(result.ok).toBe(true);
    if (!result.ok || !("article" in result)) throw new Error("unreachable");
    const { article } = result;
    expect(article.footnotes).toHaveLength(1000);
    expect(article.ingestionMeta?.extractionWarnings).toEqual([
      "3 notes past the first 1,000 could not be included",
    ]);
    // The cut notes are not in the body, and their markers are plain text.
    const text = normalizeText(article);
    expect(text).not.toContain("Note number 1001.");
    expect(text).toContain("Point 10011001.");
    expect(refMarks(article)).toHaveLength(1000);
  }, 60_000);

  it("half-matched footnotes alone never flag the article", async () => {
    const html = PANDOC_HTML.replace(
      '<a href="#fn2" class="footnote-ref" id="fnref2" role="doc-noteref"><sup>2</sup></a>',
      '<a href="#fn9"><sup>9</sup></a>',
    );
    const result = await ingestRequest({ html });
    expect(result.ok).toBe(true);
    if (!result.ok || !("article" in result)) throw new Error("unreachable");
    expect(result.article.footnotes).toHaveLength(2);
    expect(result.article.ingestionMeta?.extractionWarnings).toEqual([]);
  });
});

// Spec #66 review H3 (honesty) — a reference with no visible marker (an
// empty or image-only link) is not rewritten, but its note still leaves the
// flow; its same-page link must not stay behind pointing at nothing.
describe("a reference with no visible marker (review H3)", () => {
  it("is unlinked once its note is extracted", async () => {
    const { detectLinkedFootnotes } = await import("../../../server/footnoteLinks");
    const { JSDOM } = await import("jsdom");
    const dom = new JSDOM(
      `<!doctype html><body><article>
      <p>The claim<a href="#fn1" id="fnref1"><sup>1</sup></a> holds.</p>
      <p>A silent one<a href="#fn2" id="fnref2"><img src="https://example.com/m.png" alt=""></a> here.</p>
      <ol>
        <li id="fn1"><p>First note.<a href="#fnref1">↩</a></p></li>
        <li id="fn2"><p>Second note.<a href="#fnref2">↩</a></p></li>
      </ol>
    </article></body>`,
      { url: "https://example.com/essay" },
    );
    const found = detectLinkedFootnotes(dom.window.document);
    expect(found.noteHtml).toHaveLength(2);
    const doc = dom.window.document;
    expect(doc.querySelector("#fn2")).toBeNull(); // the note left the flow
    expect(doc.querySelector('a[href="#fn2"]')).toBeNull(); // so no link points at it
    expect(doc.querySelector("img")).not.toBeNull(); // its content stays
  });
});
