// Issue #235 — component contracts for footnote rendering in the windowed
// paginated path:
//
//   1. ArticleBody's MEASUREMENT projection (blockWindow with footnote
//      fields) renders the scope's canonical rows as ID-LESS
//      <li data-footnote-index> elements — measurable, chrome-free, and
//      unable to duplicate the visible page's fn-N ids. The windowed
//      projection's footnote-reference anchors also drop their fn-ref-N
//      ids/hrefs (single exposed identifier set — criterion 6).
//   2. PageFragmentView renders footnote ENTRIES as the same accessible
//      anatomy the scrolling body uses — section[aria-label="Footnotes"] >
//      ol > li#fn-N with the ↩ back-link to #fn-ref-N — with sliced runs at
//      the entry's intra-row range and NO data-block-index (capture
//      eligibility unchanged: footnote bodies stay unmarkable).
//
// jsdom-safe: geometry is never asserted; DOM shape, ids, and text are.
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ArticleBody } from "../../src/content/render/BlockRenderer";
import { PageFragmentView } from "../../src/pagination/fragmentRenderer";
import type { Block, CanonicalArticle } from "../../src/content/types";
import type { PageFragment } from "../../src/pagination/types";
import { articleGraphemeIndex, footnoteRows, inlineText } from "../../src/content/normalizeText";

const footnotedArticle = (): CanonicalArticle => ({
  id: "footnote-render",
  revision: 1,
  lang: "en",
  provenance: {
    title: "Footnote rendering",
    retrievedAt: "2026-01-01T00:00:00Z",
    originalHtmlHash: "footnote-render-v1",
  },
  blocks: [
    {
      kind: "paragraph",
      content: [{ text: "A claim worth citing.[1]", marks: [] }],
    },
    { kind: "footnote-reference", footnoteId: "fn-1", marker: "[1]" },
  ],
  footnotes: [
    {
      id: "fn-1",
      content: [
        { text: "The ledger is ", marks: [] },
        { text: "archived", marks: [{ type: "em" }] },
        {
          text: " in the north wing, with a long enough body to slice across a page boundary when the time comes.",
          marks: [],
        },
      ],
    },
  ],
});

describe("ArticleBody — windowed footnote measurement projection", () => {
  it("renders the scope's footnote rows as id-less data-footnote-index list items", () => {
    const article = footnotedArticle();
    const { container } = render(
      <ArticleBody
        article={article}
        highlights={[]}
        blockWindow={{
          startBlock: article.blocks.length,
          endBlock: article.blocks.length,
          startFootnote: 0,
          endFootnote: 1,
        }}
      />,
    );
    const section = container.querySelector('section[aria-label="Footnotes"]');
    expect(section).not.toBeNull();
    const items = container.querySelectorAll("li[data-footnote-index]");
    expect(items).toHaveLength(1);
    // No ids, no anchors: the measurement tree cannot duplicate the visible
    // page's identifiers or add targets to them.
    expect(items[0]!.id).toBe("");
    expect(items[0]!.querySelector("a")).toBeNull();
    // The rendered text is the row's canonical text followed by the inert
    // return chrome the visible page shows (review S6).
    expect(items[0]!.textContent).toBe(`${inlineText(article.footnotes[0]!.content)} ↩`);
  });

  it("keeps the scrolling footnotes section untouched (ids + back-links)", () => {
    const article = footnotedArticle();
    const { container } = render(<ArticleBody article={article} highlights={[]} />);
    const li = container.querySelector('section[aria-label="Footnotes"] li');
    expect(li?.id).toBe("fn-1");
    expect(container.querySelector('a[href="#fn-ref-1"]')).not.toBeNull();
    expect(container.querySelector("li[data-footnote-index]")).toBeNull();
  });

  it.each(["blockquote", "bulleted-list", "numbered-list"] as const)(
    "strips reference identifiers recursively inside %s measurement rows",
    (kind) => {
      const article = footnotedArticle();
      const children: Block[] = [
        article.blocks[0]!,
        {
          kind: "blockquote",
          children: [article.blocks[1]!],
        },
      ];
      const containerBlock: Block =
        kind === "blockquote"
          ? { kind, children }
          : kind === "numbered-list"
            ? { kind, start: 3, items: [{ content: children }] }
            : { kind, items: [{ content: children }] };
      const nested = { ...article, blocks: [containerBlock] };
      const hidden = render(<ArticleBody article={nested} highlights={[]} measurementProjection />);
      expect(hidden.container.querySelector('[id^="fn-ref-"]')).toBeNull();
      expect(hidden.container.querySelector('a[href="#fn-1"]')).toBeNull();
      expect(hidden.container.querySelector("sup")?.textContent).toBe("[1]");
      hidden.unmount();

      const visible = render(<ArticleBody article={nested} highlights={[]} />);
      expect(visible.container.querySelectorAll("#fn-ref-1")).toHaveLength(1);
    },
  );

  it("drops duplicate anchor ids in the measurement projection only", () => {
    const article = footnotedArticle();
    const windowed = { startBlock: 0, endBlock: article.blocks.length };
    const { container } = render(
      <ArticleBody
        article={article}
        highlights={[]}
        blockWindow={windowed}
        measurementProjection
      />,
    );
    // The visible page is the ONLY place fn-ref-1 may exist.
    expect(container.querySelector("#fn-ref-1")).toBeNull();
    // The marker text still renders — it is the block's canonical stream.
    const sup = container.querySelector("sup");
    expect(sup?.textContent).toBe("[1]");
  });
});

