// tests/unit/server/markdown-footnotes.spec.ts
// Spec #66 / issue #62 — GitHub-style Markdown footnotes at the ingest seam
// (uploaded Markdown → canonical article). `[^label]` references become
// inline footnote references and `[^label]: …` definitions become notes,
// numbered in first-reference order as GitHub renders them. Documents
// without footnotes produce exactly what strict CommonMark produced before.
import { describe, expect, it } from "vitest";
import { markdownToBlocks } from "../../../server/markdownToBlocks";
import { ingest } from "../../../server/ingest";
import { ArticleSchema, type CanonicalArticle } from "../../../src/content/schema";
import { normalizeText } from "../../../src/content/normalizeText";
import { footnoteAnchorOffset } from "../../../src/reader/footnoteAnchors";

const FILLER =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";

const NOTES_MD = `# An essay with notes

${FILLER}

The claim[^claim] holds up. ${FILLER}

A second point[^2] follows, and the claim[^claim] returns.

[^2]: The second note’s text.

[^claim]: The first note’s text.
`;

function ref(footnoteId: string, occurrence = 1) {
  return { type: "footnote-ref", footnoteId, occurrence };
}

async function markdownArticle(md: string): Promise<CanonicalArticle> {
  const result = await ingest({ markdown: md });
  if (!result.ok || !("article" in result)) throw new Error("expected an article");
  return ArticleSchema.parse(result.article);
}

function paragraphWith(article: CanonicalArticle, needle: string) {
  const block = article.blocks.find(
    (b) => b.kind === "paragraph" && b.content.some((r) => r.text.includes(needle)),
  );
  if (block?.kind !== "paragraph") throw new Error(`no paragraph with ${needle}`);
  return block.content;
}

