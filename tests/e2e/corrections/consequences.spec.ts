// tests/e2e/corrections/consequences.spec.ts
// Spec #68 / issue #72 — consequences before applying (seam 3). A hide that
// affects the reader's data opens the consequences dialog first: it names
// the highlight by its words ("will not show while hidden") or the chapter
// with its completion and collection entry, focus moves in (to Cancel) and
// back to the block on close, Cancel / Esc change nothing, and confirming
// applies the correction together with the accepted chapter changes.
import { test, expect, type Page } from "@playwright/test";
import { wipeDatabase } from "../annotations/_fixtures";
import { seedStoreRows } from "../library/seedStoreRows";
import { BASE } from "../_base";
import { ArticleSchema } from "../../../src/content/schema";
import { deriveQuoteSelector, normalizeText } from "../../../src/content/normalizeText";
import { resolveWorkStructure } from "../../../src/content/chapterTargets";

const para = (text: string) => ({ kind: "paragraph", content: [{ text, marks: [] }] });
const h2 = (text: string) => ({ kind: "heading", level: 2, content: [{ text, marks: [] }] });

const GULLS = "Gulls follow it out past the breakwater and wheel back toward the town.";
const ARTICLE = {
  id: "harbour-chapters",
  revision: 1,
  lang: "en",
  provenance: {
    sourceUrl: "https://example.com/harbour-chapters",
    title: "The Harbour at Dawn",
    retrievedAt: "2026-11-01T00:00:00.000Z",
    originalHtmlHash: "hash-harbour-chapters",
  },
  blocks: [
    h2("Leaving port"),
    para("The ferry leaves at dawn, before the fog has lifted off the water."),
    para(GULLS),
    h2("Open water"),
    para("By the time the sun is up, the far shore has come into view."),
  ],
  footnotes: [],
  ingestionMeta: {
    source: "url",
    sourceUrl: "https://example.com/harbour-chapters",
    fetchedAt: "2026-11-01T00:00:00.000Z",
    originalHtmlHash: "hash-harbour-chapters",
    extractionConfidence: "high",
  },
  addedAt: "2026-11-01T00:00:00.000Z",
};

const canonical = ArticleSchema.parse(ARTICLE);
const [, OPEN_WATER] = resolveWorkStructure(canonical)!.destinations.filter(
  (d) => d.kind === "chapter",
);

function highlightRow() {
  const exact = "past the breakwater";
  const text = normalizeText(canonical);
  const start = [...text.slice(0, text.indexOf(exact))].length;
  const position = { start, end: start + [...exact].length };
  return {
    schemaVersion: 1,
    id: "h-gulls",
    articleId: ARTICLE.id,
    revision: 1,
    position,
    quote: deriveQuoteSelector(canonical, position),
    createdAt: "2026-11-02T00:00:00.000Z",
  };
}

const STAMP = "2026-11-02T00:00:00.000Z";
const chapterTarget = {
  kind: "work-chapter",
  articleId: ARTICLE.id,
  destinationId: OPEN_WATER!.id,
};

test.beforeEach(async ({ page }) => {
  await wipeDatabase(page);
  await page.goto(`${BASE}/#/`);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Saved articles" })).toBeVisible();
  await seedStoreRows(page, "articles", [ARTICLE]);
});

const view = (page: Page) => page.locator(".correction-view");
const dialog = (page: Page) => page.getByRole("alertdialog");
const frameFor = (page: Page, text: string) =>
  view(page).locator(".correction-block").filter({ hasText: text }).last();
const readingText = (page: Page) =>
  page
    .locator(".page-fragment, .article-body:not(.article-body-measurement)")
    .filter({ hasNot: page.locator(".correction-view") })
    .first();
const mark = (page: Page) => page.locator('mark.highlight[data-highlight-id="h-gulls"]');

async function openView(page: Page) {
  await page.goto(`${BASE}/#/article/${ARTICLE.id}`);
  await expect(page.getByRole("heading", { level: 1, name: "The Harbour at Dawn" })).toBeVisible();
  await page.keyboard.press("c");
  await expect(view(page)).toBeVisible();
}

async function readStore(page: Page, store: string): Promise<unknown[]> {
  return page.evaluate(
    (name) =>
      new Promise<unknown[]>((resolve, reject) => {
        const req = indexedDB.open("lem-reader");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const all = req.result.transaction(name, "readonly").objectStore(name).getAll();
          all.onsuccess = () => {
            resolve(all.result as unknown[]);
            req.result.close();
          };
        };
      }),
    store,
  );
}