describe("PageFragmentView — footnote entries", () => {
  const fragment = (article: CanonicalArticle): PageFragment => {
    const row = footnoteRows(article)[0]!;
    return {
      schemaVersion: 1,
      pageIndex: 0,
      blocks: [
        {
          blockIndex: article.blocks.length,
          footnoteIndex: row.index,
          startGrapheme: 0,
          endGrapheme: row.length,
        },
      ],
    };
  };

  it("renders the scrolling anatomy — ids, back-links, one accessible region", () => {
    const article = footnotedArticle();
    const { container } = render(
      <PageFragmentView fragment={fragment(article)} pageIndex={0} article={article} lang="en" />,
    );
    const li = container.querySelector('section[aria-label="Footnotes"] li#fn-1');
    expect(li).not.toBeNull();
    expect(li?.getAttribute("tabindex")).toBe("-1");
    const back = li?.querySelector('a[href="#fn-ref-1"]');
    expect(back?.getAttribute("aria-label")).toBe("Return to reference 1");
    // Capture ineligibility: footnote rows never carry the capture binding.
    expect(li?.hasAttribute("data-block-index")).toBe(false);
    expect(li?.getAttribute("data-footnote-index")).toBe("0");
    // The row's full canonical text renders through the content wrapper.
    expect(li?.querySelector("[data-footnote-content]")?.textContent).toBe(
      inlineText(article.footnotes[0]!.content),
    );
  });

  it("renders only the entry's intra-row slice (PAGE-03 exactly-once)", () => {
    const article = footnotedArticle();
    const row = footnoteRows(article)[0]!;
    const text = articleGraphemeIndex(article).clusters;
    const half = Math.floor(row.length / 2);
    const firstHalf: PageFragment = {
      schemaVersion: 1,
      pageIndex: 0,
      blocks: [
        {
          blockIndex: article.blocks.length,
          footnoteIndex: 0,
          startGrapheme: 0,
          endGrapheme: half,
        },
      ],
    };
    const secondHalf: PageFragment = {
      schemaVersion: 1,
      pageIndex: 0,
      blocks: [
        {
          blockIndex: article.blocks.length,
          footnoteIndex: 0,
          startGrapheme: half,
          endGrapheme: row.length,
        },
      ],
    };
    const a = render(
      <PageFragmentView fragment={firstHalf} pageIndex={0} article={article} lang="en" />,
    );
    const b = render(
      <PageFragmentView fragment={secondHalf} pageIndex={0} article={article} lang="en" />,
    ).container;
    const aText = a.container.querySelector("[data-footnote-content]")!.textContent ?? "";
    const bText = b.querySelector("[data-footnote-content]")!.textContent ?? "";
    // Both slices concatenate to the canonical row text (edge separators
    // render in no run piece); neither duplicates the other's span.
    expect((aText + bText).replace(/\s+/g, " ").trim()).toBe(
      text
        .slice(row.start, row.start + row.length)
        .join("")
        .replace(/\s+/g, " ")
        .trim(),
    );
    a.unmount();
  });
});