describe("Markdown footnotes (issue #62)", () => {
  it("turns [^label] into an inline reference whose marker is the note number", async () => {
    const article = await markdownArticle(NOTES_MD);
    expect(paragraphWith(article, "holds up").slice(0, 3)).toEqual([
      { text: "The claim", marks: [] },
      { text: "1", marks: [ref("fn-1")] },
      { text: expect.stringMatching(/^ holds up\. /), marks: [] },
    ]);
  });

  it("numbers notes by first reference and counts repeated references", async () => {
    const article = await markdownArticle(NOTES_MD);
    expect(paragraphWith(article, "second point")).toEqual([
      { text: "A second point", marks: [] },
      { text: "2", marks: [ref("fn-2")] },
      { text: " follows, and the claim", marks: [] },
      { text: "1", marks: [ref("fn-1", 2)] },
      { text: " returns.", marks: [] },
    ]);
    expect(article.footnotes).toEqual([
      { id: "fn-1", content: [{ text: "The first note’s text.", marks: [] }] },
      { id: "fn-2", content: [{ text: "The second note’s text.", marks: [] }] },
    ]);
  });

  it("takes definitions out of the body so each note appears once", async () => {
    const article = await markdownArticle(NOTES_MD);
    const text = normalizeText(article);
    expect(text.split("The first note’s text.")).toHaveLength(2);
    expect(text).not.toContain("[^");
    expect(article.blocks.some((b) => b.kind === "unsupported")).toBe(false);
  });

  it("resolves the jump to the note and the return to its first reference", async () => {
    const article = await markdownArticle(NOTES_MD);
    const text = normalizeText(article);
    const note = footnoteAnchorOffset(article, "#fn-1");
    expect(note).not.toBeNull();
    expect(text.slice(note!, note! + "The first note".length)).toBe("The first note");
    const back = footnoteAnchorOffset(article, "#fn-ref-1");
    expect(back).toBe(text.indexOf("The claim 1 holds up") + "The claim ".length);
    const second = footnoteAnchorOffset(article, "#fn-ref-1-2");
    expect(second).toBe(text.indexOf("claim 1 returns") + "claim ".length);
  });

  it("finds references inside emphasis, lists and quotations", async () => {
    const { blocks } = await markdownToBlocks(
      `*Stressed[^a]* words.\n\n- An item[^b]\n\n> Quoted[^a].\n\n[^a]: Note A.\n[^b]: Note B.\n`,
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        content: [
          { text: "Stressed", marks: [{ type: "em" }] },
          { text: "1", marks: [{ type: "em" }, ref("fn-1")] },
          { text: " words.", marks: [] },
        ],
      },
      {
        kind: "bulleted-list",
        items: [
          {
            content: [
              {
                kind: "paragraph",
                content: [
                  { text: "An item", marks: [] },
                  { text: "2", marks: [ref("fn-2")] },
                ],
              },
            ],
          },
        ],
      },
      {
        kind: "blockquote",
        children: [
          {
            kind: "paragraph",
            content: [
              { text: "Quoted", marks: [] },
              { text: "1", marks: [ref("fn-1", 2)] },
              { text: ".", marks: [] },
            ],
          },
        ],
      },
    ]);
  });

  it("keeps every paragraph of a multi-paragraph definition, in order", async () => {
    const { footnotes } = await markdownToBlocks(
      `Text[^long].\n\n[^long]: First paragraph of the note.\n\n    Second paragraph, *emphasised*.\n\n    - a listed point\n`,
    );
    // Issue #59 — the note keeps its paragraphs; its list flattens to one.
    expect(footnotes).toEqual([
      {
        id: "fn-1",
        content: [{ text: "First paragraph of the note.", marks: [] }],
        laterParagraphs: [
          [
            { text: "Second paragraph, ", marks: [] },
            { text: "emphasised", marks: [{ type: "em" }] },
            { text: ".", marks: [] },
          ],
          [{ text: "a listed point", marks: [] }],
        ],
      },
    ]);
  });

  it("leaves a reference without a definition as plain text, and keeps an unreferenced note", async () => {
    const { blocks, footnotes } = await markdownToBlocks(
      `Missing[^nope] and present[^yes].\n\n[^yes]: Referenced.\n\n[^orphan]: Nobody points here.\n`,
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        content: [
          { text: "Missing[^nope] and present", marks: [] },
          { text: "1", marks: [ref("fn-1")] },
          { text: ".", marks: [] },
        ],
      },
    ]);
    expect(footnotes).toEqual([
      { id: "fn-1", content: [{ text: "Referenced.", marks: [] }] },
      { id: "fn-2", content: [{ text: "Nobody points here.", marks: [] }] },
    ]);
  });

  it("renders a reference inside a note as its plain marker", async () => {
    const { footnotes } = await markdownToBlocks(
      `One[^a] two[^b].\n\n[^a]: See also[^b].\n[^b]: Second.\n`,
    );
    expect(footnotes[0]).toEqual({ id: "fn-1", content: [{ text: "See also2.", marks: [] }] });
  });

  it("treats raw HTML in a definition exactly as in the body (never markup)", async () => {
    const html = `Note <img src=x onerror=alert(1)> and <script>alert(1)</script> end.`;
    const { blocks, footnotes } = await markdownToBlocks(`${html}\n\nX[^h].\n\n[^h]: ${html}\n`);
    const body = blocks[0]!;
    if (body.kind !== "paragraph") throw new Error("expected paragraph");
    expect(footnotes[0]!.content).toEqual(body.content);
    expect(footnotes[0]!.content.every((r) => r.marks.length === 0)).toBe(true);
  });

  it("keeps a raw HTML block in a definition as literal text", async () => {
    const { footnotes } = await markdownToBlocks(
      `X[^h].\n\n[^h]: Before.\n\n    <script>alert(1)</script>\n`,
    );
    expect(footnotes[0]).toEqual({
      id: "fn-1",
      content: [{ text: "Before.", marks: [] }],
      laterParagraphs: [[{ text: "<script>alert(1)</script>", marks: [] }]],
    });
  });

  it("produces byte-identical output for Markdown without footnotes", async () => {
    // Pinned from the strict-CommonMark ingest before issue #62 (other GFM
    // features — tables, task lists, strikethrough, autolinks — stay off).
    const md = `# Plain notes

A sentence with a caret in brackets, [^not-a-note], stays text. A [reference link][ref] and a ~~tilde~~ pair stay as they were.

| a | b |
|---|---|
| 1 | 2 |

- [ ] not a task
- www.example.com is not autolinked

[ref]: https://example.com/ref "Ref title"
`;
    expect(JSON.stringify(await markdownToBlocks(md))).toBe(
      '{"blocks":[{"kind":"heading","level":1,"content":[{"text":"Plain notes","marks":[]}]},{"kind":"paragraph","content":[{"text":"A sentence with a caret in brackets, [^not-a-note], stays text. A reference link and a ~~tilde~~ pair stay as they were.","marks":[]}]},{"kind":"paragraph","content":[{"text":"| a | b | |---|---| | 1 | 2 |","marks":[]}]},{"kind":"bulleted-list","items":[{"content":[{"kind":"paragraph","content":[{"text":"[ ] not a task","marks":[]}]}]},{"content":[{"kind":"paragraph","content":[{"text":"www.example.com is not autolinked","marks":[]}]}]}]},{"kind":"unsupported","originalKind":"definition","plainDescription":"A definition element from the original document that the reader could not render."}],"footnotes":[],"lang":"en","provenancePartial":{},"isReaderable":true}',
    );
  });
});
