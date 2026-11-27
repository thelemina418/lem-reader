// Spec #66 / issue #55 — inline Footnote references, end to end (seam 2).
//
// A seeded canonical article whose markers are INLINE (the footnote-ref
// mark, as new ingests produce them):
//   1. the marker sits inside its sentence as a superscript link;
//   2. paged: following it loads the note (another source window) with focus
//      on the note, and the return lands back on the marker;
//   3. scrolling: the same round trip through the native fragment hop;
//   4. single tree: one exposed fn-ref id, none in the hidden measurement.
// The legacy block-level form stays covered by footnotes.spec.ts.
import { test, expect, type Page } from "@playwright/test";
import { ArticleSchema } from "../../../src/content/schema";
import { prepareFreshPage, seedRows } from "../portability/_portability";
import { readPagination, waitForPaginationSettled } from "./_harness";
import { BASE } from "../_base";
import { switchMode, waitForReadingSurface } from "../annotations/_fixtures";

const NOTE = "The north-wing ledger, shelf 12, folio 3.";

/** A long body (so the note lives in a later source window and on a later
 * page) whose fifth passage cites fn-1 inline, mid-sentence. */
function inlineFootnotedArticle() {
  const filler = "The archivist kept a careful record of each journey through the valley. ";
  const blocks: unknown[] = [];
  for (let i = 0; i < 60; i++) {
    const text = `Passage ${i}. ${filler.repeat(50)}End of passage ${i}.`;
    blocks.push(
      i === 5
        ? {
            kind: "paragraph",
            content: [
              { text: `${text} The ledger cites the north wing`, marks: [] },
              {
                text: "1",
                marks: [{ type: "footnote-ref", footnoteId: "fn-1", occurrence: 1 }],
              },
              { text: " and the claim holds.", marks: [] },
            ],
          }
        : { kind: "paragraph", content: [{ text, marks: [] }] },
    );
  }
  return ArticleSchema.parse({
    id: "inline-footnoted-work",
    revision: 1,
    lang: "en",
    provenance: {
      title: "An inline-footnoted journey",
      retrievedAt: "2026-01-01T00:00:00Z",
      originalHtmlHash: "synthetic-inline-footnoted-v1",
    },
    blocks,
    footnotes: [{ id: "fn-1", content: [{ text: NOTE, marks: [] }] }],
  });
}

const article = inlineFootnotedArticle();

async function open(page: Page) {
  await page.setViewportSize({ width: 360, height: 700 });
  await page.goto(`${BASE}/#/article/${article.id}`);
  await expect(
    page.getByRole("heading", { level: 1, name: article.provenance.title }),
  ).toBeVisible();
  await waitForPaginationSettled(page);
}

test.beforeEach(async ({ page }) => {
  await prepareFreshPage(page);
  await seedRows(page, { articles: [article] });
});

test("paged: the inline marker jumps to its note and the return lands on the marker", async ({
  page,
}) => {
  await open(page);
  // Reach the citing passage through the reader's own anchor seam.
  const ref = page.locator(".page-fragment #fn-ref-1");
  for (let turns = 0; turns < 60 && (await ref.count()) === 0; turns++) {
    await page.keyboard.press("ArrowRight");
    await waitForPaginationSettled(page);
  }
  await expect(ref).toBeVisible();
  // Inline in its sentence, as a superscript link to the note.
  await expect(page.locator(".page-fragment sup > a#fn-ref-1")).toHaveAttribute("href", "#fn-1");
  await expect(ref.locator("xpath=ancestor::p")).toContainText(
    "cites the north wing1 and the claim holds.",
  );
  const before = (await readPagination(page))?.anchorOffset;
  expect(typeof before).toBe("number");

  await ref.click();
  const note = page.locator(".page-fragment #fn-1");
  await expect(note).toBeFocused();
  await expect(note).toContainText(NOTE);
  // The note's own text carries no publisher return glyph (the ↩ beside it
  // is the reader's return link).
  await expect(note.locator("[data-footnote-content]")).not.toContainText("↩");

  await note.locator('a[href="#fn-ref-1"]').click();
  await expect(page.locator(".page-fragment #fn-ref-1")).toBeFocused();
  await waitForPaginationSettled(page);
  // Back on the page it was left from (the anchor sits at or before the marker).
  expect((await readPagination(page))?.anchorOffset).toBeLessThanOrEqual(before as number);
  // Single tree: one exposed reference id; the hidden projection has none.
  expect(await page.locator('[id="fn-ref-1"]').count()).toBe(1);
  expect(await page.locator('.article-body-measurement [id^="fn-"]').count()).toBe(0);
});

test("scrolling: the inline marker jumps to its note and the return comes back to it", async ({
  page,
}) => {
  await open(page);
  await switchMode(page);
  await waitForReadingSurface(page);
  const ref = page.locator(".article-body:not(.article-body-measurement) #fn-ref-1");
  await ref.scrollIntoViewIfNeeded();
  await ref.click();
  const note = page.locator("#fn-1");
  await expect(note).toBeInViewport();
  await expect(note).toContainText(NOTE);
  await note.locator('a[href="#fn-ref-1"]').click();
  await expect(ref).toBeInViewport();
  expect(await page.locator('[id="fn-ref-1"]').count()).toBe(1);
});