// ── Inline footnote references (spec #66 / issue #55) ────────────────────────

const inlineArticle = (): CanonicalArticle => ({
  id: "inline-footnote-render",
  revision: 1,
  lang: "en",
  provenance: {
    title: "Inline footnotes",
    retrievedAt: "2026-01-01T00:00:00Z",
    originalHtmlHash: "inline-footnote-render-v1",
  },
  blocks: [
    {
      kind: "paragraph",
      content: [
        { text: "The claim", marks: [] },
        { text: "1", marks: [{ type: "footnote-ref", footnoteId: "fn-1", occurrence: 1 }] },
        { text: " holds, as it did", marks: [] },
        { text: "1", marks: [{ type: "footnote-ref", footnoteId: "fn-1", occurrence: 2 }] },
        { text: " before.", marks: [] },
      ],
    },
  ],
  footnotes: [{ id: "fn-1", content: [{ text: "The note.", marks: [] }] }],
});

describe("inline footnote references (issue #55)", () => {
  it("render inside their sentence as superscript links to the note, one id per occurrence", () => {
    const { container } = render(<ArticleBody article={inlineArticle()} highlights={[]} />);
    const p = container.querySelector("p")!;
    expect(p.textContent).toBe("The claim1 holds, as it did1 before.");
    const first = p.querySelector("sup > a#fn-ref-1");
    const second = p.querySelector("sup > a#fn-ref-1-2");
    expect(first?.getAttribute("href")).toBe("#fn-1");
    expect(second?.getAttribute("href")).toBe("#fn-1");
    expect(first?.textContent).toBe("1");
    // The note's return leads back to the first reference.
    expect(container.querySelector('#fn-1 a[href="#fn-ref-1"]')).not.toBeNull();
  });

  it("the hidden measurement projection carries the marker text but no identifiers or links", () => {
    const { container } = render(
      <ArticleBody article={inlineArticle()} highlights={[]} measurementProjection />,
    );
    expect(container.querySelector('[id^="fn-"]')).toBeNull();
    expect(container.querySelector('a[href^="#fn-"]')).toBeNull();
    expect(container.querySelector("p")!.textContent).toBe("The claim1 holds, as it did1 before.");
    expect(container.querySelectorAll("p sup")).toHaveLength(2);
  });

  it("a paged fragment renders the same reference anchor", () => {
    const article = inlineArticle();
    const page: PageFragment = {
      schemaVersion: 1,
      pageIndex: 0,
      blocks: [
        {
          blockIndex: 0,
          startGrapheme: 0,
          endGrapheme: articleGraphemeIndex(article).perBlockLengths[0]!,
        },
      ],
    };
    const { container } = render(
      <PageFragmentView fragment={page} pageIndex={0} article={article} lang="en" />,
    );
    expect(container.querySelector('sup > a#fn-ref-1[href="#fn-1"]')).not.toBeNull();
    expect(container.querySelector('sup > a#fn-ref-1-2[href="#fn-1"]')).not.toBeNull();
  });
});

// ── One return per reference + screen-reader labels (spec #66 / issue #57) ───

