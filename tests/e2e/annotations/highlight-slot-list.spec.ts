// tests/e2e/annotations/highlight-slot-list.spec.ts
// Issue #41 (ADR 0012) — highlight slots are an ORDERED list of 1–10. The
// browser seam owns the truths the unit layer cannot:
//   - the Settings › Highlights editor adds, reorders, and removes slots by
//     KEYBOARD alone (real focus movement, the inline confirmation, the
//     polite announcement);
//   - digit `0` is slot 10's key: a tap over a shown selection creates with
//     slot 10's color;
//   - at the 320px reflow target the selection toolbar shows all ten slot
//     pills, wrapping onto more lines, never clipping or scrolling sideways.
import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import {
  FIXTURES,
  openArticle,
  wipeDatabase,
  findFirstBlockWithText,
  selectRangeInBlock,
  countHighlightsInDexie,
} from "./_fixtures";
import { expandSettingsGroup, openSettingsPanel, openSlotEditor } from "../settings";

const FIXTURE = FIXTURES[0]!;

test.beforeEach(async ({ page }) => {
  await wipeDatabase(page);
});

async function openHighlights(page: Page): Promise<Locator> {
  await openArticle(page, FIXTURE);
  const settings = await openSettingsPanel(page);
  await expandSettingsGroup(page, "Highlights");
  return settings;
}

function slotRows(settings: Locator): Locator {
  return settings.locator(".highlight-slot-row-toggle");
}

/** Grow the list to ten slots through the real Add slot control. */
async function addSlotsToTen(settings: Locator): Promise<void> {
  const add = settings.getByRole("button", { name: "Add slot" });
  for (let n = (await slotRows(settings).count()) + 1; n <= 10; n++) {
    await add.click();
    await expect(slotRows(settings)).toHaveCount(n);
  }
}

async function closeSettings(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog.settings-panel")).not.toBeVisible();
}

