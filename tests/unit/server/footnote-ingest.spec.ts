// tests/unit/server/footnote-ingest.spec.ts
// Spec #66 / issue #55 — linked footnotes at the ingest seam (source HTML →
// canonical article). Detection follows the link graph (reference → same-page
// note that links back), never class names. Fixtures are small realistic
// source documents pinned by the canonical article they produce.
import { describe, expect, it } from "vitest";
import { extractAndNormalize } from "../../../server/htmlToBlocks";
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
