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
import { footnoteReferenceSpans } from "../../../src/content/footnoteReferences";
import { locationSaveMarker, waitForLocationSaved } from "../location-readiness";

const NOTE = "The north-wing ledger, shelf 12, folio 3.";

/** A long body (so the note lives in a later source window and on a later
 * page) whose fifth passage cites fn-1 inline, mid-sentence — and, with
 * `citedTwice` (shorter passages), whose twelfth passage cites it again
 * (issue #57). */
function inlineFootnotedArticle(citedTwice = false) {
  const filler = "The archivist kept a careful record of each journey through the valley. ";
  const blocks: unknown[] = [];
  for (let i = 0; i < 60; i++) {
    const text = `Passage ${i}. ${filler.repeat(citedTwice ? 10 : 50)}End of passage ${i}.`;
    blocks.push(
      i === 5 || (citedTwice && i === 12)
        ? {
            kind: "paragraph",
            content: [
              { text: `${text} The ledger cites the north wing`, marks: [] },
              {
                text: "1",
                marks: [{ type: "footnote-ref", footnoteId: "fn-1", occurrence: i === 5 ? 1 : 2 }],
              },
              { text: " and the claim holds.", marks: [] },
            ],
          }
        : { kind: "paragraph", content: [{ text, marks: [] }] },
    );
  }
  return ArticleSchema.parse({
    id: citedTwice ? "twice-footnoted-work" : "inline-footnoted-work",
    revision: 1,
    lang: "en",
    provenance: {
      title: citedTwice ? "A twice-footnoted journey" : "An inline-footnoted journey",
      retrievedAt: "2026-01-01T00:00:00Z",
      originalHtmlHash: citedTwice
        ? "synthetic-twice-footnoted-v1"
        : "synthetic-inline-footnoted-v1",
    },
    blocks,
    footnotes: [{ id: "fn-1", content: [{ text: NOTE, marks: [] }] }],
  });
}

const article = inlineFootnotedArticle();
const twice = inlineFootnotedArticle(true);

async function open(page: Page, work = article) {
  await page.setViewportSize({ width: 360, height: 700 });
  await page.goto(`${BASE}/#/article/${work.id}`);
  await expect(page.getByRole("heading", { level: 1, name: work.provenance.title })).toBeVisible();
  await waitForPaginationSettled(page);
}

