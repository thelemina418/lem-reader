// tests/e2e/corrections/move-words.spec.ts
// Spec #68 / issue #73 — the caption example from #51 end to end, keyboard
// only (seam 3): in the Correction view the reader moves to the figure,
// selects the stray words at the end of its caption with Shift+←, and
// presses ] ("Move to next block"). The caption is a caption again and the
// paragraph is whole, in paged and scrolling reading; leaving lands on the
// moved sentence. Unavailable commands say why; each command is announced.
// A highlight across the moved boundary asks first (Cancel changes nothing).
import { test, expect, type Page } from "@playwright/test";
import { modeToggle, switchMode, wipeDatabase } from "../annotations/_fixtures";
import { seedStoreRows } from "../library/seedStoreRows";
import { BASE } from "../_base";
import { ArticleSchema } from "../../../src/content/schema";
import { deriveQuoteSelector, normalizeText } from "../../../src/content/normalizeText";

const para = (text: string) => ({ kind: "paragraph", content: [{ text, marks: [] }] });
const filler = (n: number) =>
  para(
    `Paragraph ${n}. The tide turns slowly in the harbour, and the boats swing on their moorings ` +
      `while the gulls argue over the nets drying along the quay wall in the early light.`,
  );

const STRAY = "The mayor said the ferry would keep running";
const REST = "through the winter, whatever the weather.";
const CAPTION = "The harbour at dawn. Photo: Ana Ruiz.";
const ARTICLE = {
  id: "harbour-caption",
  revision: 1,
  lang: "en",
  provenance: {
    sourceUrl: "https://example.com/harbour-caption",
    title: "The Harbour at Dawn",
    retrievedAt: "2026-11-01T00:00:00.000Z",
    originalHtmlHash: "hash-harbour-caption",
  },
  blocks: [
    { kind: "heading", level: 2, content: [{ text: "Leaving port", marks: [] }] },
    ...[1, 2, 3, 4, 5, 6].map(filler),
    {
      kind: "figure",
      // Real alt text: an empty-alt placeholder's "Image unavailable." chrome
      // is miscounted as text by scroll restore (pre-existing, see #73 notes).
      alt: "Fishing boats moored at the quay at first light",
      src: "https://example.com/harbour.jpg",
      caption: [
        { text: "The harbour at dawn. ", marks: [] },
        { text: "Photo: Ana Ruiz.", marks: [{ type: "em" }] },
        { text: " The ", marks: [] },
        { text: "mayor", marks: [{ type: "link", href: "https://example.com/mayor" }] },
        { text: " said the ferry would keep running", marks: [] },
      ],
    },
    para(REST),
    ...[7, 8, 9, 10, 11, 12].map(filler),
  ],
  footnotes: [],
  ingestionMeta: {
    source: "url",
    sourceUrl: "https://example.com/harbour-caption",
    fetchedAt: "2026-11-01T00:00:00.000Z",
    originalHtmlHash: "hash-harbour-caption",
    extractionConfidence: "high",
  },
  addedAt: "2026-11-01T00:00:00.000Z",
};
const MOVED_NEXT =
  "Moved “The mayor said the ferry would keep…” to the next block. Press Ctrl+Z to undo.";
const MADE_OWN =
  "Made “The mayor said the ferry would keep…” its own paragraph. Press Ctrl+Z to undo.";
const FIGURE = 7;
const PARAGRAPH = 8;

const canonical = ArticleSchema.parse(ARTICLE);
function highlightRow(id: string, exact: string) {
  const text = normalizeText(canonical);
  const start = [...text.slice(0, text.indexOf(exact))].length;
  const position = { start, end: start + [...exact].length };
  return {
    schemaVersion: 1,
    id,
    articleId: ARTICLE.id,
    revision: 1,
    position,
    quote: deriveQuoteSelector(canonical, position),
    createdAt: "2026-11-02T00:00:00.000Z",
  };
}

