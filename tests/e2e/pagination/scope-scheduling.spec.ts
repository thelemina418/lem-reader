import { expect, test } from "@playwright/test";
import { longProseArticle } from "../../fixtures/longProse";
import { prepareFreshPage, seedRows, BASE } from "../portability/_portability";
import { readPagination, waitForPaginationSettled, waitForTurnAcknowledged } from "./_harness";

// Virtual time distinguishes scheduling policy from a machine-specific speed
// budget: a navigation must not depend on the 400 ms resize/settings timer.
test("a window crossing does not wait for a geometry debounce", async ({ page }) => {
  const article = longProseArticle();
  await page.setViewportSize({ width: 1280, height: 800 });
  await prepareFreshPage(page);
  await seedRows(page, { articles: [article] });
  await page.goto(`${BASE}/#/article/${article.id}`);
  let before = await waitForPaginationSettled(page);
  expect(before.scope).toBeDefined();
  while (before.currentPageIdx < before.pagesLength - 1) {
    await page.keyboard.press("ArrowRight");
    before = await waitForTurnAcknowledged(page, before, "next");
  }
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.keyboard.press("ArrowRight");
  // The crossing's window publication arrives through real-time work (render
  // scheduling the fake clock does not control). Demand it with the clock
  // still PAUSED: zero virtual time, so a crossing gated on any timer, such
  // as the 400 ms debounce, never arrives here.
  await expect
    .poll(async () => (await readPagination(page))?.publicationSeq)
    .toBeGreaterThan(before.publicationSeq!);
  // The turn receipt comes from a frame-deferred overflow check, and that
  // frame is only requested by an effect that also runs on real time, after
  // the publication. So advance virtual time one frame at a time, letting
  // real time pass between frames, and cap the total at 200 ms. A crossing
  // that waits on the 400 ms debounce still cannot complete inside the cap.
  let virtualMs = 0;
  await expect
    .poll(
      async () => {
        if (virtualMs < 200) {
          await page.clock.runFor(16);
          virtualMs += 16;
        }
        return (await readPagination(page))?.turnSeq;
      },
      { intervals: [50] },
    )
    .toBeGreaterThan(before.turnSeq!);
  const after = await readPagination(page);
  expect(after?.turnSeq).toBeGreaterThan(before.turnSeq!);
  expect(after?.anchorOffset).toBeGreaterThan(before.anchorOffset!);
  expect(after?.scope?.startBlock).toBeGreaterThan(before.scope!.startBlock);
  expect(after?.overflowSettled).toBe(true);
});