test.beforeEach(async ({ page }) => {
  await prepareFreshPage(page);
  await seedRows(page, { articles: [article, twice] });
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

// ── The footnote excursion (spec #66 / issue #57) ────────────────────────────

/** The second reference to fn-1 in `twice` — its canonical start offset. */
const SECOND_REF = footnoteReferenceSpans(twice).find((s) => s.occurrence === 2)!;

/** The persisted reading position for `twice`, read straight from the store. */
async function savedOffset(page: Page): Promise<number | undefined> {
  return page.evaluate(async (articleId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("lem-reader");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const rows = await new Promise<{ articleId?: string; graphemeOffset?: number }[]>(
        (resolve, reject) => {
          const getReq = db.transaction("location", "readonly").objectStore("location").getAll();
          getReq.onsuccess = () => resolve(getReq.result ?? []);
          getReq.onerror = () => reject(getReq.error);
        },
      );
      return rows.find((r) => r.articleId === articleId)?.graphemeOffset;
    } finally {
      db.close();
    }
  }, twice.id);
}

/** Turn pages until the second reference is on screen (paged). */
async function pageToSecondRef(page: Page) {
  const ref = page.locator(".page-fragment #fn-ref-1-2");
  for (let turns = 0; turns < 120 && (await ref.count()) === 0; turns++) {
    await page.keyboard.press("ArrowRight");
    await waitForPaginationSettled(page);
  }
  await expect(ref).toBeVisible();
  return ref;
}

/** Follow a reference and wait until the position save lands. */
async function followAndSave(page: Page, ref: ReturnType<Page["locator"]>) {
  const marker = await locationSaveMarker(page);
  await ref.click();
  await expect(page.locator("li#fn-1:visible")).toBeFocused();
  await waitForLocationSaved(page, twice.id, marker);
}

test("paged excursion: the position stays at the reference, and each return goes home", async ({
  page,
}) => {
  await open(page, twice);
  const ref = await pageToSecondRef(page);
  await followAndSave(page, ref);
  // In the notes, the saved position is still the reference followed.
  expect(await savedOffset(page)).toBe(SECOND_REF.start);

  // Reopening mid-excursion resumes at the reference, not in the notes.
  await page.reload();
  await waitForPaginationSettled(page);
  await expect(page.locator(".page-fragment #fn-ref-1-2")).toBeVisible();

  // The plain return goes back to the reference actually followed (the
  // second), with focus on its marker…
  await page.locator(".page-fragment #fn-ref-1-2").click();
  const note = page.locator(".page-fragment #fn-1");
  await expect(note).toBeFocused();
  await expect(note.getByRole("link", { name: "Return from note 1" })).toBeVisible();
  await note.getByRole("link", { name: "Return from note 1" }).click();
  await expect(page.locator(".page-fragment #fn-ref-1-2")).toBeFocused();
  await expect(page.locator(".page-fragment #fn-ref-1-2")).toHaveAccessibleName("Footnote 1");

  // …while the lettered returns each lead to their own reference.
  await page.locator(".page-fragment #fn-ref-1-2").click();
  await expect(note).toBeFocused();
  await note.getByRole("link", { name: "Return to reference 1a" }).click();
  await expect(page.locator(".page-fragment #fn-ref-1")).toBeFocused();
});

test("paged excursion: turning a page from the notes reads on and saves normally", async ({
  page,
}) => {
  await open(page, twice);
  await followAndSave(page, await pageToSecondRef(page));
  expect(await savedOffset(page)).toBe(SECOND_REF.start);
  const marker = await locationSaveMarker(page);
  await page.keyboard.press("ArrowLeft");
  await waitForPaginationSettled(page);
  await waitForLocationSaved(page, twice.id, marker);
  // The excursion ended: the save is the page the reader turned to (the end
  // of the main text, far past the passage-12 reference).
  expect(await savedOffset(page)).toBeGreaterThan(SECOND_REF.end);
});

test("excursion survives a mode toggle; scrolling returns focus to the marker", async ({
  page,
}) => {
  await open(page, twice);
  await followAndSave(page, await pageToSecondRef(page));
  await switchMode(page); // → scrolling, still in the notes
  await expect(page.locator("#fn-1")).toBeInViewport();
  // Past the save debounce: the toggle's own landing must not move it.
  await page.waitForTimeout(1_500);
  expect(await savedOffset(page)).toBe(SECOND_REF.start);

  const ref = page.locator(".article-body:not(.article-body-measurement) #fn-ref-1-2");
  await page.locator("#fn-1").getByRole("link", { name: "Return from note 1" }).click();
  await expect(ref).toBeFocused();
  await expect(ref).toBeInViewport();
});

test("scrolling excursion: focus lands on the note; scrolling the notes ends it", async ({
  page,
}) => {
  await open(page, twice);
  await switchMode(page);
  const ref = page.locator(".article-body:not(.article-body-measurement) #fn-ref-1-2");
  await ref.scrollIntoViewIfNeeded();
  await followAndSave(page, ref);
  await expect(page.locator("#fn-1")).toBeInViewport();
  expect(await savedOffset(page)).toBe(SECOND_REF.start);

  // A deliberate scroll within the notes is reading on: the position saves
  // normally again (inside the notes — by #58's rule that reads finished).
  const marker = await locationSaveMarker(page);
  await page.mouse.move(180, 350);
  await page.mouse.wheel(0, -120);
  await waitForLocationSaved(page, twice.id, marker);
  expect(await savedOffset(page)).not.toBe(SECOND_REF.start);
});
