// tests/unit/server/epub-footnotes.spec.ts
// Spec #66 / issue #61 — EPUB footnotes at the ingest seam: an EPUB in,
// chapter drafts out. EPUB note markup (noteref / footnote / endnote, notes
// kept in asides) yields linked references and notes; notes kept in a
// separate Notes file are copied into each chapter that references them,
// and the Notes file stays an ordinary chapter.
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { epubToBooks, type ChapterDraft } from "../../../server/epubToBooks";
import { ingest } from "../../../server/ingest";
import { footnoteParagraphs } from "../../../src/content/footnoteBody";
import { footnoteReferenceSpans } from "../../../src/content/footnoteReferences";
import { ArticleSchema, type Block, type InlineRun } from "../../../src/content/schema";

// ── A tiny deterministic EPUB 3 builder (one document per chapter) ─────────

interface Doc {
  href: string;
  title: string;
  body: string;
  /** Set false to keep the document out of the nav TOC (a publisher split). */
  inToc?: boolean;
}

const MTIME = new Date("2026-01-01T00:00:00Z").getTime();

function xhtml(title: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
  <head><title>${title}</title></head>
  <body>
${body}
  </body>
</html>
`;
}

function buildEpub(docs: Doc[]): Uint8Array {
  const toc = docs
    .filter((d) => d.inToc !== false)
    .map((d) => `<li><a href="${d.href}">${d.title}</a></li>`)
    .join("\n");
  const nav = xhtml("Contents", `<nav epub:type="toc"><h1>Contents</h1><ol>${toc}</ol></nav>`);
  const manifest = docs
    .map((d, i) => `<item id="d${i}" href="${d.href}" media-type="application/xhtml+xml"/>`)
    .join("\n");
  const spine = docs.map((_, i) => `<itemref idref="d${i}"/>`).join("\n");
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">urn:uuid:footnote-book</dc:identifier>
    <dc:title>The Annotated Book</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>Ada Author</dc:creator>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${manifest}
  </manifest>
  <spine>
    <itemref idref="nav" linear="no"/>
${spine}
  </spine>
</package>
`;
  const entries: Record<string, [Uint8Array, { level?: 0; mtime: number }]> = {
    mimetype: [strToU8("application/epub+zip"), { level: 0, mtime: MTIME }],
    "META-INF/container.xml": [
      strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
      { mtime: MTIME },
    ],
    "content.opf": [strToU8(opf), { mtime: MTIME }],
    "nav.xhtml": [strToU8(nav), { mtime: MTIME }],
  };
  for (const d of docs) entries[d.href] = [strToU8(xhtml(d.title, d.body)), { mtime: MTIME }];
  return zipSync(entries);
}

/** Readerable filler: every chapter needs real paragraphs to be admitted. */
function prose(label: string): string {
  return [1, 2, 3]
    .map((k) => `<p>${label} filler paragraph ${k} keeps the chapter readerable.</p>`)
    .join("\n");
}

// ── Reading the canonical output ────────────────────────────────────────────

function runsText(runs: InlineRun[]): string {
  return runs.map((r) => r.text).join("");
}

function allRuns(blocks: Block[]): InlineRun[] {
  const out: InlineRun[] = [];
  for (const b of blocks) {
    if (b.kind === "paragraph" || b.kind === "heading") out.push(...b.content);
    else if (b.kind === "blockquote") out.push(...allRuns(b.children));
    else if (b.kind === "bulleted-list" || b.kind === "numbered-list") {
      for (const item of b.items) out.push(...allRuns(item.content));
    }
  }
  return out;
}

function bodyText(chapter: ChapterDraft): string {
  return chapter.blocks.map((b) => runsText(allRuns([b]))).join("\n");
}

/** The references in a chapter, as `marker→note` in document order. */
function references(chapter: ChapterDraft): string[] {
  return allRuns(chapter.blocks).flatMap((r) =>
    r.marks.flatMap((m) => (m.type === "footnote-ref" ? [`${r.text}→${m.footnoteId}`] : [])),
  );
}

/** Each note as its paragraphs' text. */
function notes(chapter: ChapterDraft): Record<string, string[]> {
  return Object.fromEntries(
    chapter.footnotes.map((fn) => [fn.id, footnoteParagraphs(fn).map(runsText)]),
  );
}

