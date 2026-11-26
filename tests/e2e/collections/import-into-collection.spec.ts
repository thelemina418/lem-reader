// tests/e2e/collections/import-into-collection.spec.ts
// Issue #15 — "Import into collection" (collections-and-long-works.md § 9a):
// the browser seam the unit suites cannot see — real <dialog> focus,
// real ingest (the Vite dev middleware's paste pipeline), real IndexedDB.
//
//   - IMP-15-01 — keyboard flow: the button opens the ORDINARY import
//     dialog named for the collection; a paste import saves to the library,
//     appends a whole-reading entry at the END, closes onto the collection
//     page, focuses the new entry's link, and announces the save.
//   - IMP-15-02 — importing the same paste again: already in the library
//     AND already in this collection → said in the dialog, nothing added.
//   - IMP-15-03 — the library import is unchanged: the header-row Add
//     dialog still reads "Add to your library" with its Open-after-adding
//     choice, after a collection import used the same dialog.
import { test, expect, type Page } from "@playwright/test";
import { BASE } from "../_base";
import { wipeDatabase } from "../annotations/_fixtures";
import { openAddDialog, pickSource } from "../library/add-dialog";

const COLLECTION = "Harbor reading";
const PASTE_TITLE = "The Lighthouse Keeper's Log";
const PASTE_HTML = `<article><h1>${PASTE_TITLE}</h1>
<p>The keeper wrote each evening in a careful hand, noting the weather, the ships that passed, and the small repairs that the lamp and its brass fittings demanded through the long season.</p>
<p>Visitors rarely came, but when they did the keeper walked them up the spiral stair and showed them the lens, explaining how a single flame could reach so far across the dark water.</p>
<p>By the end of the year the log had become a record of patience, and the keeper read it back in the winter evenings with a quiet sense of having kept something steady.</p>
</article>`;

async function boot(page: Page): Promise<void> {
  await page.goto(`${BASE}/#/`);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Saved articles" })).toBeVisible();
}

async function createAndOpenCollection(page: Page): Promise<void> {
  await page.goto(`${BASE}/#/collections`);
  await expect(page.getByRole("heading", { level: 1, name: "Collections" })).toBeVisible();
  await page.fill("#collections-new-name", COLLECTION);
  await page.press("#collections-new-name", "Enter");
  await page.getByRole("link", { name: COLLECTION, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: COLLECTION })).toBeVisible();
}

async function importPaste(page: Page): Promise<void> {
  const trigger = page.getByRole("button", { name: "Import into collection" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: `Import into ${COLLECTION}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: "Open after adding" })).toHaveCount(0);
  await pickSource(page, "paste");
  await dialog.getByRole("textbox", { name: /paste html/i }).fill(PASTE_HTML);
  await dialog.getByRole("button", { name: /add pasted article/i }).focus();
  await page.keyboard.press("Enter");
}

test.describe("Import into collection (issue #15)", () => {
  test.beforeEach(async ({ page }) => {
    await wipeDatabase(page);
    await boot(page);
  });

  test("keyboard import saves, appends, focuses the new entry, and announces (IMP-15-01)", async ({
    page,
  }) => {
    await createAndOpenCollection(page);
    await importPaste(page);

    const newLink = page
      .locator("ol.collection-entries > li")
      .last()
      .getByRole("link", { name: PASTE_TITLE });
    await expect(newLink).toBeFocused();
    await expect(page).toHaveURL(/#\/collections\/[a-z0-9-]+$/);
    await expect(
      page.getByRole("status").filter({
        hasText: `Saved to your library and added to ${COLLECTION}.`,
      }),
    ).toBeVisible();
    await expect(page.locator("dialog.add-dialog")).not.toBeVisible();

    // The reading is in the library as an ordinary item.
    await page.goto(`${BASE}/#/`);
    await expect(page.getByRole("link", { name: PASTE_TITLE, exact: true })).toBeVisible();
  });

  test("re-importing the same reading says it's already here and adds nothing (IMP-15-02)", async ({
    page,
  }) => {
    await createAndOpenCollection(page);
    await importPaste(page);
    await expect(page.locator("ol.collection-entries > li")).toHaveCount(1);

    await importPaste(page);
    const dialog = page.getByRole("dialog", { name: `Import into ${COLLECTION}` });
    await expect(
      dialog.getByText(`That reading is already in ${COLLECTION}. Nothing was added.`),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Import into collection" })).toBeFocused();
    await expect(page.locator("ol.collection-entries > li")).toHaveCount(1);
  });

  test("the library Add dialog is unchanged after a collection import (IMP-15-03)", async ({
    page,
  }) => {
    await createAndOpenCollection(page);
    await importPaste(page);
    await expect(page.locator("ol.collection-entries > li")).toHaveCount(1);

    await page.goto(`${BASE}/#/`);
    await expect(page.getByRole("heading", { level: 1, name: "Saved articles" })).toBeVisible();
    await openAddDialog(page);
    const dialog = page.getByRole("dialog", { name: "Add to your library" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("checkbox", { name: "Open after adding" })).toBeVisible();
  });
});