test.beforeEach(async ({ page }) => {
  await wipeDatabase(page);
  await page.goto(`${BASE}/#/`);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Saved articles" })).toBeVisible();
  await seedStoreRows(page, "articles", [ARTICLE]);
});

const view = (page: Page) => page.locator(".correction-view");
const status = (page: Page, text: string | RegExp) =>
  page.getByRole("status").filter({ hasText: text });
const surface = (page: Page) =>
  page
    .locator(".page-fragment, .article-body:not(.article-body-measurement)")
    .filter({ hasNot: page.locator(".correction-view") });

async function openReader(page: Page) {
  await page.goto(`${BASE}/#/article/${ARTICLE.id}`);
  await expect(page.getByRole("heading", { level: 1, name: "The Harbour at Dawn" })).toBeVisible();
  await expect(surface(page).first()).toContainText("Leaving port");
}

/** Keyboard only: enter the view, ArrowDown to the figure, select the stray
 * words from the caption's end with Shift+←, one word at a time. */
async function selectStrayWords(page: Page) {
  await page.keyboard.press("c");
  await expect(view(page)).toBeVisible();
  await expect(status(page, "Correction view. Selecting text offers corrections.")).toHaveCount(1);
  const figure = view(page).locator(`[data-correction-block="${FIGURE}"]`);
  for (let i = 0; i < 20; i++) {
    if (await figure.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("ArrowDown");
  }
  await expect(figure).toBeFocused();
  await selectBackToStray(page);
}

/** Shift+← a word at a time until the selection reads the stray words (a
 * highlight tint or a link is an extra word stop in some engines). */
async function selectBackToStray(page: Page) {
  const surface = page.locator(".correction-selection-commands");
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Shift+ArrowLeft");
    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
    if (selected.trim().startsWith("The mayor said")) break;
  }
  await expect(surface).toContainText("Selected: “The mayor said the ferry…”");
}

/** The Correction-view block's text, without its type label. */
const frameText = (page: Page, key: number) =>
  view(page).locator(`[data-correction-block="${key}"] > :not(.correction-block-label)`).first();

