// tests/e2e/corrections/correction-view.spec.ts
// Spec #68 / issue #70 — the Correction view shell (seam 3: the Correction
// view in the browser). The reader enters the view from either reading mode
// and leaves it to the SAME mode at the SAME passage; scrolling inside the
// view moves the passage the reader returns to, but saves no position until
// they leave. Read-aloud pauses on entry and stays paused. Highlights are
// inert tints, selection opens no toolbar, links don't navigate. Keyboard:
// C enters/leaves, arrows move block by block.
import { test, expect, type Page } from "@playwright/test";
import {
  highlightControls,
  modeToggle,
  openArticle,
  selectRangeInBlock,
  switchMode,
  turnToPage,
  wipeDatabase,
  PIXEL_SVG,
} from "../annotations/_fixtures";
import { BASE } from "../_base";
import { installFakeSpeech } from "../readaloud/_speech";
import { playAndAwaitProbe, readLocationOffset } from "../readaloud/_harness";

const FIXTURE = "essay-long-form";

test.beforeEach(async ({ page }) => {
  await page.route(/\.(png|jpe?g|gif|webp|svg)(\?|$)/, (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: PIXEL_SVG }),
  );
  await wipeDatabase(page);
});

function correctionView(page: Page) {
  return page.locator(".correction-view");
}

function correctionToggle(page: Page) {
  return page.getByRole("button", { name: "Correction view" });
}

/** The data-block-index of the first block whose box is below the header
 * on the given surface (the reader's "passage in view"). */
async function topVisibleBlock(page: Page, surfaceSelector: string): Promise<number> {
  return page.evaluate((sel) => {
    const header = document.querySelector(".app-header")?.getBoundingClientRect().bottom ?? 0;
    const blocks = Array.from(
      document.querySelectorAll<HTMLElement>(`${sel} [data-block-index]`),
    ).filter((el) => !el.closest(".article-body-measurement"));
    for (const el of blocks) {
      const r = el.getBoundingClientRect();
      if (r.bottom > header + 1 && r.height > 0) return Number(el.dataset.blockIndex);
    }
    return -1;
  }, surfaceSelector);
}

async function firstBlockOnPage(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".page-fragment [data-block-index]");
    return el ? Number(el.dataset.blockIndex) : -1;
  });
}

async function pageHoldsBlock(page: Page, index: number): Promise<boolean> {
  return page.evaluate(
    (i) => document.querySelector(`.page-fragment [data-block-index="${i}"]`) !== null,
    index,
  );
}

async function enterView(page: Page, via: "key" | "button" = "key") {
  if (via === "key") await page.keyboard.press("c");
  else await correctionToggle(page).click();
  await expect(correctionView(page)).toBeVisible();
  await expect(correctionToggle(page)).toHaveAttribute("aria-pressed", "true");
}

async function leaveView(page: Page, via: "key" | "button" = "key") {
  if (via === "key") await page.keyboard.press("c");
  else await correctionToggle(page).click();
  await expect(correctionView(page)).toBeHidden();
  await expect(correctionToggle(page)).toHaveAttribute("aria-pressed", "false");
}

/** Scroll the view so block `index` sits at the top under the header. */
async function scrollViewToBlock(page: Page, index: number) {
  await page.evaluate((i) => {
    const el = document.querySelector<HTMLElement>(`.correction-view [data-block-index="${i}"]`);
    if (!el) throw new Error(`no block ${i} in the view`);
    const header = document.querySelector(".app-header")?.getBoundingClientRect().bottom ?? 0;
    window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - header - 4);
  }, index);
}

