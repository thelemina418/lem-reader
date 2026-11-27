// Reprocessing a URL article (#63, spec #66 Seam 3): the end-to-end run with
// the ingest endpoint mocked (the happy-path URL precedent). A reader
// previews, cancels with nothing changed, meets a calm refusal when the
// source is unreachable, then applies and keeps their highlight.
import { test, expect } from "@playwright/test";
import { ArticleSchema } from "../../../src/content/schema";
import { prepareFreshPage, seedRows, readRow } from "../portability/_portability";
import { BASE } from "../_base";

const para = (text: string) => ({ kind: "paragraph", content: [{ text, marks: [] }] });
const KEPT = "Calm readers keep their place through long arguments, page after page.";
const BEFORE = "The second claim was stated once, plainly, in the original.";
const AFTER = "The second claim is now stated twice, with a new caveat.";

const saved = ArticleSchema.parse({
  id: "example-essay",
  revision: 1,
  lang: "en",
  provenance: {
    sourceUrl: "https://example.com/essay",
    title: "An essay to reprocess",
    retrievedAt: "2026-01-01T00:00:00Z",
    originalHtmlHash: "hash-at-add",
  },
  blocks: [para(KEPT), para(BEFORE)],
  ingestionMeta: {
    source: "url",
    sourceUrl: "https://example.com/essay",
    fetchedAt: "2026-01-01T00:00:00Z",
    originalHtmlHash: "hash-at-add",
    extractionConfidence: "high",
  },
  tags: ["essays"],
});
const fresh = {
  ...saved,
  tags: undefined,
  provenance: { ...saved.provenance, originalHtmlHash: "hash-now" },
  blocks: [para(KEPT), para(AFTER)],
};
const highlight = {
  schemaVersion: 1,
  id: "h-kept",
  articleId: saved.id,
  revision: 1,
  position: { start: 13, end: 29 },
  quote: { prefix: "Calm readers ", exact: "keep their place", suffix: " through long arguments" },
  createdAt: "2026-01-02T00:00:00Z",
};

test("a reader previews, cancels, and applies reprocessing of a URL article", async ({ page }) => {
  await prepareFreshPage(page);
  await seedRows(page, { articles: [saved], highlights: [highlight] });
  let reachable = false;
  const fetched: unknown[] = [];
  await page.route("**/api/ingest", async (route) => {
    fetched.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        reachable
          ? { ok: true, article: fresh, confidence: { state: "confident" } }
          : { ok: false, reason: "fetch-failed" },
      ),
    });
  });
  await page.goto(`${BASE}/#/`);
  await page.reload();
  const openReprocess = async () => {
    await page
      .getByRole("button", { name: `Edit metadata for ${saved.provenance.title}`, exact: true })
      .click();
    await page.locator("summary").filter({ hasText: "Reprocess article" }).click();
  };
  const previewButton = page.getByRole("button", { name: "Preview reprocessing", exact: true });

  // Unreachable source: calm refusal, article untouched.
  await openReprocess();
  await previewButton.click();
  await expect(
    page.getByText("Couldn't reach this page. Your article is unchanged."),
  ).toBeVisible();
  expect(fetched).toEqual([{ url: "https://example.com/essay" }]);

  // Preview discloses the changed source, passages and highlight outcome.
  reachable = true;
  await previewButton.click();
  const region = page.getByRole("region", { name: "Reprocess preview" });
  await expect(
    region.getByText("The page at this address has changed since you added it."),
  ).toBeVisible();
  await region.getByText("Changed passages (2)").click();
  await expect(region.getByText(`Removed: ${BEFORE}`)).toBeVisible();
  await expect(region.getByText(`Added: ${AFTER}`)).toBeVisible();
  await expect(region.getByText("“keep their place” — re-matches")).toBeVisible();

  // Cancel leaves everything unchanged.
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(ArticleSchema.parse(await readRow(page, "articles", saved.id))).toEqual(saved);

  // Apply replaces the article with the newly processed version.
  await openReprocess();
  await previewButton.click();
  await page.getByRole("button", { name: "Apply reprocessing", exact: true }).click();
  await expect(page.locator("dialog.edit-metadata")).not.toBeVisible();
  const after = ArticleSchema.parse(await readRow(page, "articles", saved.id));
  expect(after.revision).toBe(2);
  expect(after.blocks).toEqual(fresh.blocks);
  expect(after.tags).toEqual(["essays"]);
  expect(await readRow(page, "highlights", highlight.id)).toEqual(highlight);
});