function asArticle(chapter: ChapterDraft) {
  return ArticleSchema.parse({
    id: "chapter",
    revision: 1,
    lang: chapter.lang,
    provenance: {
      title: chapter.title,
      retrievedAt: "2026-01-01T00:00:00Z",
      originalHtmlHash: chapter.sourceHtmlHash,
    },
    blocks: chapter.blocks,
    footnotes: chapter.footnotes,
  });
}

function chapterTitled(chapters: ChapterDraft[], title: string): ChapterDraft {
  const found = chapters.find((c) => c.title === title);
  if (!found) throw new Error(`no chapter titled ${title}: ${chapters.map((c) => c.title)}`);
  return found;
}

// ── In-chapter notes ────────────────────────────────────────────────────────

describe("EPUB footnotes — notes inside the chapter (#61)", () => {
  it("links noterefs to footnotes kept in asides, without back-links", async () => {
    const book = buildEpub([
      {
        href: "ch1.xhtml",
        title: "Chapter One",
        body: `<section epub:type="chapter">
<h1>Chapter One</h1>
<p>The claim<a epub:type="noteref" href="#n1">1</a> is made here.</p>
<aside epub:type="footnote" id="n1"><p>The aside's note text.</p></aside>
<p>A second claim<sup><a epub:type="noteref" href="#n2">2</a></sup> follows.</p>
<aside epub:type="footnote" id="n2"><p>Another note.</p></aside>
${prose("One")}
</section>`,
      },
    ]);
    const { chapters } = await epubToBooks(book);
    const ch = chapterTitled(chapters, "Chapter One");
    expect(references(ch)).toEqual(["1→fn-1", "2→fn-2"]);
    expect(notes(ch)).toEqual({ "fn-1": ["The aside's note text."], "fn-2": ["Another note."] });
    // The notes left the flow: they appear once, in the chapter's notes.
    expect(bodyText(ch)).not.toContain("note text");
    expect(bodyText(ch)).not.toContain("Another note");
  });

  it("links noterefs to an endnotes list at the end of the chapter", async () => {
    const book = buildEpub([
      {
        href: "ch1.xhtml",
        title: "Chapter One",
        body: `<h1>Chapter One</h1>
<p>Endnoted claim<a epub:type="noteref" href="#en1">*</a> here.</p>
${prose("One")}
<section epub:type="endnotes" role="doc-endnotes">
<ol>
<li epub:type="endnote" id="en1"><p>The endnote. <a epub:type="backlink" href="#ref-x">↩</a></p></li>
</ol>
</section>`,
      },
    ]);
    const { chapters } = await epubToBooks(book);
    const ch = chapterTitled(chapters, "Chapter One");
    expect(references(ch)).toEqual(["*→fn-1"]);
    expect(notes(ch)).toEqual({ "fn-1": ["The endnote."] });
  });

  it("keeps the paragraphs of a multi-paragraph note", async () => {
    const book = buildEpub([
      {
        href: "ch1.xhtml",
        title: "Chapter One",
        body: `<h1>Chapter One</h1>
<p>A long note<a epub:type="noteref" href="#n1">1</a> sits here.</p>
<aside epub:type="footnote" id="n1">
<p>First paragraph of the note.</p>
<p>Second paragraph of the note.</p>
<blockquote><p>A quotation inside the note.</p></blockquote>
</aside>
${prose("One")}`,
      },
    ]);
    const { chapters } = await epubToBooks(book);
    const ch = chapterTitled(chapters, "Chapter One");
    expect(notes(ch)).toEqual({
      "fn-1": [
        "First paragraph of the note.",
        "Second paragraph of the note.",
        "A quotation inside the note.",
      ],
    });
  });

  it("leaves chapters without notes exactly as before", async () => {
    const plain = `<h1>Chapter One</h1>
<p>A link to <a href="ch1.xhtml#elsewhere">another place</a> in the book.</p>
${prose("One")}`;
    const { chapters } = await epubToBooks(
      buildEpub([{ href: "ch1.xhtml", title: "Chapter One", body: plain }]),
    );
    const ch = chapterTitled(chapters, "Chapter One");
    expect(ch.footnotes).toEqual([]);
    expect(references(ch)).toEqual([]);
    expect(bodyText(ch)).toContain("A link to another place in the book.");
  });
});

// ── Notes kept in a separate Notes file ─────────────────────────────────────

