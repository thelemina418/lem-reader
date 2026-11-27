// Issue #65 — highlights in footnotes, at the capture + render seam.
//
// The reader renders the real note markup (ArticleBody's scrolling notes
// section, PageFragmentView's paged note entries); a DOM selection over it
// captures through captureSelection into canonical D-05 coordinates, and a
// highlight at those coordinates renders as a mark inside the note. jsdom is
// not layout truth — only DOM shape, text and offsets are asserted here;
// Playwright owns the creation paths (tests/e2e/pagination/footnotes.spec.ts).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ArticleBody, type ArticleBodyHighlight } from "../../src/content/render/BlockRenderer";
import { PageFragmentView } from "../../src/pagination/fragmentRenderer";
import { captureSelection } from "../../src/annotations/capture";
import { footnoteRows, normalizeText } from "../../src/content/normalizeText";
import type { CanonicalArticle } from "../../src/content/types";
import type { PageFragment } from "../../src/pagination/types";

const article = (): CanonicalArticle => ({
  id: "footnote-highlights",
  revision: 1,
  lang: "en",
  provenance: {
    title: "Footnote highlights",
    retrievedAt: "2026-01-01T00:00:00Z",
    originalHtmlHash: "footnote-highlights-v1",
  },
  blocks: [
    {
      kind: "paragraph",
      content: [
        { text: "The claim", marks: [] },
        { text: "1", marks: [{ type: "footnote-ref", footnoteId: "fn-1", occurrence: 1 }] },
        { text: " holds, and so does the second", marks: [] },
        { text: "2", marks: [{ type: "footnote-ref", footnoteId: "fn-2", occurrence: 1 }] },
        { text: ".", marks: [] },
      ],
    },
  ],
  footnotes: [
    { id: "fn-1", content: [{ text: "The ledger is archived in the north wing.", marks: [] }] },
    {
      id: "fn-2",
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

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  cleanup();
});

/** The text node holding `needle` under `root`, and needle's offset in it. */
function textPoint(root: Element, needle: string, after = false): [Text, number] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = (node as Text).data.indexOf(needle);
    if (at >= 0) return [node as Text, after ? at + needle.length : at];
  }
  throw new Error(`no text node holds ${JSON.stringify(needle)}`);
}

