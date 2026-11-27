// tests/e2e/annotations/highlight-slot-carets.spec.ts
// Issue #39 — Settings › Highlights: each slot row (the #222 accordion)
// carries a disclosure caret. The browser seam owns the layout truth:
//   - the caret paints the SAME native marker as the panel's <details>
//     summaries — the oracle is the engine's own computed list-style-type on
//     the Highlights summary (collapsed → closed glyph, open → open glyph),
//     not a hand-copied value;
//   - same size (computed font-size equals the summary's) and colour
//     (currentColor: it follows the row's ink) in every theme family;
//   - leading position, decorative (aria-hidden), and NO rotation/transition
//     under reduced motion;
//   - it fits at the 320px reflow target.
import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { FIXTURES, openArticle, wipeDatabase } from "./_fixtures";
import { expandSettingsGroup, openSettingsPanel } from "../settings";

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

function slotToggle(settings: Locator, slot: number): Locator {
  return settings.getByRole("button", { name: new RegExp(`^Slot ${slot}: `) });
}

/** The caret's computed facts next to its row + the Highlights summary. */
async function caretFacts(toggle: Locator) {
  return toggle.evaluate((btn) => {
    const caret = btn.querySelector<HTMLElement>(".highlight-slot-row-caret");
    if (!caret) throw new Error("no caret in the slot row");
    const summary = [...document.querySelectorAll<HTMLElement>(".settings-group > summary")].find(
      (s) => s.textContent?.trim() === "Highlights",
    );
    if (!summary) throw new Error("no Highlights summary");
    const cs = getComputedStyle(caret);
    const ss = getComputedStyle(summary);
    const caretBox = caret.getBoundingClientRect();
    const nameBox = btn.querySelector(".highlight-slot-row-name")!.getBoundingClientRect();
    const leading = [...btn.children].every(
      (child) => child === caret || child.getBoundingClientRect().left >= caretBox.right - 0.5,
    );
    return {
      ariaHidden: caret.getAttribute("aria-hidden"),
      listStyleType: cs.listStyleType,
      fontSize: cs.fontSize,
      color: cs.color,
      rowColor: getComputedStyle(btn).color,
      summaryFontSize: ss.fontSize,
      summaryOpenType: ss.listStyleType,
      transitionDuration: cs.transitionDuration,
      animationName: cs.animationName,
      transform: cs.transform,
      // A summary's inside marker paints at its content box's inline start.
      summaryStartDelta: Math.abs(caretBox.left - summary.getBoundingClientRect().left),
      width: caretBox.width,
      left: caretBox.left,
      right: caretBox.right,
      centerDelta: Math.abs(
        caretBox.top + caretBox.height / 2 - (nameBox.top + nameBox.height / 2),
      ),
      leading,
    };
  });
}

/** The engine's native collapsed marker type (a closed <details> summary). */
async function nativeClosedType(page: Page): Promise<string> {
  return page.evaluate(() => {
    const d = document.createElement("details");
    const s = document.createElement("summary");
    s.textContent = "probe";
    d.append(s);
    document.body.append(d);
    const t = getComputedStyle(s).listStyleType;
    d.remove();
    return t;
  });
}

test("collapsed rows point right, the expanded row points down — the native <details> marker, size + colour", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const settings = await openHighlights(page);
  const closedType = await nativeClosedType(page);
  // The open Highlights <details> summary IS the native expanded marker.
  const { summaryOpenType } = await caretFacts(slotToggle(settings, 1));
  expect(summaryOpenType).not.toBe(closedType);

  for (const slot of [1, 2, 3, 4, 5]) {
    const facts = await caretFacts(slotToggle(settings, slot));
    expect(facts.ariaHidden).toBe("true");
    expect(facts.listStyleType, `slot ${slot} collapsed glyph`).toBe(closedType);
    expect(facts.fontSize).toBe(facts.summaryFontSize);
    expect(facts.color).toBe(facts.rowColor);
    expect(facts.width).toBeGreaterThan(0);
    expect(facts.leading, `slot ${slot} caret leads the row`).toBe(true);
    expect(
      facts.summaryStartDelta,
      `slot ${slot} caret aligns with the summary marker`,
    ).toBeLessThanOrEqual(1);
    expect(facts.centerDelta).toBeLessThanOrEqual(3);
    // Swaps glyphs, never rotates.
    expect(facts.transform).toBe("none");
    expect(facts.animationName).toBe("none");
    expect(facts.transitionDuration.split(",").every((d) => parseFloat(d) === 0)).toBe(true);
  }

  const toggle = slotToggle(settings, 2);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const open = await caretFacts(toggle);
  expect(open.listStyleType).toBe(open.summaryOpenType);
  expect(open.transform).toBe("none");
  // The other rows stay closed.
  expect((await caretFacts(slotToggle(settings, 1))).listStyleType).toBe(closedType);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect((await caretFacts(toggle)).listStyleType).toBe(closedType);
});

test("the caret follows the row's ink in built-in, pride, and custom themes", async ({ page }) => {
  const settings = await openHighlights(page);
  await expandSettingsGroup(page, "Appearance");
  for (const { name, value } of [
    { name: "Night", value: "dark" },
    { name: "Bi pride", value: "bi-dark" },
    { name: "Custom light", value: "custom-light" },
  ]) {
    await settings.getByRole("radio", { name, exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", value);
    const facts = await caretFacts(slotToggle(settings, 1));
    expect(facts.color, `${name}: caret colour`).toBe(facts.rowColor);
    expect(facts.color).not.toBe("rgba(0, 0, 0, 0)");
    expect(facts.fontSize).toBe(facts.summaryFontSize);
  }
});

test("at 320px every caret stays inside the panel with no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const settings = await openHighlights(page);
  for (const slot of [1, 2, 3, 4, 5]) {
    const facts = await caretFacts(slotToggle(settings, slot));
    expect(facts.width).toBeGreaterThan(0);
    expect(facts.left).toBeGreaterThanOrEqual(0);
    expect(facts.right).toBeLessThanOrEqual(320);
  }
  const overflow = await settings.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