const NOTES_FILE: Doc = {
  href: "notes.xhtml",
  title: "Notes",
  body: `<section epub:type="endnotes" role="doc-endnotes">
<h1>Notes</h1>
<ol>
<li id="note-1" epub:type="endnote"><p>Note one, cited by chapter one. <a href="ch1.xhtml#noteref-1" epub:type="backlink">↩</a></p></li>
<li id="note-2" epub:type="endnote"><p>Note two opens here.</p><p>Note two continues. <a href="ch1.xhtml#noteref-2" epub:type="backlink">↩</a></p></li>
<li id="note-3" epub:type="endnote"><p>Note three, cited by chapter two. <a href="ch2.xhtml#noteref-3" epub:type="backlink">↩</a></p></li>
</ol>
</section>`,
};

const SPLIT_BOOK: Doc[] = [
  {
    href: "ch1.xhtml",
    title: "Chapter One",
    body: `<h1>Chapter One</h1>
<p>First<a href="notes.xhtml#note-1" id="noteref-1" epub:type="noteref">1</a> and second<a href="notes.xhtml#note-2" id="noteref-2" epub:type="noteref">2</a> claims.</p>
${prose("One")}`,
  },
  {
    href: "ch2.xhtml",
    title: "Chapter Two",
    body: `<h1>Chapter Two</h1>
<p>Back to note two<a href="notes.xhtml#note-2" epub:type="noteref">2</a> and on to three<a href="notes.xhtml#note-3" id="noteref-3" epub:type="noteref">3</a>.</p>
${prose("Two")}`,
  },
  NOTES_FILE,
];

