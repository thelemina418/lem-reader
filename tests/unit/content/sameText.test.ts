// Spec #68 / #69 — the ONE "same text as before?" check. A stored record
// (reading position, highlight, work-structure snapshot, pagination scope,
// imported row) carries the text stamp it was saved against; it is trusted
// directly only when that stamp matches the article being shown. Otherwise
// the caller re-matches by quote (the cross-revision path).
import { describe, expect, it } from "vitest";
import { isSameText, textStamp } from "../../../src/content/sameText";

describe("isSameText — the stored-position trust check", () => {
  it("trusts a record saved against the same revision", () => {
    expect(isSameText({ revision: 3 }, { revision: 3 })).toBe(true);
  });

  it("does not trust a record saved against an older revision (re-match by quote)", () => {
    expect(isSameText({ revision: 2 }, { revision: 3 })).toBe(false);
  });

  it("does not trust a record saved against a newer revision", () => {
    expect(isSameText({ revision: 4 }, { revision: 3 })).toBe(false);
  });

  it("ignores everything except the text stamp", () => {
    const shown = { id: "a", revision: 5, title: "Shown" };
    const stored = { articleId: "a", revision: 5, graphemeOffset: 120 };
    expect(isSameText(stored, shown)).toBe(true);
  });
});

describe("textStamp — what a stored record is stamped with", () => {
  it("is the article's monotonic ingest revision", () => {
    const article = { id: "a", revision: 7, title: "Shown" };
    expect(textStamp(article)).toEqual({ revision: 7 });
  });

  it("a record stamped from an article is the same text as that article", () => {
    const article = { id: "a", revision: 9 };
    expect(isSameText(textStamp(article), article)).toBe(true);
  });
});
