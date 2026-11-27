// Reprocessing an uploaded article and an EPUB book (#64, spec #66 Seam 3):
// the end-to-end run with the ingest endpoint mocked. A reader re-chooses
// the original file; the wrong file is refused calmly with nothing changed,
// the right one goes through the same preview and confirm as URL
// reprocessing, and a book reprocesses as a whole book with its chapter
// consequences in the preview.
import { test, expect } from "@playwright/test";
import { ArticleSchema, BookSchema } from "../../../src/content/schema";
import { prepareFreshPage, seedRows, readRow } from "../portability/_portability";
import { BASE } from "../_base";

const para = (text: string) => ({ kind: "paragraph", content: [{ text, marks: [] }] });
const stamp = "2026-01-01T00:00:00Z";

test("a reader re-chooses an uploaded article's original file to reprocess it", async ({
  page,
}) => {
  const saved = ArticleSchema.parse({
    id: "md-notes-0123456789ab",
    revision: 1,
    lang: "en",
    provenance: { title: "Uploaded notes", retrievedAt: stamp, originalHtmlHash: "sha256:right" },
    blocks: [para("A claim1 with a flattened marker.")],
    ingestionMeta: {
      source: "markdown",
      origin: "upload",
      originalHtmlHash: "sha256:right",
      extractionConfidence: "high",
    },
    tags: ["mine"],
  });
  const processed = (hash: string) => ({
    ...saved,
    tags: undefined,
    provenance: { ...saved.provenance, originalHtmlHash: hash },
    ingestionMeta: { ...saved.ingestionMeta, originalHtmlHash: hash },
    blocks: [para("A claim with a linked marker.")],
  });
  await prepareFreshPage(page);
  await seedRows(page, { articles: [saved] });
  const posted: { markdown?: string }[] = [];
  await page.route("**/api/ingest", async (route) => {
    const body = route.request().postDataJSON() as { markdown?: string };
    posted.push(body);
    const hash = body.markdown === "# right" ? "sha256:right" : "sha256:wrong";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        article: processed(hash),
        confidence: { state: "confident" },
      }),
    });
  });
  await page.goto(`${BASE}/#/`);
  await page.reload();
  await page
    .getByRole("button", { name: `Edit metadata for ${saved.provenance.title}`, exact: true })
    .click();
  await page.locator("summary").filter({ hasText: "Reprocess article" }).click();
  const fileInput = page.getByLabel("Original file", { exact: true });
  const previewButton = page.getByRole("button", { name: "Preview reprocessing", exact: true });
  await expect(previewButton).toBeDisabled();

  // The wrong file: a calm refusal, and the article is untouched.
  await fileInput.setInputFiles({
    name: "other.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# wrong"),
  });
  await previewButton.click();
  await expect(page.getByText(/This is not the original file for this article/)).toBeVisible();
  expect(ArticleSchema.parse(await readRow(page, "articles", saved.id))).toEqual(saved);

  // The original: the same preview and confirm as URL reprocessing.
  await fileInput.setInputFiles({
    name: "notes.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# right"),
  });
  await previewButton.click();
  const region = page.getByRole("region", { name: "Reprocess preview" });
  await expect(region.getByText("This is the file you added.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Apply reprocessing", exact: true }).click();
  await expect(page.locator("dialog.edit-metadata")).not.toBeVisible();
  const after = ArticleSchema.parse(await readRow(page, "articles", saved.id));
  expect(after.revision).toBe(2);
  expect(after.blocks).toEqual([para("A claim with a linked marker.")]);
  expect(after.tags).toEqual(["mine"]);
  expect(posted.map((b) => b.markdown)).toEqual(["# wrong", "# right"]);
});

test("a reader reprocesses an EPUB as a whole book, accepting its chapter consequences", async ({
  page,
}) => {
  const BOOK = "epub-0123456789ab";
  const chapter = (index: number, title: string, hash: string, text: string) =>
    ArticleSchema.parse({
      id: `${BOOK}-c${String(index).padStart(2, "0")}`,
      revision: 1,
      lang: "en",
      provenance: { title, retrievedAt: stamp, originalHtmlHash: `sha256:${hash}` },
      blocks: [para(text)],
      ingestionMeta: {
        source: "epub-chapter",
        origin: "upload",
        originalHtmlHash: `sha256:${hash}`,
        extractionConfidence: "high",
        bookId: BOOK,
        chapterIndex: index,
      },
    });
  const one = chapter(0, "Opening", "one", "The opening chapter begins1 here.");
  const two = chapter(1, "Departing", "two", "This chapter is no longer admitted.");
  const book = BookSchema.parse({
    id: BOOK,
    title: "A reprocessed book",
    authors: [],
    language: "en",
    chapterArticleIds: [one.id, two.id],
    source: "epub-upload",
    originalFileHash: "sha256:book",
    tags: ["shelf"],
    addedAt: stamp,
  });
  const reingested = [
    chapter(0, "Opening", "one", "The opening chapter begins here."),
    chapter(1, "Arriving", "new", "A chapter current ingestion can now read."),
  ];
  await prepareFreshPage(page);
  await seedRows(page, {
    books: [book],
    articles: [one, two].map((c) => ({ ...c, bookId: BOOK })),
  });
  await page.route("**/api/ingest?format=epub", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        book: { ...book, tags: [], chapterArticleIds: reingested.map((c) => c.id) },
        articles: reingested,
        skippedCount: 0,
      }),
    });
  });
  await page.goto(`${BASE}/#/`);
  await page.reload();
  await page.getByRole("button", { name: `Reprocess ${book.title}`, exact: true }).click();
  const dialog = page.locator("dialog.reprocess-book");
  await dialog.getByLabel("Original EPUB", { exact: true }).setInputFiles({
    name: "book.epub",
    mimeType: "application/epub+zip",
    buffer: Buffer.from("epub"),
  });
  await dialog.getByRole("button", { name: "Preview reprocessing", exact: true }).click();
  const region = dialog.getByRole("region", { name: "Reprocess preview" });
  await expect(region.getByText("Added: Arriving.", { exact: false })).toBeVisible();
  await expect(region.getByText("No longer in the book: Departing.")).toBeVisible();
  const apply = region.getByRole("button", { name: "Apply reprocessing", exact: true });
  await expect(apply).toBeDisabled();

  // Cancelling leaves the book untouched.
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(BookSchema.parse(await readRow(page, "books", BOOK))).toEqual(book);

  await page.getByRole("button", { name: `Reprocess ${book.title}`, exact: true }).click();
  await dialog.getByLabel("Original EPUB", { exact: true }).setInputFiles({
    name: "book.epub",
    mimeType: "application/epub+zip",
    buffer: Buffer.from("epub"),
  });
  await dialog.getByRole("button", { name: "Preview reprocessing", exact: true }).click();
  await region.getByRole("checkbox", { name: /Remove chapter “Departing”/ }).check();
  await apply.click();
  await expect(dialog).not.toBeVisible();
  const after = BookSchema.parse(await readRow(page, "books", BOOK));
  expect(after.tags).toEqual(["shelf"]);
  expect(after.chapterArticleIds[0]).toBe(one.id);
  expect(after.chapterArticleIds[1]).not.toBe(two.id);
  const opening = ArticleSchema.parse(await readRow(page, "articles", one.id));
  expect(opening.revision).toBe(2);
  expect(await readRow(page, "articles", two.id)).toBeNull();
});
