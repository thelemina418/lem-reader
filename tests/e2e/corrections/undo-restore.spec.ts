// tests/e2e/corrections/undo-restore.spec.ts
// Spec #68 / issue #76 — every correction can be undone (seam 3):
// Ctrl+Z / Ctrl+Shift+Z in the Correction view, announced in the status
// region; the corrections list with each correction in plain words, undo of
// any one, a not-applied item with its reason that the reader can remove;
// and Restore original, after which the article reads exactly as it was
// added — and which can be undone right after.
import { test, expect, type Page } from "@playwright/test";
import { switchMode, modeToggle } from "../annotations/_fixtures";
import {
  frameFor,
  freshLibrary,
  openReader,
  openView as openArticleView,
  para,
  readingText,
  status,
  view,
} from "./_corrections";

const SHARE = "Share this article on social media";
const SIGNUP = "Sign up for our newsletter";
const ARTICLE = {
  id: "harbour-undo",
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
    para(SHARE),
    para("Gulls follow it out past the breakwater and wheel back toward the town."),
    para(SIGNUP),
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

const list = (page: Page) => page.getByRole("region", { name: "Corrections on this article" });

const openView = (page: Page) => openArticleView(page, ARTICLE, "ferry leaves at dawn");

async function hide(page: Page, text: string) {
  await frameFor(page, text).focus();
  await page.keyboard.press("x");
  await expect(frameFor(page, text)).toHaveAttribute("data-hidden", "true");
}

test.describe("Undo, redo, the corrections list and Restore original (#76)", () => {
  test("Ctrl+Z undoes the last correction and Ctrl+Shift+Z redoes it, each announced", async ({
    page,
  }) => {
    await openView(page);
    await hide(page, SHARE);
    await expect(status(page, /Paragraph hidden\..*Ctrl\+Z to undo/)).toHaveCount(1);

    await page.keyboard.press("Control+z");
    await expect(frameFor(page, SHARE)).not.toHaveAttribute("data-hidden", "true");
    await expect(
      status(page, `Undone: Hid the paragraph “${SHARE}”. Press Ctrl+Shift+Z to redo.`),
    ).toHaveCount(1);

    await page.keyboard.press("Control+Shift+z");
    await expect(frameFor(page, SHARE)).toHaveAttribute("data-hidden", "true");
    await expect(
      status(page, `Redone: Hid the paragraph “${SHARE}”. Press Ctrl+Z to undo.`),
    ).toHaveCount(1);

    // Nothing further to redo — said, not silent.
    await page.keyboard.press("Control+Shift+z");
    await expect(status(page, "Nothing to redo.")).toHaveCount(1);
  });

  test("the list describes each correction; any one can be undone; a not-applied one shows its reason and can be removed", async ({
    page,
  }) => {
    await openView(page);
    await hide(page, SHARE);
    await hide(page, SIGNUP);
    // Unhide the first one again: it depends on the hide before it.
    await frameFor(page, SHARE).focus();
    await page.keyboard.press("x");
    await expect(frameFor(page, SHARE)).not.toHaveAttribute("data-hidden", "true");

    await page.keyboard.press("l");
    await expect(list(page)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Corrections on this article" })).toBeFocused();
    const items = list(page).getByRole("listitem");
    await expect(items).toHaveText([
      `Hid the paragraph “${SHARE}”Undo`,
      `Hid the paragraph “${SIGNUP}”Undo`,
      `Unhid the paragraph “${SHARE}”Undo`,
    ]);

    // Undo the middle one: nothing depends on it — applied at once.
    await items.nth(1).getByRole("button", { name: "Undo" }).click();
    await expect(frameFor(page, SIGNUP)).not.toHaveAttribute("data-hidden", "true");
    await expect(status(page, `Undone: Hid the paragraph “${SIGNUP}”.`)).toHaveCount(1);
    await expect(items).toHaveCount(2);

    // Undo the first: the later unhide would no longer fit — told first.
    await items.nth(0).getByRole("button", { name: "Undo" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Undo this correction?" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("list", { name: "Corrections that would no longer fit" }),
    ).toContainText(`Unhid the paragraph “${SHARE}” — not applied: This block isn't hidden.`);
    await dialog.getByRole("button", { name: "Undo correction" }).click();
    await expect(dialog).toBeHidden();

    // Kept in the list, not applied, with its reason — then removed.
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText(`Unhid the paragraph “${SHARE}”`);
    await expect(items.first()).toContainText("Not applied: This block isn't hidden.");
    await items.first().getByRole("button", { name: "Remove" }).click();
    await expect(status(page, /^Removed from the list: Unhid the paragraph/)).toHaveCount(1);
    await expect(list(page)).toContainText("No corrections.");

    // Escape folds the list and returns focus to its toggle.
    await page.getByRole("heading", { name: "Corrections on this article" }).focus();
    await page.keyboard.press("Escape");
    await expect(list(page)).toBeHidden();
    await expect(page.getByRole("button", { name: /Corrections \(0\)/ })).toBeFocused();
  });

  test("after Restore original the article reads exactly as it was added; Ctrl+Z right after brings the corrections back", async ({
    page,
  }) => {
    await openReader(page, ARTICLE, "ferry leaves at dawn");
    await switchMode(page);
    await expect(modeToggle(page)).toHaveAttribute("aria-label", "Reading mode: scrolling");
    const original = await readingText(page).innerHTML();

    await page.keyboard.press("c");
    await expect(view(page)).toBeVisible();
    await hide(page, SHARE);
    await hide(page, SIGNUP);
    await page.getByRole("button", { name: /Corrections \(2\)/ }).click();
    await list(page).getByRole("button", { name: "Restore original" }).click();
    await expect(status(page, /^Original restored\..*Ctrl\+Z to undo/)).toHaveCount(1);
    await expect(view(page).locator('.correction-block[data-hidden="true"]')).toHaveCount(0);

    await page.keyboard.press("c");
    await expect(view(page)).toBeHidden();
    await expect(readingText(page)).toContainText(SHARE);
    expect(await readingText(page).innerHTML()).toBe(original);

    // Undoable right after.
    await page.keyboard.press("c");
    await expect(view(page)).toBeVisible();
    await page.keyboard.press("Control+z");
    await expect(status(page, /^Undone: Restore original\./)).toHaveCount(1);
    await expect(frameFor(page, SHARE)).toHaveAttribute("data-hidden", "true");
    await expect(frameFor(page, SIGNUP)).toHaveAttribute("data-hidden", "true");
  });
});