test.describe("ordered highlight slots (issue #41)", () => {
  test("the editor adds, reorders, and removes slots by keyboard", async ({ page }) => {
    const settings = await openHighlights(page);
    const add = settings.getByRole("button", { name: "Add slot" });

    // Add: Enter on the focused button appends slot 6, opened, focus on its
    // name field.
    await add.focus();
    await page.keyboard.press("Enter");
    await expect(slotRows(settings)).toHaveCount(6);
    const name6 = settings.getByLabel("Slot 6 name");
    await expect(name6).toBeFocused();
    await expect(slotRows(settings).nth(5)).toHaveAccessibleName("Slot 6 · Neutral");
    await page.keyboard.type("Questions");
    await expect(slotRows(settings).nth(5)).toHaveAccessibleName("Slot 6: Questions");

    // Reorder: Move up by keyboard — announced, focus stays on the control,
    // the open editor travels with its slot.
    const editor6 = settings.getByRole("group", { name: "Slot 6", exact: true });
    await editor6.getByRole("button", { name: "Move up" }).focus();
    await page.keyboard.press("Enter");
    await expect(settings.locator(".status").filter({ hasText: "Moved to slot 5." })).toHaveCount(
      1,
    );
    const editor5 = settings.getByRole("group", { name: "Slot 5", exact: true });
    await expect(editor5.getByLabel("Slot 5 name")).toHaveValue("Questions");
    await expect(editor5.getByRole("button", { name: "Move up" })).toBeFocused();
    await expect(slotRows(settings).nth(4)).toHaveAccessibleName("Slot 5: Questions");
    await expect(slotRows(settings).nth(5)).toHaveAccessibleName("Slot 6: Pink");

    // Remove: the inline confirmation names the slot and lands focus on the
    // non-destructive answer; Escape keeps the slot (and the panel open).
    await editor5.getByRole("button", { name: "Remove" }).focus();
    await page.keyboard.press("Enter");
    await expect(
      editor5.getByText(
        "Remove slot 5 ‘Questions’? Highlights you made with it keep their color and tags.",
      ),
    ).toBeVisible();
    await expect(editor5.getByRole("button", { name: "Keep slot" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog.settings-panel")).toBeVisible();
    await expect(editor5.getByRole("button", { name: "Remove" })).toBeFocused();
    await expect(slotRows(settings)).toHaveCount(6);

    // Confirm by keyboard: the slot goes, focus lands on the row that took
    // its place.
    await page.keyboard.press("Enter");
    await editor5.getByRole("button", { name: "Remove slot" }).focus();
    await page.keyboard.press("Enter");
    await expect(slotRows(settings)).toHaveCount(5);
    await expect(slotRows(settings).nth(4)).toHaveAccessibleName("Slot 5: Pink");
    await expect(slotRows(settings).nth(4)).toBeFocused();
  });

  test("removing the default slot makes slot 1 the default, with a visible note", async ({
    page,
  }) => {
    await openArticle(page, FIXTURE);
    const editor = await openSlotEditor(page, 3);
    await editor.getByLabel("Default for new highlights").check();
    const settings = page.locator("dialog.settings-panel");
    await expect(slotRows(settings).nth(2)).toHaveAccessibleName(
      "Slot 3: Green, default for new highlights",
    );
    await editor.getByRole("button", { name: "Remove" }).click();
    await editor.getByRole("button", { name: "Remove slot" }).click();
    await expect(
      settings.locator(".settings-hint", {
        hasText: "Slot 1 is now the default for new highlights.",
      }),
    ).toBeVisible();
    await expect(slotRows(settings).nth(0)).toHaveAccessibleName(
      "Slot 1: Default, default for new highlights",
    );
  });

  test("at ten slots Add slot is unavailable and says why", async ({ page }) => {
    const settings = await openHighlights(page);
    await addSlotsToTen(settings);
    const add = settings.getByRole("button", { name: "Add slot" });
    await expect(add).toHaveAttribute("aria-disabled", "true");
    await expect(settings.getByText("Up to 10 slots")).toBeVisible();
    // Still focusable (aria-disabled), and activating it adds nothing.
    await add.focus();
    await page.keyboard.press("Enter");
    await expect(add).toBeFocused();
    await expect(slotRows(settings)).toHaveCount(10);
  });

  test("digit 0 is slot 10's key: a tap creates with slot 10", async ({ page }) => {
    const settings = await openHighlights(page);
    await addSlotsToTen(settings);
    const editor10 = await openSlotEditor(page, 10);
    await editor10.getByRole("radio", { name: "Pink" }).check();
    await expect(slotRows(settings).nth(9)).toHaveAccessibleName("Slot 10 · Pink");
    await closeSettings(page);

    const toolbar = page.getByRole("toolbar", { name: "Highlight actions" });
    const blockIdx = await findFirstBlockWithText(page, 24);
    expect(await selectRangeInBlock(page, blockIdx, 0, 18)).toBeTruthy();
    await expect(toolbar.getByRole("button", { name: "Slot 10 · Pink" })).toBeVisible();
    await page.keyboard.press("0");
    await expect(page.locator("mark.highlight").first()).toHaveClass(/color-pink/);
    await expect.poll(async () => countHighlightsInDexie(page, FIXTURE)).toBe(1);
  });

  test("a digit beyond the slot count does nothing", async ({ page }) => {
    const settings = await openHighlights(page);
    // Shrink to four slots: remove slot 5.
    const editor5 = await openSlotEditor(page, 5);
    await editor5.getByRole("button", { name: "Remove" }).click();
    await editor5.getByRole("button", { name: "Remove slot" }).click();
    await expect(slotRows(settings)).toHaveCount(4);
    await closeSettings(page);

    const toolbar = page.getByRole("toolbar", { name: "Highlight actions" });
    const blockIdx = await findFirstBlockWithText(page, 24);
    expect(await selectRangeInBlock(page, blockIdx, 0, 18)).toBeTruthy();
    await expect(toolbar.getByRole("button", { name: "Slot 4: Blue" })).toBeVisible();
    await page.keyboard.press("5");
    await page.keyboard.press("0");
    await expect(toolbar).toBeVisible();
    await expect(page.locator("mark.highlight")).toHaveCount(0);
    expect(await countHighlightsInDexie(page, FIXTURE)).toBe(0);
  });

  test("at 320px the toolbar shows every one of ten slots, wrapping without clipping", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const settings = await openHighlights(page);
    await addSlotsToTen(settings);
    await closeSettings(page);

    const toolbar = page.getByRole("toolbar", { name: "Highlight actions" });
    const blockIdx = await findFirstBlockWithText(page, 24);
    expect(await selectRangeInBlock(page, blockIdx, 0, 18)).toBeTruthy();
    const pills = toolbar.locator(".selection-toolbar-slot");
    await expect(pills).toHaveCount(10);
    await expect(toolbar.locator("button", { hasText: "More" })).toHaveCount(0);
    const facts = await toolbar.evaluate((el) => {
      const tb = el.getBoundingClientRect();
      const boxes = [...el.querySelectorAll(".selection-toolbar-slot")].map((b) =>
        b.getBoundingClientRect(),
      );
      return {
        toolbarLeft: tb.left,
        toolbarRight: tb.right,
        viewport: document.documentElement.clientWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
        rows: new Set(boxes.map((b) => Math.round(b.top))).size,
        allInside: boxes.every(
          (b) => b.width > 0 && b.left >= tb.left - 0.5 && b.right <= tb.right + 0.5,
        ),
      };
    });
    expect(facts.toolbarLeft).toBeGreaterThanOrEqual(0);
    expect(facts.toolbarRight).toBeLessThanOrEqual(facts.viewport);
    expect(facts.pageScrollWidth).toBeLessThanOrEqual(facts.viewport);
    expect(facts.allInside).toBe(true);
    expect(facts.rows).toBeGreaterThan(1);
  });
});