test.describe("Correction view (#70)", () => {
  test("enter from paged reading and leave to the same page", async ({ page }) => {
    await openArticle(page, FIXTURE);
    await expect(modeToggle(page)).toHaveAttribute("aria-label", "Reading mode: paginated");
    // A middle page (the final page's anchor is the end pin).
    await turnToPage(page, 1);
    await expect.poll(() => firstBlockOnPage(page)).toBeGreaterThan(0);
    const passage = await firstBlockOnPage(page);

    await enterView(page);
    await expect(page.getByRole("status").filter({ hasText: /^Correction view\./ })).toHaveCount(1);
    // The view is a scrolling column clearly labelled as distinct from reading.
    await expect(
      correctionView(page).getByRole("heading", { name: "Correction view" }),
    ).toBeVisible();
    await expect(page.locator(".page-fragment")).toHaveCount(0);
    await expect.poll(() => topVisibleBlock(page, ".correction-view")).toBe(passage);

    await leaveView(page);
    await expect(
      page.getByRole("status").filter({ hasText: "Back to paged reading." }),
    ).toHaveCount(1);
    await expect(modeToggle(page)).toHaveAttribute("aria-label", "Reading mode: paginated");
    await expect.poll(() => pageHoldsBlock(page, passage)).toBe(true);
  });

  test("enter from scrolling reading and leave to the same passage", async ({ page }) => {
    await openArticle(page, FIXTURE);
    await switchMode(page);
    await page.evaluate(() => {
      const blocks = document.querySelectorAll<HTMLElement>(".article-body [data-block-index]");
      blocks[Math.floor(blocks.length / 2)]!.scrollIntoView({ block: "start" });
    });
    await expect.poll(() => topVisibleBlock(page, ".article-body")).toBeGreaterThan(0);
    const passage = await topVisibleBlock(page, ".article-body");

    await enterView(page, "button");
    await expect.poll(() => topVisibleBlock(page, ".correction-view")).toBe(passage);

    await leaveView(page, "button");
    await expect(
      page.getByRole("status").filter({ hasText: "Back to scrolling reading." }),
    ).toHaveCount(1);
    await expect(modeToggle(page)).toHaveAttribute("aria-label", "Reading mode: scrolling");
    await expect.poll(() => topVisibleBlock(page, ".article-body")).toBe(passage);
  });

  test("scrolling in the view saves nothing; leaving lands on the passage now in view", async ({
    page,
  }) => {
    await openArticle(page, FIXTURE);
    await turnToPage(page, 1);
    // Let the page turn's debounced position save land first.
    await expect.poll(() => readLocationOffset(page, FIXTURE)).not.toBeNull();
    await page.waitForTimeout(1500);
    const savedBefore = await readLocationOffset(page, FIXTURE);

    await enterView(page);
    // Scroll back toward the start: a passage other than the entry one.
    const entered = await topVisibleBlock(page, ".correction-view");
    const target = 1;
    expect(entered).toBeGreaterThan(target);
    await scrollViewToBlock(page, target);
    await expect.poll(() => topVisibleBlock(page, ".correction-view")).toBe(target);
    // Beyond the save debounce: still the pre-entry position.
    await page.waitForTimeout(1600);
    expect(await readLocationOffset(page, FIXTURE)).toBe(savedBefore);

    await leaveView(page);
    await expect.poll(() => pageHoldsBlock(page, target)).toBe(true);
    // Leaving makes the passage the reading position.
    await expect.poll(() => readLocationOffset(page, FIXTURE)).not.toBe(savedBefore);
    // The persisted reading-mode preference never changed.
    await expect(modeToggle(page)).toHaveAttribute("aria-label", "Reading mode: paginated");
  });

  test("blocks show their boundary and type; keyboard enters, moves block by block, leaves", async ({
    page,
  }) => {
    await openArticle(page, FIXTURE);
    await enterView(page);
    const blocks = correctionView(page).locator(".correction-block");
    await expect(blocks.first()).toBeVisible();
    // Every block carries a visible type label in words.
    const labels = await correctionView(page).locator(".correction-block-label").allTextContents();
    expect(labels.length).toBe(await blocks.count());
    for (const l of labels) {
      expect(l).toMatch(
        /^(Paragraph|Heading [1-6]|Quotation|Code|Figure( with caption)?|Bulleted list|Numbered list|Footnote reference|Unsupported content)$/,
      );
    }
    expect(labels).toContain("Paragraph");

    // Entry puts focus on the landing block, announced as a group named by its type.
    const focused = page.locator(".correction-block:focus");
    await expect(focused).toHaveCount(1);
    const first = await focused.getAttribute("data-correction-block");
    await expect(focused).toHaveAttribute("role", "group");
    await expect(focused).toHaveAttribute(
      "aria-label",
      /^(Paragraph|Heading [1-6]|Quotation|Code|Figure.*|.*list|Footnote reference|Unsupported content)$/,
    );
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".correction-block:focus")).not.toHaveAttribute(
      "data-correction-block",
      first ?? "",
    );
    const second = await page
      .locator(".correction-block:focus")
      .getAttribute("data-correction-block");
    expect(Number(second)).toBe(Number(first) + 1);
    await page.keyboard.press("ArrowUp");
    await expect(page.locator(".correction-block:focus")).toHaveAttribute(
      "data-correction-block",
      first ?? "",
    );
    // The mode toggle and M stay inert inside the view (it is not a mode).
    await page.keyboard.press("m");
    await expect(correctionView(page)).toBeVisible();
    // Move focus well ahead; the focused block becomes the reading position.
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
    const chosen = Number(
      await page.locator(".correction-block:focus").getAttribute("data-correction-block"),
    );
    expect(chosen).toBe(Number(first) + 4);
    await leaveView(page);
    // Focus is never stranded on <body>: it returns to the header toggle.
    await expect(correctionToggle(page)).toBeFocused();
    await expect.poll(() => pageHoldsBlock(page, chosen)).toBe(true);
  });

  test("highlights are inert tints; selection opens no toolbar; links don't navigate", async ({
    page,
  }) => {
    await openArticle(page, "list-reference");
    await switchMode(page);
    // Make a highlight in reading first.
    const idx = await page.evaluate(() => {
      const els = Array.from(
        document.querySelectorAll<HTMLElement>(".article-body p[data-block-index]"),
      );
      return Number(els.find((e) => (e.textContent ?? "").length > 40)!.dataset.blockIndex);
    });
    expect(await selectRangeInBlock(page, idx, 0, 12)).toBe(true);
    await expect(page.locator(".selection-toolbar")).toBeVisible();
    await page.keyboard.press("h");
    await expect(page.locator("mark.highlight").first()).toBeVisible();
    await page.evaluate(() => window.getSelection()?.removeAllRanges());

    await enterView(page);
    const mark = correctionView(page).locator("mark.highlight").first();
    await expect(mark).toBeVisible();
    await expect(mark).not.toHaveAttribute("tabindex", /.*/);
    await mark.click();
    await expect(highlightControls(page)).toHaveCount(0);

    expect(await selectRangeInBlock(page, idx, 14, 30)).toBe(true);
    await page.waitForTimeout(300);
    await expect(page.locator(".selection-toolbar")).toHaveCount(0);

    // No link in the view navigates or is a tab stop.
    await expect(correctionView(page).locator("a[href]")).toHaveCount(0);
    const inertLink = correctionView(page).locator(".inert-link").first();
    await inertLink.scrollIntoViewIfNeeded();
    const before = page.url();
    await inertLink.click();
    expect(page.url()).toBe(before);
  });

  test("footnote references don't navigate in the view", async ({ page }) => {
    await openArticle(page, "figure-heavy");
    await enterView(page);
    await expect(correctionView(page).locator("a[href]")).toHaveCount(0);
    const ref = correctionView(page).locator("sup .inert-link").first();
    await expect(ref).toBeVisible();
    const before = page.url();
    await ref.click();
    expect(page.url()).toBe(before);
  });

  test("read-aloud pauses on entry and stays paused after leaving", async ({ page }) => {
    await installFakeSpeech(page, "word");
    await page.goto(`${BASE}/`);
    await openArticle(page, FIXTURE);
    await playAndAwaitProbe(page);
    const bar = page.locator(".readaloud-bar");
    await expect(bar.getByRole("button", { name: "Pause" })).toBeVisible();
    await enterView(page);
    await expect(bar.getByRole("button", { name: "Play" })).toBeVisible();
    await leaveView(page);
    await page.waitForTimeout(500);
    await expect(bar.getByRole("button", { name: "Play" })).toBeVisible();
  });

  test("no horizontal scroll at 320px; boundaries and labels survive forced colors", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.emulateMedia({ forcedColors: "active" });
    await openArticle(page, FIXTURE);
    await enterView(page, "button");
    const geom = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      header: document.querySelector(".app-header")!.getBoundingClientRect().height,
    }));
    expect(geom.scrollW).toBeLessThanOrEqual(geom.clientW + 1);
    expect(geom.header).toBe(48);
    const block = correctionView(page).locator(".correction-block").first();
    const style = await block.evaluate((el) => {
      const s = getComputedStyle(el);
      return { width: s.borderTopWidth, style: s.borderTopStyle };
    });
    expect(style.style).not.toBe("none");
    expect(parseFloat(style.width)).toBeGreaterThan(0);
    await expect(block.locator(".correction-block-label")).toBeVisible();
  });
});
