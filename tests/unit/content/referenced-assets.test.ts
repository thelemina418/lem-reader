// Issue #82 (spec #81 prefactor) — referencedAssetIds is the ONE walker that
// answers "which stored assets does this article reference?". Rendering
// asset resolution, import's missing-asset detection and the book-arm
// attribution all route through it, so a later block kind that carries an
// asset (embed-card thumbnails) is added in exactly one place.

import { describe, it, expect } from "vitest";
import { referencedAssetIds } from "../../../src/content/assets/referencedAssets";
import type { Block } from "../../../src/content/types";

const paragraph = (text: string): Block => ({
  kind: "paragraph",
  content: [{ text, marks: [] }],
});

const figure = (alt: string, src?: string): Block => ({
  kind: "figure",
  alt,
  ...(src !== undefined ? { src } : {}),
  caption: [],
});

describe("referencedAssetIds", () => {
  it("returns nothing for an article with no figures", () => {
    expect(referencedAssetIds([paragraph("only text")])).toEqual([]);
  });

  it("collects stored figure asset ids in document order, through quotations and nested lists", () => {
    const blocks: Block[] = [
      paragraph("p"),
      figure("top", "asset:img-aaaaaaaaaaaa"),
      {
        kind: "blockquote",
        children: [
          figure("in-quote", "asset:img-bbbbbbbbbbbb"),
          { kind: "blockquote", children: [figure("quote-in-quote", "asset:img-eeeeeeeeeeee")] },
        ],
      },
      {
        kind: "bulleted-list",
        items: [
          {
            content: [
              paragraph("li"),
              figure("in-list", "asset:img-cccccccccccc"),
              {
                kind: "numbered-list",
                start: 1,
                items: [{ content: [figure("nested", "asset:img-dddddddddddd")] }],
              },
            ],
          },
        ],
      },
    ];
    expect(referencedAssetIds(blocks)).toEqual([
      "img-aaaaaaaaaaaa",
      "img-bbbbbbbbbbbb",
      "img-eeeeeeeeeeee",
      "img-cccccccccccc",
      "img-dddddddddddd",
    ]);
  });

  it("skips refused figures (no src) and remote-src figures", () => {
    const blocks: Block[] = [
      figure("refused has no src at all"),
      figure("legacy remote", "https://upload.wikimedia.org/x.png"),
      figure("stored", "asset:img-aaaaaaaaaaaa"),
      {
        kind: "blockquote",
        children: [figure("refused in quote"), figure("remote in quote", "https://e.x/y.jpg")],
      },
    ];
    expect(referencedAssetIds(blocks)).toEqual(["img-aaaaaaaaaaaa"]);
  });

  it("lists a repeated reference once (byte-identical twins share one asset)", () => {
    const blocks: Block[] = [
      figure("a", "asset:img-aaaaaaaaaaaa"),
      { kind: "blockquote", children: [figure("b", "asset:img-aaaaaaaaaaaa")] },
    ];
    expect(referencedAssetIds(blocks)).toEqual(["img-aaaaaaaaaaaa"]);
  });
});
