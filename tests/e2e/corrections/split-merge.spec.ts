// tests/e2e/corrections/split-merge.spec.ts
// Spec #68 / issue #75 — split a block at the caret, merge a block with the
// next one (seam 3), keyboard-only. Two paragraphs run together become two
// again (S at the caret); a paragraph broken mid-sentence becomes whole (J).
// Both read correctly in paged and scrolling reading. A merge that would
// leave a highlight across the joined boundary unmatched opens the
// consequences dialog first, and Cancel changes nothing. An unavailable
// command says why. Every command is announced in the status region.
import { test, expect, type Page } from "@playwright/test";
import { modeToggle, switchMode } from "../annotations/_fixtures";
import { seedStoreRows } from "../library/seedStoreRows";
import {
  dialog,
  frameFor,
  freshLibrary,
  highlightRow,
  openView as openArticleView,
  para,
  readingText,
  status,
  view,
} from "./_corrections";

const FIRST = "The tide is out.";
const SECOND = "Boats rest on the mud until the evening.";
const BROKEN = "The ferry leaves at dawn, and the gulls";
const REST = "follow it out past the breakwater.";
const LAST = "The far shore comes into view.";
const ARTICLE = {
  id: "harbour-split-merge",
  revision: 1,
  lang: "en",
  provenance: {
    sourceUrl: "https://example.com/harbour-split-merge",
    title: "The Harbour at Dawn",
    retrievedAt: "2026-11-01T00:00:00.000Z",
    originalHtmlHash: "hash-harbour-split-merge",
  },
  blocks: [
    { kind: "heading", level: 2, content: [{ text: "Leaving port", marks: [] }] },
    para(`${FIRST} ${SECOND}`),
    para(BROKEN),
    para(REST),
    para(LAST),
  ],
  footnotes: [],
  ingestionMeta: {
    source: "url",
    sourceUrl: "https://example.com/harbour-split-merge",
    fetchedAt: "2026-11-01T00:00:00.000Z",
    originalHtmlHash: "hash-harbour-split-merge",
    extractionConfidence: "high",
  },
  addedAt: "2026-11-01T00:00:00.000Z",
};

/** A highlight whose words span the boundary a merge would join. */
const acrossRow = () => highlightRow(ARTICLE, "h-across", "the gulls\nfollow it");

test.beforeEach(async ({ page }) => freshLibrary(page, [ARTICLE]));

const frames = (page: Page) => view(page).locator(".correction-view-body .correction-block");
const readingParagraph = (page: Page, text: string) =>
  readingText(page).locator("p").filter({ hasText: text });

const openView = (page: Page) => openArticleView(page, ARTICLE, "The tide is out");

/** Put the caret in a block, `characters` into its text. Placed
 * programmatically — the repo's rule for selections (real-arrow selection
 * in non-editable text is engine-divergent; see the annotations'
 * keyboard-shortcuts spec) — standing in for a reader's caret browsing or
 * screen-reader cursor. Everything after it is keys. */
async function caretAfter(page: Page, text: string, characters: number) {
  await frameFor(page, text).evaluate((el, at) => {
    const first = document
      .createTreeWalker(el.lastElementChild ?? el, NodeFilter.SHOW_TEXT)
      .nextNode() as Text | null;
    if (!first) return;
    const range = document.createRange();
    range.setStart(first, at);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  }, characters);
}

async function readsInBothModes(page: Page, check: () => Promise<void>) {
  await page.keyboard.press("c");
  await expect(view(page)).toBeHidden();
  await expect(modeToggle(page)).toHaveAttribute("aria-label", "Reading mode: paginated");
  await check();
  await switchMode(page);
  await expect(modeToggle(page)).toHaveAttribute("aria-label", "Reading mode: scrolling");
  await check();
}

test.describe("Split and merge blocks (#75)", () => {
  test("splits two paragraphs run together at the caret, keyboard-only", async ({ page }) => {
    await openView(page);
    await expect(frames(page)).toHaveCount(5);
    await caretAfter(page, SECOND, FIRST.length);
    const split = page.getByRole("button", { name: /Split block/ });
    await expect(split).not.toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("s");
    await expect(status(page, "Paragraph split in two.")).toHaveCount(1);
    await expect(dialog(page)).toHaveCount(0);
    await expect(frames(page)).toHaveCount(6);
    await expect(frameFor(page, FIRST)).not.toContainText(SECOND);
    await expect(frameFor(page, SECOND)).not.toContainText(FIRST);

    await readsInBothModes(page, async () => {
      await expect(readingParagraph(page, FIRST)).toHaveText(FIRST);
      await expect(readingParagraph(page, SECOND)).toHaveText(SECOND);
    });
  });

  test("merges a paragraph broken mid-sentence with the next, keyboard-only", async ({ page }) => {
    await openView(page);
    await frameFor(page, BROKEN).focus();
    await page.keyboard.press("j");
    await expect(status(page, "Paragraph merged with the next block.")).toHaveCount(1);
    await expect(dialog(page)).toHaveCount(0);
    await expect(frames(page)).toHaveCount(4);
    await expect(frameFor(page, BROKEN)).toContainText(`${BROKEN} ${REST}`);

    await readsInBothModes(page, async () => {
      await expect(readingParagraph(page, BROKEN)).toHaveText(`${BROKEN} ${REST}`);
    });
  });

  test("a highlight across the merged boundary asks first; Cancel changes nothing", async ({
    page,
  }) => {
    await seedStoreRows(page, "highlights", [acrossRow()]);
    await openView(page);
    const broken = frameFor(page, BROKEN);
    await broken.focus();
    await page.keyboard.press("j");

    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toHaveAccessibleName("Merge these blocks?");
    await expect(dialog(page).getByRole("button", { name: "Cancel" })).toBeFocused();
    await expect(dialog(page).getByRole("list", { name: /Highlights/ })).toContainText("the gulls");
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(status(page, "Nothing was changed.")).toHaveCount(1);
    await expect(frames(page)).toHaveCount(5);
    await expect(broken).toBeFocused();

    // Confirming applies it.
    await page.keyboard.press("j");
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByRole("button", { name: "Merge with next" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(status(page, "Paragraph merged with the next block.")).toHaveCount(1);
    await expect(frames(page)).toHaveCount(4);
  });

  test("an unavailable command says why", async ({ page }) => {
    await openView(page);
    await frameFor(page, LAST).focus();
    await page.keyboard.press("j");
    await expect(status(page, "Nothing comes after this block to merge with.")).toHaveCount(1);
    await expect(page.locator(".correction-commands-reason")).toHaveText(
      "Nothing comes after this block to merge with.",
    );
    await page.keyboard.press("s");
    await expect(status(page, "Put the caret where this block should split.")).toHaveCount(1);
    await expect(frames(page)).toHaveCount(5);
  });
});
