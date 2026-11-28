// tests/e2e/corrections/change-type.spec.ts
// Spec #68 / issue #74 — change a block's type in the Correction view
// (seam 3). T opens "Change type" for the current block (no selection
// needed); unavailable choices stay listed with their reason. A paragraph
// becoming a Heading 2 adds a chapter — the consequences dialog says so
// first — and then drives the contents panel; a stray paragraph becomes a
// figure's caption in paged and scrolling reading; a code block round trip
// keeps its text and spacing; an EPUB chapter's heading correction updates
// that chapter's contents.
import { test, expect, type Page } from "@playwright/test";
import { modeToggle, switchMode } from "../annotations/_fixtures";
import { seedStoreRows } from "../library/seedStoreRows";
import {
  dialog,
  frameFor,
  freshLibrary,
  openReader,
  openView as openArticleView,
  para,
  readingText,
  status,
  view,
} from "./_corrections";
const h2 = (text: string) => ({ kind: "heading", level: 2, content: [{ text, marks: [] }] });

const CAPTION = "The morning ferry at the quay, photographed in 1932.";
const CODE = "def tide(hour):\n    return hour  * 2\n\n  # high water";

function article(id: string, title: string, blocks: unknown[], extra: object = {}) {
  return {
    id,
    revision: 1,
    lang: "en",
    provenance: {
      sourceUrl: `https://example.com/${id}`,
      title,
      retrievedAt: "2026-11-01T00:00:00.000Z",
      originalHtmlHash: `hash-${id}`,
    },
    blocks,
    footnotes: [],
    ingestionMeta: {
      source: "url",
      sourceUrl: `https://example.com/${id}`,
      fetchedAt: "2026-11-01T00:00:00.000Z",
      originalHtmlHash: `hash-${id}`,
      extractionConfidence: "high",
    },
    addedAt: "2026-11-01T00:00:00.000Z",
    ...extra,
  };
}

const HARBOUR = article("harbour-types", "The Harbour at Dawn", [
  h2("Leaving port"),
  para("The ferry leaves at dawn, before the fog has lifted off the water."),
  { kind: "figure", alt: "A ferry moored at a stone quay", caption: [] },
  para(CAPTION),
  para("Open water"),
  para("By the time the sun is up, the far shore has come into view."),
  { kind: "code-block", language: "py", source: CODE },
  para("Gulls follow it out past the breakwater and wheel back toward the town."),
]);

const BOOK_ID = "epub-tidebook0000";
const CHAPTER_IDS = ["tide-epub-c01", "tide-epub-c02"];
const chapter = (id: string, index: number, blocks: unknown[]) =>
  article(id, `Chapter ${index}`, blocks, {
    bookId: BOOK_ID,
    ingestionMeta: {
      source: "epub-chapter",
      origin: "upload",
      bookId: BOOK_ID,
      chapterIndex: index,
      originalHtmlHash: `sha256:${"c".repeat(64)}`,
      ingestedAt: "2026-10-01T00:00:00.000Z",
      extractionConfidence: "high",
    },
  });
const BOOK = {
  id: BOOK_ID,
  title: "The Tide Book",
  authors: ["A. Keeper"],
  language: "en",
  chapterArticleIds: CHAPTER_IDS,
  skippedChapterCount: 0,
  source: "epub-upload",
  originalFileHash: `sha256:${"d".repeat(64)}`,
  addedAt: "2026-10-01T00:00:00.000Z",
};

test.beforeEach(async ({ page }) => freshLibrary(page, []));

const typeMenu = (page: Page) => page.locator(".correction-type-menu");
const openView = (page: Page, id: string, title: string) =>
  openArticleView(page, { id, provenance: { title } });

/** Focus the block holding `text`, press T and choose `choice`. */
async function changeType(page: Page, text: string, choice: string) {
  await frameFor(page, text).focus();
  await page.keyboard.press("t");
  await expect(typeMenu(page)).toBeVisible();
  await typeMenu(page).getByRole("button", { name: choice, exact: true }).click();
}

async function contentsEntries(page: Page) {
  await page.getByRole("button", { name: "Table of contents" }).click();
  const toc = page.getByRole("navigation", { name: "Table of contents" });
  await expect(toc).toBeVisible();
  const entries = await toc.getByRole("link").allTextContents();
  await page.keyboard.press("Escape");
  return entries;
}

