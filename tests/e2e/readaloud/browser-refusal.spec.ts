import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { openArticle } from "./_harness";

/** One persisted reader-prefs field, read straight from Dexie (raw
 * IndexedDB). Settings saves are debounced (400 ms) and then written
 * asynchronously, so a reload must wait for the WRITE, not a fixed sleep:
 * a 500 ms sleep left ~100 ms for the write and lost it on the 3-core
 * hosted macOS runner (#3 hosted shadow, run 45729460283). */
async function persistedPref(page: Page, field: string): Promise<unknown> {
  return page.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("lem-reader");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const row = await new Promise<{ value?: Record<string, unknown> } | undefined>(
        (resolve, reject) => {
          const getReq = db
            .transaction("settings", "readonly")
            .objectStore("settings")
            .get("reader-prefs");
          getReq.onsuccess = () => resolve(getReq.result);
          getReq.onerror = () => reject(getReq.error);
        },
      );
      return row?.value?.[name];
    } finally {
      db.close();
    }
  }, field);
}

test("Firefox explains the audio limitation without starting synthesis", async ({ page }) => {
  await openArticle(page, "word");
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Macintosh) Gecko/20100101 Firefox/157.0",
    });
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "Read aloud", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "only supported in Chromium" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Read-aloud availability" })).toHaveCount(0);
  await expect.poll(() => persistedPref(page, "speechNoticeDismissed")).toBe(true);
  await page.reload();
  await expect(page.getByRole("complementary", { name: "Read-aloud availability" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { __speechSpoken: unknown[] }).__speechSpoken.length,
    ),
  ).toBe(0);
});

test("read-aloud controls can be hidden and restored in settings", async ({ page }) => {
  await openArticle(page, "word");
  await page.getByRole("button", { name: "Reading settings", exact: true }).click();
  await page
    .locator(".settings-group > summary")
    .filter({ hasText: /^Read-aloud$/ })
    .click();
  const toggle = page.getByRole("checkbox", { name: "Show read-aloud controls" });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(page.getByRole("button", { name: "Read aloud", exact: true })).toHaveCount(0);
  await expect.poll(() => persistedPref(page, "showReadAloud")).toBe(false);
  await page.reload();
  await expect(page.getByRole("button", { name: "Read aloud", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Reading settings", exact: true }).click();
  const group = page.locator(".settings-group > summary").filter({ hasText: /^Read-aloud$/ });
  if (!(await group.evaluate((el) => (el.parentElement as HTMLDetailsElement).open)))
    await group.click();
  await toggle.check();
  await expect(page.getByRole("button", { name: "Read aloud", exact: true })).toBeAttached();
});