test.describe("Move words to the next block — the caption example (#73)", () => {
  test("keyboard only: select the stray words, press ], read the corrected caption and paragraph", async ({
    page,
  }) => {
    await openReader(page);
    await expect(modeToggle(page)).toHaveAttribute("aria-label", "Reading mode: paginated");
    await selectStrayWords(page);

    // The shortcuts are listed in the view.
    const shortcuts = view(page).locator(".correction-shortcuts");
    await expect(shortcuts).toContainText("Move the selected words to the next block");
    await expect(shortcuts).toContainText("Make the selected words their own paragraph");

    // Unavailable commands say why — on the button and when pressed.
    const previous = page.locator('.correction-command[data-command="move-previous"]');
    await expect(previous).toHaveAttribute("aria-disabled", "true");
    await expect(previous).toHaveAccessibleDescription(/Only words at the start of a block/);
    await page.keyboard.press("[");
    await expect(status(page, /Only words at the start of a block/)).toHaveCount(1);
    const next = page.locator('.correction-command[data-command="move-next"]');
    await expect(next).not.toHaveAttribute("aria-disabled", "true");
    await expect(next).toHaveAttribute("aria-keyshortcuts", "]");

    await page.keyboard.press("]");
    await expect(status(page, MOVED_NEXT)).toHaveCount(1);
    // No highlight or chapter involved → applied at once, no dialog.
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(frameText(page, FIGURE)).toContainText(CAPTION);
    await expect(frameText(page, FIGURE)).not.toContainText("mayor");
    await expect(frameText(page, PARAGRAPH)).toHaveText(`${STRAY} ${REST}`);
    // Focus follows the moved words.
    await expect(view(page).locator(`[data-correction-block="${PARAGRAPH}"]`)).toBeFocused();
    // The link travelled with its word.
    await expect(frameText(page, PARAGRAPH).locator("a, .inert-link")).toHaveText("mayor");

    // Leave: paged reading lands on the moved sentence's page.
    await page.keyboard.press("c");
    await expect(view(page)).toBeHidden();
    const paged = page.locator(".page-fragment");
    await expect(paged.first()).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          (i) => document.querySelector(`.page-fragment [data-block-index="${i}"]`) !== null,
          PARAGRAPH,
        ),
      )
      .toBe(true);
    await expect(page.locator(".page-fragment figcaption").first()).toHaveText(CAPTION);
    await expect(paged.filter({ hasText: `${STRAY} through the winter` })).toHaveCount(1);

    // Scrolling reading shows it too.
    await switchMode(page);
    const scrolling = page.locator(".article-body:not(.article-body-measurement)").first();
    await expect(scrolling.locator("figcaption")).toHaveText(CAPTION);
    await expect(scrolling.locator(`[data-block-index="${PARAGRAPH}"]`)).toHaveText(
      `${STRAY} ${REST}`,
    );
  });

  test("leaving from scrolling reading lands on the moved sentence, not a stale offset", async ({
    page,
  }) => {
    await openReader(page);
    await switchMode(page);
    await selectStrayWords(page);
    await page.keyboard.press("]");
    await expect(status(page, /^Moved/)).toHaveCount(1);
    await page.keyboard.press("c");
    await expect(view(page)).toBeHidden();
    // The top-visible block is the paragraph now holding the moved words.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const header = document.querySelector(".app-header")?.getBoundingClientRect().bottom ?? 0;
          const blocks = Array.from(
            document.querySelectorAll<HTMLElement>(".article-body [data-block-index]"),
          ).filter((el) => !el.closest(".article-body-measurement"));
          for (const el of blocks) {
            const r = el.getBoundingClientRect();
            if (r.bottom > header + 1 && r.height > 0) return el.textContent;
          }
          return null;
        }),
      )
      .toContain(STRAY);
  });

  test("a highlight across the moved boundary asks first; Cancel changes nothing", async ({
    page,
  }) => {
    await seedStoreRows(page, "highlights", [
      highlightRow("h-across", "Ana Ruiz. The mayor"),
      highlightRow("h-inside", "ferry would keep"),
    ]);
    await openReader(page);
    await selectStrayWords(page);
    await page.keyboard.press("]");
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Move these words to the next block?");
    await expect(dialog).toContainText("Ana Ruiz. The mayor");
    await expect(dialog).toContainText("crosses a block boundary that moves");
    // The highlight wholly inside the moved words still matches: not listed.
    await expect(dialog).not.toContainText("ferry would keep");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(status(page, "Nothing was changed.")).toHaveCount(1);
    await expect(frameText(page, FIGURE)).toContainText(STRAY);

    // Confirming applies it.
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    const figure = view(page).locator(`[data-correction-block="${FIGURE}"]`);
    await figure.focus();
    await selectBackToStray(page);
    await page.keyboard.press("]");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Move words" }).click();
    await expect(status(page, MOVED_NEXT)).toHaveCount(1);
    await expect(frameText(page, PARAGRAPH)).toHaveText(`${STRAY} ${REST}`);
  });

  test("make the stray words their own paragraph with P", async ({ page }) => {
    await openReader(page);
    await selectStrayWords(page);
    await page.keyboard.press("p");
    await expect(status(page, MADE_OWN)).toHaveCount(1);
    await expect(frameText(page, FIGURE)).toContainText(CAPTION);
    await expect(frameText(page, PARAGRAPH)).toHaveText(STRAY);
    await expect(frameText(page, PARAGRAPH + 1)).toHaveText(REST);
    // Ctrl+Z undoes it (#76's session history takes every command).
    await page.keyboard.press("Control+z");
    await expect(status(page, /^Undone: Made “The mayor said/)).toHaveCount(1);
    await expect(frameText(page, FIGURE)).toContainText(STRAY);
    await expect(frameText(page, PARAGRAPH)).toHaveText(REST);
  });
});