describe("footnote returns and labels (issue #57)", () => {
  const returnsOf = (root: ParentNode, noteId: string) =>
    [...root.querySelectorAll<HTMLAnchorElement>(`#${noteId} a[href^="#fn-ref-"]`)].map((a) => ({
      href: a.getAttribute("href"),
      text: a.textContent,
      label: a.getAttribute("aria-label"),
    }));

  it("a note cited twice shows the plain return plus one labelled return per reference", () => {
    const { container } = render(<ArticleBody article={inlineArticle()} highlights={[]} />);
    expect(returnsOf(container, "fn-1")).toEqual([
      { href: "#fn-ref-1", text: "↩", label: "Return from note 1" },
      { href: "#fn-ref-1", text: "a", label: "Return to reference 1a" },
      { href: "#fn-ref-1-2", text: "b", label: "Return to reference 1b" },
    ]);
  });

  it("a note cited once keeps its single return", () => {
    const { container } = render(<ArticleBody article={footnotedArticle()} highlights={[]} />);
    expect(returnsOf(container, "fn-1")).toEqual([
      { href: "#fn-ref-1", text: "↩", label: "Return to reference 1" },
    ]);
  });

  it("the paged note entry renders the same returns", () => {
    const article = inlineArticle();
    const row = footnoteRows(article)[0]!;
    const page: PageFragment = {
      schemaVersion: 1,
      pageIndex: 0,
      blocks: [
        {
          blockIndex: article.blocks.length,
          footnoteIndex: row.index,
          startGrapheme: 0,
          endGrapheme: row.length,
        },
      ],
    };
    const { container } = render(
      <PageFragmentView fragment={page} pageIndex={0} article={article} lang="en" />,
    );
    expect(returnsOf(container, "fn-1").map((r) => r.label)).toEqual([
      "Return from note 1",
      "Return to reference 1a",
      "Return to reference 1b",
    ]);
  });

  it("the hidden measurement projection mirrors the return chrome without links", () => {
    const { container } = render(
      <ArticleBody article={inlineArticle()} highlights={[]} measurementProjection />,
    );
    const li = container.querySelector('section[aria-label="Footnotes"] li')!;
    expect(li.querySelector("a")).toBeNull();
    expect(li.textContent).toBe("The note. ↩ a b");
  });

  it("announces each marker as a footnote link with its number", () => {
    const { container } = render(<ArticleBody article={inlineArticle()} highlights={[]} />);
    expect(container.querySelector("#fn-ref-1")?.getAttribute("aria-label")).toBe("Footnote 1");
    expect(container.querySelector("#fn-ref-1-2")?.getAttribute("aria-label")).toBe("Footnote 1");
    const legacy = render(<ArticleBody article={footnotedArticle()} highlights={[]} />);
    expect(legacy.container.querySelector("#fn-ref-1")?.getAttribute("aria-label")).toBe(
      "Footnote [1]",
    );
  });

  it("the scrolling note can take focus when a reference is followed", () => {
    const { container } = render(<ArticleBody article={inlineArticle()} highlights={[]} />);
    expect(container.querySelector("li#fn-1")?.getAttribute("tabindex")).toBe("-1");
  });
});

// ── Footnotes with several paragraphs (spec #66 / issue #59) ─────────────────

const multiParagraphArticle = (): CanonicalArticle => ({
  id: "multi-paragraph-notes",
  revision: 1,
  lang: "en",
  provenance: {
    title: "Long notes",
    retrievedAt: "2026-01-01T00:00:00Z",
    originalHtmlHash: "multi-paragraph-notes-v1",
  },
  blocks: [
    {
      kind: "paragraph",
      content: [
        { text: "The claim", marks: [] },
        { text: "1", marks: [{ type: "footnote-ref", footnoteId: "fn-1", occurrence: 1 }] },
        { text: " holds.", marks: [] },
      ],
    },
  ],
  footnotes: [
    {
      id: "fn-1",
      content: [{ text: "The first paragraph of the note.", marks: [] }],
      laterParagraphs: [
        [
          { text: "The second paragraph, ", marks: [] },
          { text: "quoted", marks: [{ type: "em" }] },
        ],
        [{ text: "The closing paragraph.", marks: [] }],
      ],
    },
  ],
});

const NOTE_PARAGRAPHS = [
  "The first paragraph of the note.",
  "The second paragraph, quoted",
  "The closing paragraph.",
];