function select(start: [Node, number], end: [Node, number]): void {
  const range = document.createRange();
  range.setStart(...start);
  range.setEnd(...end);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

/** The canonical offset range of `needle` (first occurrence at/after `from`). */
function canonical(a: CanonicalArticle, needle: string, from = 0): { start: number; end: number } {
  const start = normalizeText(a).indexOf(needle, from);
  if (start < 0) throw new Error(`not in normalized text: ${needle}`);
  return { start, end: start + needle.length };
}

/** Per paragraph of fn-2, the text its highlight marks cover. */
function markedParagraphs(root: Element): string[] {
  return Array.from(root.querySelectorAll("li#fn-2 p"), (p) =>
    Array.from(p.querySelectorAll("mark.highlight"), (m) => m.textContent)
      .join("")
      .trim(),
  );
}

const hl = (id: string, position: { start: number; end: number }): ArticleBodyHighlight => ({
  id,
  position,
  hasNote: false,
  status: "confident",
});

describe("scrolling notes", () => {
  it("a selection inside a note captures at the note's canonical offset", () => {
    const a = article();
    const { container } = render(<ArticleBody article={a} highlights={[]} />);
    const note = container.querySelector("li#fn-1")!;
    select(textPoint(note, "archived"), textPoint(note, "north", true));
    const result = captureSelection(a, container as HTMLElement);
    const notesStart = footnoteRows(a)[0]!.start;
    expect(result).toEqual({
      ok: true,
      blockIndex: a.blocks.length,
      footnoteIndex: 0,
      position: canonical(a, "archived in the north", notesStart),
    });
  });

  it("a selection across a note's paragraphs captures one range", () => {
    const a = article();
    const { container } = render(<ArticleBody article={a} highlights={[]} />);
    const note = container.querySelector("li#fn-2")!;
    select(textPoint(note, "paragraph of"), textPoint(note, "closing", true));
    const result = captureSelection(a, container as HTMLElement);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(normalizeText(a).slice(result.position.start, result.position.end)).toBe(
      "paragraph of the note.\nThe second paragraph, quoted\nThe closing",
    );
  });

  it("an end point on the note's return clamps to the end of that note", () => {
    const a = article();
    const { container } = render(<ArticleBody article={a} highlights={[]} />);
    const note = container.querySelector("li#fn-1")!;
    const back = note.querySelector('a[href="#fn-ref-1"]')!;
    select(textPoint(note, "north"), [back.firstChild!, 1]);
    const result = captureSelection(a, container as HTMLElement);
    expect(result.ok && normalizeText(a).slice(result.position.start, result.position.end)).toBe(
      "north wing.",
    );
  });

  it("refuses a selection from the main text into a note", () => {
    const a = article();
    const { container } = render(<ArticleBody article={a} highlights={[]} />);
    const body = container.querySelector("[data-block-index='0']")!;
    const note = container.querySelector("li#fn-1")!;
    select(textPoint(body, "holds"), textPoint(note, "ledger", true));
    expect(captureSelection(a, container as HTMLElement)).toEqual({
      ok: false,
      reason: "boundary-ineligible",
    });
  });

  it("refuses a selection across two notes", () => {
    const a = article();
    const { container } = render(<ArticleBody article={a} highlights={[]} />);
    const first = container.querySelector("li#fn-1")!;
    const second = container.querySelector("li#fn-2")!;
    select(textPoint(first, "north"), textPoint(second, "first", true));
    expect(captureSelection(a, container as HTMLElement)).toEqual({
      ok: false,
      reason: "boundary-ineligible",
    });
  });

  it("renders a note highlight as a mark inside the note", () => {
    const a = article();
    const notesStart = footnoteRows(a)[0]!.start;
    const { container } = render(
      <ArticleBody article={a} highlights={[hl("h1", canonical(a, "north wing", notesStart))]} />,
    );
    const marks = container.querySelectorAll("li#fn-1 mark.highlight");
    expect(Array.from(marks, (m) => m.textContent).join("")).toBe("north wing");
    expect(container.querySelectorAll("mark.highlight")).toHaveLength(1);
  });

  it("renders a highlight spanning a note's paragraphs in each paragraph", () => {
    const a = article();
    const notesStart = footnoteRows(a)[1]!.start;
    const range = {
      start: canonical(a, "note.", notesStart).start,
      end: canonical(a, "The closing", notesStart).end,
    };
    const { container } = render(<ArticleBody article={a} highlights={[hl("h2", range)]} />);
    expect(markedParagraphs(container)).toEqual([
      "note.",
      "The second paragraph, quoted",
      "The closing",
    ]);
  });
});

describe("paged notes", () => {
  const entryPage = (
    a: CanonicalArticle,
    footnoteIndex: number,
    start: number,
    end?: number,
  ): PageFragment => ({
    schemaVersion: 1,
    pageIndex: 0,
    blocks: [
      {
        blockIndex: a.blocks.length,
        footnoteIndex,
        startGrapheme: start,
        endGrapheme: end ?? footnoteRows(a).find((r) => r.index === footnoteIndex)!.length,
      },
    ],
  });

  // Cut inside fn-2's second paragraph ("The second | paragraph, quoted").
  const CUT = "The first paragraph of the note.\nThe second".length;

  it("a selection on a continuation page captures at the true offset", () => {
    const a = article();
    const { container } = render(
      <PageFragmentView fragment={entryPage(a, 1, CUT)} pageIndex={1} article={a} lang="en" />,
    );
    const note = container.querySelector("li#fn-2")!;
    select(textPoint(note, "paragraph, "), textPoint(note, "closing", true));
    const result = captureSelection(a, container as HTMLElement);
    const notesStart = footnoteRows(a)[1]!.start;
    expect(result.ok && normalizeText(a).slice(result.position.start, result.position.end)).toBe(
      "paragraph, quoted\nThe closing",
    );
    expect(result.ok && result.position.start).toBe(
      canonical(a, "paragraph, quoted", notesStart).start,
    );
  });

  it("a highlight across a note's paragraphs renders on both pages of a split note", () => {
    const a = article();
    const notesStart = footnoteRows(a)[1]!.start;
    const range = {
      start: canonical(a, "note.", notesStart).start,
      end: canonical(a, "The closing", notesStart).end,
    };
    const page = (start: number, end?: number) =>
      render(
        <PageFragmentView
          fragment={entryPage(a, 1, start, end)}
          pageIndex={0}
          article={a}
          lang="en"
          highlights={[hl("h3", range)]}
        />,
      ).container;
    expect(markedParagraphs(page(0, CUT))).toEqual(["note.", "The second"]);
    expect(markedParagraphs(page(CUT))).toEqual(["paragraph, quoted", "The closing"]);
  });
});
