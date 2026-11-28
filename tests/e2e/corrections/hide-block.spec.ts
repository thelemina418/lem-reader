// tests/e2e/corrections/hide-block.spec.ts
// Spec #68 / issue #71 — the first correction end to end (seam 3). The
// reader hides a block of site chrome in the Correction view: it is gone
// from paged and scrolling reading, stays in the view dimmed and labelled
// "Hidden", and Unhide brings it back exactly. A hide with no consequences
// applies with no dialog (#72). Each change is announced in the status region.
import { test, expect, type Page } from "@playwright/test";
import { modeToggle, switchMode } from "../annotations/_fixtures";
import {
  frameFor,
  freshLibrary,
  openReader as openArticle,
  para,
  readingText,
  view,
} from "./_corrections";

const CHROME = "Share this article on social media";
const ARTICLE = {
  id: "harbour-chrome",
  revision: 1,
  lang: "en",
  provenance: {
    sourceUrl: "https://example.com/harbour",
    title: "The Harbour at Dawn",
    retrievedAt: "2026-11-01T00:00:00.000Z",
    originalHtmlHash: "hash-harbour",
  },
  blocks: [
    { kind: "heading", level: 2, content: [{ text: "Leaving port", marks: [] }] },
    para("The ferry leaves at dawn, before the fog has lifted off the water."),
    para(CHROME),
    para("Gulls follow it out past the breakwater and wheel back toward the town."),
    para("By the time the sun is up, the far shore has come into view."),
  ],
  footnotes: [],
  ingestionMeta: {
    source: "url",
    sourceUrl: "https://example.com/harbour",
    fetchedAt: "2026-11-01T00:00:00.000Z",
    originalHtmlHash: "hash-harbour",
    extractionConfidence: "high",
  },
  addedAt: "2026-11-01T00:00:00.000Z",
};

test.beforeEach(async ({ page }) => freshLibrary(page, [ARTICLE]));

const openReader = (page: Page) => openArticle(page, ARTICLE, "ferry leaves at dawn");

test.describe("Hide and unhide a block (#71)", () => {
  test("a hidden block leaves paged and scrolling reading and comes back on unhide", async ({
    page,
  }) => {
    await openReader(page);
    await expect(modeToggle(page)).toHaveAttribute("aria-label", "Reading mode: paginated");
    await expect(readingText(page)).toContainText(CHROME);

    await page.keyboard.press("c");
    await expect(view(page)).toBeVisible();
    const chrome = frameFor(page, CHROME);
    await chrome.focus();
    await expect(page.locator(".correction-commands-current")).toHaveText(
      "Current block: Paragraph",
    );
    await page.keyboard.press("x");
    await expect(page.getByRole("status").filter({ hasText: "Paragraph hidden." })).toHaveCount(1);
    // No consequences → applied at once, never a dialog (#72).
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    // Still in the view, dimmed and labelled — never deleted.
    await expect(chrome).toHaveAttribute("data-hidden", "true");
    await expect(chrome).toHaveAttribute("aria-label", "Paragraph, hidden");
    await expect(chrome.locator(".correction-block-label")).toHaveText("Paragraph · Hidden");
    await expect(page.getByRole("button", { name: /Unhide block/ })).toBeVisible();

    // Paged reading: gone.
    await page.keyboard.press("c");
    await expect(view(page)).toBeHidden();
    await expect(readingText(page)).toContainText("Gulls follow it out");
    await expect(readingText(page)).not.toContainText(CHROME);

    // Scrolling reading: gone too.
    await switchMode(page);
    await expect(modeToggle(page)).toHaveAttribute("aria-label", "Reading mode: scrolling");
    await expect(readingText(page)).toContainText("Gulls follow it out");
    await expect(readingText(page)).not.toContainText(CHROME);

    // It survives a reload (the corrections record), and the original row
    // is untouched.
    await page.reload();
    await expect(readingText(page)).toContainText("Gulls follow it out");
    await expect(readingText(page)).not.toContainText(CHROME);
    const storedBlocks = await page.evaluate(
      (id) =>
        new Promise<number>((resolve, reject) => {
          const req = indexedDB.open("lem-reader");
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const tx = req.result.transaction("articles", "readonly");
            const get = tx.objectStore("articles").get(id);
            get.onsuccess = () => {
              resolve((get.result as { blocks: unknown[] }).blocks.length);
              req.result.close();
            };
          };
        }),
      ARTICLE.id,
    );
    expect(storedBlocks).toBe(ARTICLE.blocks.length);

    // Unhide restores it exactly.
    await page.keyboard.press("c");
    await expect(view(page)).toBeVisible();
    await frameFor(page, CHROME).focus();
    await page.getByRole("button", { name: /Unhide block/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "Paragraph unhidden." })).toHaveCount(
      1,
    );
    await expect(frameFor(page, CHROME)).not.toHaveAttribute("data-hidden", "true");
    await page.keyboard.press("c");
    await expect(view(page)).toBeHidden();
    await expect(readingText(page)).toContainText(CHROME);
  });
});
