// tests/e2e/corrections/_corrections.ts
// Spec #68 — the shared harness of the Correction-view specs (seam 3). One
// owner for what every corrections spec does the same way: seed a fresh
// library with its articles, open an article for reading or straight into
// the Correction view, find a block's frame in the view or the reading
// surface, read the status region, and build a highlight row over a
// fixture article. Listed in docs/testing-coverage.md's helper index —
// extend it here; do not grow a parallel copy in a spec.
import { expect, type Page } from "@playwright/test";
import { wipeDatabase } from "../annotations/_fixtures";
import { seedStoreRows } from "../library/seedStoreRows";
import { BASE } from "../_base";
import { ArticleSchema } from "../../../src/content/schema";
import { deriveQuoteSelector, normalizeText } from "../../../src/content/normalizeText";

/** A plain paragraph block with one unmarked run. */
export const para = (text: string) => ({ kind: "paragraph", content: [{ text, marks: [] }] });

/** A fixture article row: its id and the title its reading heading shows. */
export interface FixtureArticle {
  readonly id: string;
  readonly provenance: { readonly title: string };
}

/** Wipe, remount (so the app recreates the Dexie schema) and seed `articles`. */
export async function freshLibrary(page: Page, articles: readonly object[]): Promise<void> {
  await wipeDatabase(page);
  await page.goto(`${BASE}/#/`);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Saved articles" })).toBeVisible();
  if (articles.length > 0) await seedStoreRows(page, "articles", [...articles]);
}

/** The Correction view. */
export const view = (page: Page) => page.locator(".correction-view");

/** The consequences dialog (and any other alertdialog). */
export const dialog = (page: Page) => page.getByRole("alertdialog");

/** A block's frame in the Correction view, by its text. */
export const frameFor = (page: Page, text: string) =>
  view(page).locator(".correction-block").filter({ hasText: text }).last();

/** The live reading surface (paged or scrolling), never the view. */
export const readingSurface = (page: Page) =>
  page
    .locator(".page-fragment, .article-body:not(.article-body-measurement)")
    .filter({ hasNot: page.locator(".correction-view") });

/** The first live reading surface — what the reader is reading. */
export const readingText = (page: Page) => readingSurface(page).first();

/** The status-region announcement holding `text`. */
export const status = (page: Page, text: string | RegExp) =>
  page.getByRole("status").filter({ hasText: text });

/** Open `article` for reading; `ready` is text that proves it rendered. */
export async function openReader(
  page: Page,
  article: FixtureArticle,
  ready?: string,
): Promise<void> {
  await page.goto(`${BASE}/#/article/${article.id}`);
  await expect(
    page.getByRole("heading", { level: 1, name: article.provenance.title }),
  ).toBeVisible();
  if (ready !== undefined) await expect(readingText(page)).toContainText(ready);
}

/** Open `article` and enter the Correction view with C. */
export async function openView(page: Page, article: FixtureArticle, ready?: string): Promise<void> {
  await openReader(page, article, ready);
  await page.keyboard.press("c");
  await expect(view(page)).toBeVisible();
}

/** A stored highlight row over the fixture `article`'s words `exact`
 * (their first occurrence), as the reader would have saved it. */
export function highlightRow(article: object, id: string, exact: string) {
  const canonical = ArticleSchema.parse(article);
  const text = normalizeText(canonical);
  const at = text.indexOf(exact);
  if (at < 0) throw new Error(`fixture drift: "${exact}" is not in ${canonical.id}`);
  const start = [...text.slice(0, at)].length;
  const position = { start, end: start + [...exact].length };
  return {
    schemaVersion: 1,
    id,
    articleId: canonical.id,
    revision: canonical.revision,
    position,
    quote: deriveQuoteSelector(canonical, position),
    createdAt: "2026-11-02T00:00:00.000Z",
  };
}
