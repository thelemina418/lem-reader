// tests/e2e/corrections/reprocess.spec.ts
// Spec #68 / issue #78 — seam 3: Reprocessing a corrected article. The
// preview says how many of the reader's corrections are re-applied to the
// new version and lists the one that no longer fits, with its reason; after
// apply the kept hide still holds and the non-fitting correction stays in
// the corrections list as not applied, never dropped. The ingest endpoint
// is mocked (the reprocess-url precedent).
import { test, expect } from "@playwright/test";
import { ArticleSchema, type Correction } from "../../../src/content/schema";
import { normalizeText } from "../../../src/content/normalizeText";
import { applyCorrections, blockCorrection } from "../../../src/content/corrections/engine";
import { wipeDatabase } from "../annotations/_fixtures";
import { seedStoreRows } from "../library/seedStoreRows";
import { BASE } from "../_base";

const para = (text: string) => ({ kind: "paragraph", content: [{ text, marks: [] }] });
const FERRY = "The ferry leaves at dawn, before the fog has lifted off the water.";
const SHARE = "Share this article on social media";
const GULLS = "Gulls follow it out past the breakwater and wheel back toward the town.";
const NEWSLETTER = "Sign up for our harbour newsletter";
const NEW_PASSAGE = "The harbour master now keeps a second log of every crossing.";

const saved = ArticleSchema.parse({
  id: "harbour-reprocess",
  revision: 1,
  lang: "en",
  provenance: {
    sourceUrl: "https://example.com/harbour",
    title: "The Harbour, Reprocessed",
    retrievedAt: "2026-11-01T00:00:00.000Z",
    originalHtmlHash: "hash-at-add",
  },
  blocks: [para(FERRY), para(SHARE), para(GULLS), para(NEWSLETTER)],
  ingestionMeta: {
    source: "url",
    sourceUrl: "https://example.com/harbour",
    fetchedAt: "2026-11-01T00:00:00.000Z",
    originalHtmlHash: "hash-at-add",
    extractionConfidence: "high",
  },
  addedAt: "2026-11-01T00:00:00.000Z",
});
// The page now: a new passage; the share line still there; no sign-up.
const fresh = {
  ...saved,
  provenance: { ...saved.provenance, originalHtmlHash: "hash-now" },
  blocks: [para(FERRY), para(NEW_PASSAGE), para(SHARE), para(GULLS)],
};

function hideOf(text: string, before: Correction[]): Correction {
  const result = applyCorrections(saved, before);
  const graphemes = [...normalizeText(result.view.article)];
  const block = result.view.allBlocks.find(
    (b) => graphemes.slice(b.viewStart, b.viewEnd).join("") === text,
  )!;
  return blockCorrection("hide", result, block, {
    id: `hide-${before.length}`,
    createdAt: "2026-11-27T10:00:00.000Z",
  })!;
}
const hideShare = hideOf(SHARE, []);
const hideNewsletter = hideOf(NEWSLETTER, [hideShare]);

test("the Reprocessing preview lists corrections that no longer fit; apply keeps them as not applied", async ({
  page,
}) => {
  await wipeDatabase(page);
  await page.goto(`${BASE}/#/`);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Saved articles" })).toBeVisible();
  await seedStoreRows(page, "articles", [saved]);
  await seedStoreRows(page, "corrections", [
    {
      schemaVersion: 1,
      articleId: saved.id,
      corrections: [hideShare, hideNewsletter],
      updatedAt: "2026-11-27T10:00:00.000Z",
    },
  ]);
  await page.route("**/api/ingest", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, article: fresh, confidence: { state: "confident" } }),
    }),
  );
  await page.reload();

  await page
    .getByRole("button", { name: `Edit metadata for ${saved.provenance.title}`, exact: true })
    .click();
  await page.locator("summary").filter({ hasText: "Reprocess article" }).click();
  await page.getByRole("button", { name: "Preview reprocessing", exact: true }).click();
  const region = page.getByRole("region", { name: "Reprocess preview" });
  await expect(
    region.getByText(
      "Your corrections: 1 of 2 re-applied to the new version by finding their text.",
    ),
  ).toBeVisible();
  const notFitting = region.getByRole("list", { name: "Corrections that no longer fit" });
  await expect(notFitting.getByRole("listitem")).toHaveCount(1);
  await expect(notFitting).toContainText(
    `Hid the paragraph “${NEWSLETTER}” — no longer fits: Its text is no longer in this article. It stays in the corrections list as not applied.`,
  );
  // Changed passages are what the reader reads: only the new passage.
  await region.getByText("Changed passages (1)").click();
  await expect(region.getByText(`Added: ${NEW_PASSAGE}`)).toBeVisible();

  await page.getByRole("button", { name: "Apply reprocessing", exact: true }).click();
  await expect(page.locator("dialog.edit-metadata")).not.toBeVisible();

  // The kept hide still holds in reading; the sign-up is gone with the page.
  await page.goto(`${BASE}/#/article/${saved.id}`);
  await expect(page.getByRole("heading", { level: 1, name: saved.provenance.title })).toBeVisible();
  const reading = page
    .locator(".page-fragment, .article-body:not(.article-body-measurement)")
    .first();
  await expect(reading).toContainText("ferry leaves at dawn");
  await expect(reading).not.toContainText(SHARE);

  // The non-fitting correction is still listed, as not applied, with its reason.
  await page.keyboard.press("c");
  await expect(page.locator(".correction-view")).toBeVisible();
  await page.keyboard.press("l");
  const list = page.getByRole("region", { name: "Corrections on this article" });
  const items = list.getByRole("listitem");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText(`Hid the paragraph “${SHARE}”`);
  await expect(items.nth(0)).not.toContainText("Not applied");
  await expect(items.nth(1)).toContainText(
    `Hid the paragraph “${NEWSLETTER}”Not applied: Its text is no longer in this article.`,
  );
});