describe("footnotes with several paragraphs (issue #59)", () => {
  it("the scrolling notes section renders each paragraph as a paragraph, then the return", () => {
    const { container } = render(<ArticleBody article={multiParagraphArticle()} highlights={[]} />);
    const li = container.querySelector('section[aria-label="Footnotes"] li#fn-1')!;
    expect(Array.from(li.querySelectorAll("p"), (p) => p.textContent)).toEqual(NOTE_PARAGRAPHS);
    expect(li.querySelector("blockquote")).toBeNull();
    expect(li.querySelector("p em")?.textContent).toBe("quoted");
    const back = li.querySelector('a[href="#fn-ref-1"]');
    expect(back?.getAttribute("aria-label")).toBe("Return to reference 1");
    // The return follows the note's text — it is not inside a paragraph.
    expect(back?.closest("p")).toBeNull();
  });

  it("the windowed measurement rows render the same paragraphs, id-less", () => {
    const article = multiParagraphArticle();
    const { container } = render(
      <ArticleBody
        article={article}
        highlights={[]}
        blockWindow={{
          startBlock: article.blocks.length,
          endBlock: article.blocks.length,
          startFootnote: 0,
          endFootnote: 1,
        }}
      />,
    );
    const li = container.querySelector("li[data-footnote-index]")!;
    expect(li.id).toBe("");
    expect(Array.from(li.querySelectorAll("p"), (p) => p.textContent)).toEqual(NOTE_PARAGRAPHS);
  });

  it("a note split across pages renders each page's paragraphs exactly once", () => {
    const article = multiParagraphArticle();
    const row = footnoteRows(article)[0]!;
    // Cut inside the second paragraph ("The second | paragraph, quoted").
    const cut = "The first paragraph of the note.\nThe second".length;
    const entryPage = (start: number, end: number): PageFragment => ({
      schemaVersion: 1,
      pageIndex: 0,
      blocks: [
        {
          blockIndex: article.blocks.length,
          footnoteIndex: 0,
          startGrapheme: start,
          endGrapheme: end,
        },
      ],
    });
    const first = render(
      <PageFragmentView fragment={entryPage(0, cut)} pageIndex={0} article={article} lang="en" />,
    ).container;
    const second = render(
      <PageFragmentView
        fragment={entryPage(cut, row.length)}
        pageIndex={1}
        article={article}
        lang="en"
      />,
    ).container;
    const paragraphs = (c: HTMLElement) =>
      Array.from(c.querySelectorAll("[data-footnote-content] p"), (p) => p.textContent?.trim());
    expect(paragraphs(first)).toEqual(["The first paragraph of the note.", "The second"]);
    expect(paragraphs(second)).toEqual(["paragraph, quoted", "The closing paragraph."]);
    const note = second.querySelector("li#fn-1");
    expect(note?.querySelector('a[href="#fn-ref-1"]')).not.toBeNull();
  });
});

/** Note 1 is referenced; note 2 has no reference left in the body (an
 * unreferenced note, or one whose only marker was lost at ingest). */
const halfReferencedArticle = (): CanonicalArticle => ({
  ...inlineArticle(),
  id: "half-referenced",
  footnotes: [
    { id: "fn-1", content: [{ text: "The note.", marks: [] }] },
    { id: "fn-2", content: [{ text: "Nobody cites this note.", marks: [] }] },
  ],
});

describe("a note with no reference (issue #60)", () => {
  it("is listed in the scrolling notes without a return that leads nowhere", () => {
    const { container } = render(<ArticleBody article={halfReferencedArticle()} highlights={[]} />);
    const note = container.querySelector("li#fn-2");
    expect(note?.textContent).toContain("Nobody cites this note.");
    expect(note?.querySelector("a")).toBeNull();
    expect(container.querySelector('a[href="#fn-ref-2"]')).toBeNull();
    // The referenced note keeps its return.
    expect(container.querySelector('#fn-1 a[href="#fn-ref-1"]')).not.toBeNull();
  });

  it("carries no return glyph in the hidden measurement rows either", () => {
    const { container } = render(
      <ArticleBody article={halfReferencedArticle()} highlights={[]} measurementProjection />,
    );
    const items = container.querySelectorAll('section[aria-label="Footnotes"] li');
    expect(items[0]?.textContent).toContain("↩");
    expect(items[1]?.textContent).not.toContain("↩");
  });

  it("is listed on its page without a return", () => {
    const article = halfReferencedArticle();
    const row = footnoteRows(article)[1]!;
    const page: PageFragment = {
      schemaVersion: 1,
      pageIndex: 0,
      blocks: [
        {
          blockIndex: article.blocks.length,
          footnoteIndex: row.index,
          startGrapheme: 0,
          endGrapheme: row.length,
        },
      ],
    };
    const { container } = render(
      <PageFragmentView fragment={page} pageIndex={0} article={article} lang="en" />,
    );
    const note = container.querySelector("li#fn-2");
    expect(note?.textContent).toContain("Nobody cites this note.");
    expect(note?.querySelector("a")).toBeNull();
  });
});