test.describe("Consequences before applying (#72)", () => {
  test("hiding a highlighted block names the highlight; it hides with the block and returns on unhide", async ({
    page,
  }) => {
    await seedStoreRows(page, "highlights", [highlightRow()]);
    await openView(page);
    const gulls = frameFor(page, GULLS);
    await gulls.focus();
    await page.keyboard.press("x");

    // Focus moves into the dialog, onto the safe action.
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toHaveAccessibleName("Hide this block?");
    await expect(dialog(page).getByRole("button", { name: "Cancel" })).toBeFocused();
    await expect(dialog(page).getByRole("list", { name: /Highlights/ })).toHaveText(
      /“past the breakwater” — will not show while hidden; returns if you unhide/,
    );

    await dialog(page).getByRole("button", { name: "Hide block" }).click();
    await expect(dialog(page)).toBeHidden();
    // Focus back on the block it was opened from.
    await expect(gulls).toBeFocused();
    await expect(gulls).toHaveAttribute("data-hidden", "true");

    // Reading: neither the words nor the highlight show.
    await page.keyboard.press("c");
    await expect(view(page)).toBeHidden();
    await expect(readingText(page)).toContainText("The ferry leaves at dawn");
    await expect(readingText(page)).not.toContainText("past the breakwater");
    await expect(readingText(page).locator(mark(page))).toHaveCount(0);

    // Unhide has no consequence: no dialog, and the highlight matches again.
    await page.keyboard.press("c");
    await frameFor(page, GULLS).focus();
    await page.keyboard.press("x");
    await expect(page.getByRole("status").filter({ hasText: "Paragraph unhidden." })).toHaveCount(
      1,
    );
    await expect(dialog(page)).toHaveCount(0);
    await page.keyboard.press("c");
    await expect(view(page)).toBeHidden();
    await expect(readingText(page)).toContainText("past the breakwater");
    await expect(readingText(page).locator(mark(page)).first()).toBeVisible();
  });

  test("hiding a heading names its chapter's completion and collection entry; Cancel changes nothing", async ({
    page,
  }) => {
    await seedStoreRows(page, "completions", [
      {
        schemaVersion: 1,
        targetKey: `work-chapter:${ARTICLE.id}/${OPEN_WATER!.id}`,
        target: chapterTarget,
        finished: true,
        source: "reader",
        updatedAt: STAMP,
      },
    ]);
    await seedStoreRows(page, "collections", [
      {
        schemaVersion: 1,
        id: "harbour-plan",
        name: "Harbour plan",
        entries: [{ id: "e-open-water", target: chapterTarget, addedAt: STAMP }],
        createdAt: STAMP,
        updatedAt: STAMP,
      },
    ]);
    const before = {
      completions: await readStore(page, "completions"),
      collections: await readStore(page, "collections"),
    };
    await openView(page);
    const heading = frameFor(page, "Open water");
    await heading.focus();
    await page.keyboard.press("x");

    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText(
      `Remove finished status for chapter “Open water” (${OPEN_WATER!.id}).`,
    );
    await expect(dialog(page)).toContainText(/entry e-open-water, from “Harbour plan”/);
    // Each chapter consequence is accepted explicitly before applying.
    await expect(dialog(page).getByRole("button", { name: "Hide block" })).toBeDisabled();

    // Esc is Cancel: closes, focus returns, nothing changed.
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    await expect(heading).toBeFocused();
    await expect(heading).not.toHaveAttribute("data-hidden", "true");
    await expect(page.getByRole("status").filter({ hasText: "Nothing was changed." })).toHaveCount(
      1,
    );
    expect(await readStore(page, "corrections")).toEqual([]);
    expect(await readStore(page, "completions")).toEqual(before.completions);
    expect(await readStore(page, "collections")).toEqual(before.collections);

    // Again, accepted this time: the correction and the chapter changes land together.
    await page.keyboard.press("x");
    await expect(dialog(page)).toBeVisible();
    for (const box of await dialog(page).getByRole("checkbox").all()) await box.check();
    await dialog(page).getByRole("button", { name: "Hide block" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(heading).toHaveAttribute("data-hidden", "true");
    expect(await readStore(page, "completions")).toEqual([]);
    expect(((await readStore(page, "collections"))[0] as { entries: unknown[] }).entries).toEqual(
      [],
    );
  });
});