describe("EPUB footnotes — notes in a separate Notes file (#61)", () => {
  it("copies into each chapter the notes it references, numbered by that chapter", async () => {
    const { chapters } = await epubToBooks(buildEpub(SPLIT_BOOK));
    const one = chapterTitled(chapters, "Chapter One");
    const two = chapterTitled(chapters, "Chapter Two");

    expect(references(one)).toEqual(["1→fn-1", "2→fn-2"]);
    expect(notes(one)).toEqual({
      "fn-1": ["Note one, cited by chapter one."],
      "fn-2": ["Note two opens here.", "Note two continues."],
    });

    // Note two is cited by both chapters: chapter two carries its own copy,
    // with its back-link to chapter one removed.
    expect(references(two)).toEqual(["2→fn-1", "3→fn-2"]);
    expect(notes(two)).toEqual({
      "fn-1": ["Note two opens here.", "Note two continues."],
      "fn-2": ["Note three, cited by chapter two."],
    });
  });

  it("gives every reference a jump target and a return in its own chapter", async () => {
    const { chapters } = await epubToBooks(buildEpub(SPLIT_BOOK));
    for (const title of ["Chapter One", "Chapter Two"]) {
      const article = asArticle(chapterTitled(chapters, title));
      const noteIds = new Set(article.footnotes.map((fn) => fn.id));
      const spans = footnoteReferenceSpans(article);
      expect(spans.length).toBeGreaterThan(0);
      for (const span of spans) expect(noteIds.has(span.footnoteId)).toBe(true);
      // Every note has a reference to return to.
      for (const id of noteIds) expect(spans.some((s) => s.footnoteId === id)).toBe(true);
    }
  });

  it("keeps the Notes file in the book as an ordinary chapter", async () => {
    const { chapters } = await epubToBooks(buildEpub(SPLIT_BOOK));
    expect(chapters.map((c) => c.title)).toEqual(["Chapter One", "Chapter Two", "Notes"]);
    const notesChapter = chapterTitled(chapters, "Notes");
    expect(notesChapter.footnotes).toEqual([]);
    const text = bodyText(notesChapter);
    expect(text).toContain("Note one, cited by chapter one.");
    expect(text).toContain("Note two continues.");
    expect(text).toContain("Note three, cited by chapter two.");
  });

  it("matches notes by back-link when the book has no epub:type markup", async () => {
    const { chapters } = await epubToBooks(
      buildEpub([
        {
          href: "text/ch1.html",
          title: "Chapter One",
          body: `<h1>Chapter One</h1>
<p>A cited claim<sup><a id="r1" href="notes.html#n1">[1]</a></sup> and a local one<a href="ch1.html#local" id="r2">[2]</a>.</p>
${prose("One")}
<p class="note" id="local"><a href="#r2">[2]</a> A local note linked by its file name.</p>`,
        },
        {
          href: "text/notes.html",
          title: "Notes",
          body: `<h1>Notes</h1>
<p id="n1"><a href="ch1.html#r1">[1]</a> The Calibre-style note.</p>
<p id="n2"><a href="ch9.html#r9">[9]</a> A note no chapter here cites.</p>`,
        },
      ]),
    );
    const one = chapterTitled(chapters, "Chapter One");
    // Notes are numbered in note order: the chapter's own notes, then the
    // copies (which trail the chapter).
    expect(references(one)).toEqual(["[1]→fn-2", "[2]→fn-1"]);
    expect(notes(one)).toEqual({
      "fn-1": ["A local note linked by its file name."],
      "fn-2": ["The Calibre-style note."],
    });
    expect(bodyText(chapterTitled(chapters, "Notes"))).toContain("The Calibre-style note.");
  });

  it("does not treat an ordinary cross-chapter link as a reference", async () => {
    const { chapters } = await epubToBooks(
      buildEpub([
        {
          href: "ch1.xhtml",
          title: "Chapter One",
          body: `<h1>Chapter One</h1>
<p>As chapter <a href="ch2.xhtml#start">2</a> explains.</p>
${prose("One")}`,
        },
        {
          href: "ch2.xhtml",
          title: "Chapter Two",
          body: `<h1>Chapter Two</h1>
<p id="start">Chapter two starts with a paragraph of its own.</p>
${prose("Two")}`,
        },
      ]),
    );
    const one = chapterTitled(chapters, "Chapter One");
    expect(one.footnotes).toEqual([]);
    expect(bodyText(one)).toContain("As chapter 2 explains.");
    expect(bodyText(one)).not.toContain("starts with a paragraph");
    expect(bodyText(chapterTitled(chapters, "Chapter Two"))).toContain("starts with a paragraph");
  });

  it("numbers notes across the documents of one publisher-split chapter", async () => {
    const { chapters } = await epubToBooks(
      buildEpub([
        {
          href: "ch1a.xhtml",
          title: "Chapter One",
          body: `<h1>Chapter One</h1>
<p>Early claim<a epub:type="noteref" href="#a1">1</a> and a shared one<a href="notes.xhtml#note-2" epub:type="noteref">2</a>.</p>
<aside epub:type="footnote" id="a1"><p>The first document's own note.</p></aside>
${prose("One A")}`,
        },
        {
          href: "ch1b.xhtml",
          title: "Chapter One, continued",
          inToc: false,
          body: `<p>Later claim<a epub:type="noteref" href="#b1">1</a> and the shared one again<a href="notes.xhtml#note-2" epub:type="noteref">2</a>.</p>
<aside epub:type="footnote" id="b1"><p>The second document's own note.</p></aside>
${prose("One B")}`,
        },
        NOTES_FILE,
      ]),
    );
    const one = chapterTitled(chapters, "Chapter One");
    expect(references(one)).toEqual(["1→fn-1", "2→fn-2", "1→fn-3", "2→fn-2"]);
    expect(notes(one)).toEqual({
      "fn-1": ["The first document's own note."],
      "fn-2": ["Note two opens here.", "Note two continues."],
      "fn-3": ["The second document's own note."],
    });
    // Each occurrence keeps its own anchor identity across the documents.
    const anchors = footnoteReferenceSpans(asArticle(one)).map((s) => s.anchorId);
    expect(anchors).toEqual(["fn-ref-1", "fn-ref-2", "fn-ref-3", "fn-ref-2-2"]);
  });

  it("admits the book through the orchestrator with each chapter's notes", async () => {
    const response = await ingest({ epub: Buffer.from(buildEpub(SPLIT_BOOK)).toString("base64") });
    if (!response.ok || !("book" in response)) throw new Error(JSON.stringify(response));
    expect(response.articles.map((a) => a.provenance.title)).toEqual([
      "Chapter One",
      "Chapter Two",
      "Notes",
    ]);
    const [one, two, notesChapter] = response.articles.map((a) => ArticleSchema.parse(a));
    expect(one!.footnotes.map((fn) => footnoteParagraphs(fn).length)).toEqual([1, 2]);
    expect(two!.footnotes).toHaveLength(2);
    expect(notesChapter!.footnotes).toEqual([]);
  });
});