// ── Review fixes (spec #66 review H1/H2) ─────────────────────────────────────

describe("reference anchor ids stay unique and live (review H1/H2)", () => {
  const twiceLegacy = (): CanonicalArticle => ({
    ...footnotedArticle(),
    blocks: [
      { kind: "paragraph", content: [{ text: "A claim worth citing.", marks: [] }] },
      { kind: "footnote-reference", footnoteId: "fn-1", marker: "[1]" },
      { kind: "paragraph", content: [{ text: "Cited again here.", marks: [] }] },
      { kind: "footnote-reference", footnoteId: "fn-1", marker: "[1]" },
    ],
  });

  it("a legacy note cited twice gives each reference its own id, and every return a live target", () => {
    const { container } = render(<ArticleBody article={twiceLegacy()} highlights={[]} />);
    const ids = [...container.querySelectorAll('[id^="fn-ref-"]')].map((el) => el.id);
    expect(ids).toEqual(["fn-ref-1", "fn-ref-1-2"]);
    const note = container.querySelector("#fn-1")!;
    for (const a of note.querySelectorAll<HTMLAnchorElement>('a[href^="#fn-ref-"]')) {
      expect(
        container.querySelector(a.getAttribute("href")!),
        a.getAttribute("href")!,
      ).not.toBeNull();
    }
  });

  it("a paged legacy reference uses the same occurrence id", () => {
    const article = twiceLegacy();
    const lengths = articleGraphemeIndex(article).perBlockLengths;
    const page: PageFragment = {
      schemaVersion: 1,
      pageIndex: 0,
      blocks: [2, 3].map((blockIndex) => ({
        blockIndex,
        startGrapheme: 0,
        endGrapheme: lengths[blockIndex]!,
      })),
    };
    const { container } = render(
      <PageFragmentView fragment={page} pageIndex={0} article={article} lang="en" />,
    );
    expect(container.querySelector("#fn-ref-1-2")).not.toBeNull();
    expect(container.querySelector("#fn-ref-1")).toBeNull();
  });

  it("a highlight that splits a marker keeps the reference id on one element", () => {
    const article: CanonicalArticle = {
      ...footnotedArticle(),
      blocks: [
        {
          kind: "paragraph",
          content: [
            { text: "The claim", marks: [] },
            { text: "12", marks: [{ type: "footnote-ref", footnoteId: "fn-12", occurrence: 1 }] },
            { text: " holds.", marks: [] },
          ],
        },
      ],
      footnotes: [{ id: "fn-12", content: [{ text: "Note twelve.", marks: [] }] }],
    };
    const { container } = render(
      <ArticleBody
        article={article}
        highlights={[
          { id: "h1", position: { start: 10, end: 14 }, hasNote: false, status: "confident" },
        ]}
      />,
    );
    expect(container.querySelector("mark.highlight")).not.toBeNull();
    expect(container.querySelectorAll('[id="fn-ref-12"]')).toHaveLength(1);
    // Both halves still link to the note.
    expect(container.querySelectorAll('p a[href="#fn-12"]')).toHaveLength(2);
  });
});

// Spec #66 review S6 (story 43) — the windowed measurement rows mirror the
// visible paged note, return chrome included, so a near-full last line that
// wraps "↩ a b" is measured; the hidden rows still expose no ids or links.
describe("windowed note measurement rows carry the return chrome (review S6)", () => {
  it("renders the returns as plain text after the note, id- and link-free", () => {
    const article = inlineArticle();
    const { container } = render(
      <ArticleBody
        article={article}
        highlights={[]}
        measurementProjection
        blockWindow={{
          startBlock: article.blocks.length,
          endBlock: article.blocks.length,
          startFootnote: 0,
          endFootnote: 1,
        }}
      />,
    );
    const li = container.querySelector("li[data-footnote-index]")!;
    expect(li.textContent).toBe("The note. ↩ a b");
    expect(li.querySelector("a")).toBeNull();
    expect(container.querySelector('[id^="fn-"]')).toBeNull();
  });
});