test.describe("Change a block's type (#74)", () => {
  test("a paragraph becomes a Heading 2 after confirming the chapter it adds, and joins the contents", async ({
    page,
  }) => {
    await seedStoreRows(page, "articles", [HARBOUR]);
    await openReader(page, HARBOUR);
    expect(await contentsEntries(page)).not.toContain("Open water");

    await page.keyboard.press("c");
    await expect(view(page)).toBeVisible();
    await frameFor(page, "Open water").focus();
    await page.keyboard.press("t");
    // Keyboard: focus lands on the first available choice; a figure-only
    // reason shows beside an unavailable one.
    await expect(typeMenu(page)).toHaveAccessibleName("Change Paragraph to");
    const paragraphChoice = typeMenu(page).getByRole("button", { name: "Paragraph", exact: true });
    await expect(paragraphChoice).toHaveAttribute("aria-disabled", "true");
    await expect(paragraphChoice).toHaveAccessibleDescription("This block is already a paragraph.");
    await expect(typeMenu(page).getByRole("button", { name: "Heading 1" })).toBeFocused();
    // Escape closes the menu and returns focus to the block.
    await page.keyboard.press("Escape");
    await expect(typeMenu(page)).toHaveCount(0);
    await expect(frameFor(page, "Open water")).toBeFocused();
    await expect(view(page)).toBeVisible();

    await page.keyboard.press("t");
    await page.keyboard.press("ArrowDown");
    await expect(typeMenu(page).getByRole("button", { name: "Heading 2" })).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toHaveAccessibleName("Change this block to Heading 2?");
    await expect(
      dialog(page).getByRole("list", { name: "Contents after this correction" }),
    ).toHaveText("Adds chapter “Open water”");
    // Cancel changes nothing.
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(frameFor(page, "Open water")).toHaveAttribute("aria-label", "Paragraph");

    await changeType(page, "Open water", "Heading 2");
    await dialog(page).getByRole("button", { name: "Change to Heading 2" }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(status(page, "Paragraph is now Heading 2.")).toHaveCount(1);
    await expect(frameFor(page, "Open water")).toHaveAttribute("aria-label", "Heading 2");

    await page.keyboard.press("c");
    await expect(view(page)).toBeHidden();
    await expect(
      readingText(page).getByRole("heading", { level: 2, name: "Open water" }),
    ).toHaveCount(1);
    expect(await contentsEntries(page)).toContain("Open water");
  });

  test("a stray paragraph becomes the figure's caption in paged and scrolling reading", async ({
    page,
  }) => {
    await seedStoreRows(page, "articles", [HARBOUR]);
    await openView(page, HARBOUR.id, "The Harbour at Dawn");
    // A paragraph with no figure beside it says why it can't be a caption.
    await frameFor(page, "far shore").focus();
    await page.keyboard.press("t");
    await expect(
      typeMenu(page).getByRole("button", { name: "Caption" }),
    ).toHaveAccessibleDescription("There's no figure right before or after this paragraph.");
    await page.keyboard.press("Escape");

    await changeType(page, CAPTION, "Caption");
    // The words don't change and no chapter moves: applied at once.
    await expect(dialog(page)).toHaveCount(0);
    await expect(status(page, "Paragraph is now the figure's caption.")).toHaveCount(1);
    await expect(frameFor(page, CAPTION)).toHaveAttribute("aria-label", "Figure with caption");

    await page.keyboard.press("c");
    await expect(view(page)).toBeHidden();
    await expect(modeToggle(page)).toHaveAttribute("aria-label", "Reading mode: paginated");
    await expect(readingText(page).locator("figure figcaption")).toHaveText(CAPTION);
    await switchMode(page);
    await expect(modeToggle(page)).toHaveAttribute("aria-label", "Reading mode: scrolling");
    await expect(readingText(page).locator("figure figcaption")).toHaveText(CAPTION);
  });

  test("a code block round trip keeps its text and spacing", async ({ page }) => {
    await seedStoreRows(page, "articles", [HARBOUR]);
    await openView(page, HARBOUR.id, "The Harbour at Dawn");
    await changeType(page, "def tide(hour):", "Paragraph");
    await expect(status(page, "Code is now Paragraph.")).toHaveCount(1);
    const frame = frameFor(page, "def tide(hour):");
    await expect(frame).toHaveAttribute("aria-label", "Paragraph");
    await expect(frame.locator("pre")).toHaveCount(0);

    await changeType(page, "def tide(hour):", "Code block");
    await expect(status(page, "Paragraph is now Code block.")).toHaveCount(1);
    await expect(frame).toHaveAttribute("aria-label", "Code block");
    expect(await frame.locator("pre").textContent()).toBe(CODE);

    await page.keyboard.press("c");
    await expect(view(page)).toBeHidden();
    await switchMode(page);
    expect(await readingText(page).locator("pre").textContent()).toBe(CODE);
  });

  test("a heading correction inside an EPUB chapter updates that chapter's contents", async ({
    page,
  }) => {
    await seedStoreRows(page, "books", [BOOK]);
    await seedStoreRows(page, "articles", [
      chapter(CHAPTER_IDS[0]!, 1, [
        h2("The first tide"),
        para("Water climbs the harbour wall twice a day."),
      ]),
      chapter(CHAPTER_IDS[1]!, 2, [
        h2("Spring tides"),
        para("At new moon the water climbs higher than usual."),
        para("Neap tides"),
        para("A week later the range is at its smallest."),
      ]),
    ]);
    await openView(page, CHAPTER_IDS[1]!, "Chapter 2");
    expect(await page.locator(".correction-block").count()).toBeGreaterThan(0);
    await changeType(page, "Neap tides", "Heading 2");
    await expect(
      dialog(page).getByRole("list", { name: "Contents after this correction" }),
    ).toHaveText("Adds chapter “Neap tides”");
    await dialog(page).getByRole("button", { name: "Change to Heading 2" }).click();
    await expect(dialog(page)).toHaveCount(0);

    await page.keyboard.press("c");
    await expect(view(page)).toBeHidden();
    expect(await contentsEntries(page)).toEqual(
      expect.arrayContaining(["Spring tides", "Neap tides"]),
    );
    // The other chapter of the book is untouched.
    await openReader(page, { id: CHAPTER_IDS[0]!, provenance: { title: "Chapter 1" } });
    expect(await contentsEntries(page)).not.toContain("Neap tides");
  });
});
