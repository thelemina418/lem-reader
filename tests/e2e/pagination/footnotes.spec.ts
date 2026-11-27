// Issue #235 — footnote bodies in the windowed paginated path, end to end.
//
// Cross-engine layout/focus truth (unit tests own the pure arithmetic):
//   1. TRAVERSAL — the footnotes region participates in bounded traversal;
//      the end of the MAIN TEXT finishes a footnoted work, and the note
//      pages are never needed to finish it (issue #58 — notes are not
//      reading; reversed from #235's "the note pages finish the work").
//   2. REFERENCE ↔ NOTE — clicking a marker loads the note's source window
//      and lands keyboard/screen-reader focus on the note; the back-link
//      returns to the referring marker without losing the destination.
//   3. RESTORATION — a saved passage inside a note restores into the
//      footnote window using the existing canonical offset.
//   4. OVERSIZED NOTE — a note body past the window capacity crosses
//      repeated continuations without omissions; its pages anchor their
//      own passage, never the end-pin.
//   5. SPEECH (issue #58) — read-aloud started in the main text stops at
//      the main text's end and never speaks a note; started inside a note,
//      it reads that note (the spoken word renders on it) and stops there.
//   6. SINGLE TREE — exactly one exposed fn-N / fn-ref-N id per document;
//      the hidden measurement projection carries none.
//   7. ELIGIBILITY (issue #65 — reversed from #235's "note rows render no
//      capture binding"): a note accepts a highlight that persists and
//      re-matches; a selection from the main text into a note is refused;
//      Annotations review labels a note highlight with its note and opens
//      it in the notes, whose return leads to the first reference.
import { test, expect, type Page } from "@playwright/test";
import { footnotedWorkArticle } from "../../fixtures/footnotedWork";
import {
  articleGraphemeIndex,
  footnoteRows,
  mainTextLength,
} from "../../../src/content/normalizeText";
import { blockWindowForOffset, sameWindow } from "../../../src/pagination/blockWindow";
import type { BlockWindow } from "../../../src/pagination/blockWindow";
import { LocationRecordSchema } from "../../../src/content/schema";
import type { Block } from "../../../src/content/types";
import { prepareFreshPage, seedRows } from "../portability/_portability";
import {
  readPagination,
  waitForPaginationSettled,
  waitForTurnAcknowledged,
  enablePaginationTrail,
  attachPaginationTrail,
} from "./_harness";
import { BASE } from "../_base";
import { DEFAULT_SETTINGS } from "../../../src/settings/defaults";
import { installFakeSpeech } from "../readaloud/_speech";
import { playAndAwaitProbe, readLocationOffset } from "../readaloud/_harness";

const article = footnotedWorkArticle();
const index = articleGraphemeIndex(article);
const rows = footnoteRows(article);
const NORTH_WING_NOTE = "The north-wing ledger, shelf 12, folio 3.";
const MAIN_END = mainTextLength(article);

type Dev = NonNullable<Awaited<ReturnType<typeof readPagination>>>;
type WindowedDev = Dev & { scope: NonNullable<Dev["scope"]> };

function windowed(dev: Dev): WindowedDev {
  if (!dev.scope) {
    throw new Error("footnotes: publication has no measurement scope — windowed surface expected");
  }
  return dev as WindowedDev;
}

async function scope(page: Page): Promise<WindowedDev> {
  const dev = await readPagination(page);
  if (!dev) throw new Error("footnotes: no DEV pagination publication");
  return windowed(dev);
}

async function open(page: Page, viewport = { width: 360, height: 700 }) {
  await page.setViewportSize(viewport);
  await page.goto(`${BASE}/#/article/${article.id}`);
  await expect(
    page.getByRole("heading", { level: 1, name: article.provenance.title }),
  ).toBeVisible();
  await waitForPaginationSettled(page);
}

const refBlockIndex = article.blocks.findIndex(
  (block) => block.kind === "footnote-reference" && block.footnoteId === "fn-1",
);

/** Seed a saved passage and open AT it. Restoration loads the passage's
 * SOURCE WINDOW asynchronously — the settled publication must be the window
 * containing the seeded offset (the canonical landing fact, not a page
 * number). */
async function openAtOffset(page: Page, offset: number, viewport = { width: 360, height: 700 }) {
  await seedRows(page, {
    locations: [
      LocationRecordSchema.parse({
        schemaVersion: 1,
        articleId: article.id,
        revision: article.revision,
        graphemeOffset: offset,
        savedAt: "2026-01-01T00:00:00Z",
      }),
    ],
  });
  await open(page, viewport);
  const expected: BlockWindow = blockWindowForOffset(article, offset);
  await expect
    .poll(
      async () => {
        const dev = await readPagination(page);
        const s = dev?.scope;
        if (!s) return false;
        return sameWindow(
          {
            startBlock: s.startBlock,
            endBlock: s.endBlock,
            ...(s.startGrapheme !== undefined ? { startGrapheme: s.startGrapheme } : {}),
            ...(s.endGrapheme !== undefined ? { endGrapheme: s.endGrapheme } : {}),
            ...(s.startFootnote !== undefined ? { startFootnote: s.startFootnote } : {}),
            ...(s.endFootnote !== undefined ? { endFootnote: s.endFootnote } : {}),
            ...(s.startFootnoteGrapheme !== undefined
              ? { startFootnoteGrapheme: s.startFootnoteGrapheme }
              : {}),
            ...(s.endFootnoteGrapheme !== undefined
              ? { endFootnoteGrapheme: s.endFootnoteGrapheme }
              : {}),
          },
          expected,
        );
      },
      { timeout: 15_000 },
    )
    .toBe(true);
}

test.beforeEach(async ({ page }) => {
  await prepareFreshPage(page);
  await seedRows(page, { articles: [article] });
});

test("a reference loads its note's window and focus lands on the note", async ({ page }) => {
  // The marker block sits in an early body window; its note lives in the
  // footnotes region — a different source window.
  await openAtOffset(page, index.blockStartOffsets[refBlockIndex]!);
  await expect(page.locator("#fn-ref-1")).toBeVisible();
  const before = await scope(page);
  expect(before.scope.startFootnote).toBeUndefined();
  await page.locator("#fn-ref-1").click();
  // The note's window loads; the note body renders with its scrolling
  // anatomy, and focus lands ON the note (keyboard/screen-reader landing).
  const li = page.locator("#fn-1");
  await expect(li).toBeVisible();
  await expect(li).toBeFocused();
  await expect(li).toContainText(NORTH_WING_NOTE);
  const after = await scope(page);
  expect(after.scope.startFootnote).toBeDefined();
  // The canonical anchor moved into the footnotes region.
  expect(after.anchorOffset).toBeGreaterThanOrEqual(rows[0]!.start);
  // One exposed identifier per document, and none in the hidden tree.
  expect(await page.locator('[id="fn-1"]').count()).toBe(1);
  expect(await page.locator('[id="fn-ref-1"]').count()).toBe(0);
  expect(await page.locator('.article-body-measurement [id^="fn-"]').count()).toBe(0);
});

test("the back-link returns to the referring marker without losing the destination", async ({
  page,
}) => {
  await openAtOffset(page, index.blockStartOffsets[refBlockIndex]!);
  await page.locator("#fn-ref-1").click();
  const li = page.locator("#fn-1");
  await expect(li).toBeVisible();
  await li.locator('a[aria-label="Return to reference 1"]').click();
  // The referring window loads; the marker is visible and focused.
  const ref = page.locator("#fn-ref-1");
  await expect(ref).toBeVisible();
  await expect(ref).toBeFocused();
  const back = await scope(page);
  expect(back.scope.startFootnote).toBeUndefined();
  expect(back.anchorOffset).toBeLessThan(rows[0]!.start);
  // The note's identifier left the document with its page — still exactly
  // one exposed id when present, zero here.
  expect(await page.locator('[id="fn-1"]').count()).toBe(0);
  expect(await page.locator('[id="fn-ref-1"]').count()).toBe(1);
});

test("the end of the main text finishes the work; the note pages are not needed", async ({
  page,
}) => {
  // Restore into the FINAL body window so the end-of-body flow is short.
  // Its membership changes with source sizes, not a fixed row ordinal.
  await openAtOffset(page, index.blockStartOffsets[article.blocks.length - 1]!);
  const restored = await scope(page);
  expect(restored.scope.startFootnote).toBeUndefined();
  // Turn to the last BODY page.
  let dev = await scope(page);
  for (let i = 0; i < 12; i++) {
    if (dev.currentPageIdx === dev.pagesLength - 1) break;
    const before = dev;
    await page.keyboard.press("ArrowRight");
    dev = windowed(await waitForTurnAcknowledged(page, before, "next"));
  }
  expect(dev.currentPageIdx).toBe(dev.pagesLength - 1);
  expect(dev.scope.startFootnote).toBeUndefined();
  // Body end IS the work's end: the committed anchor is the end-pin (the
  // end of the main text), and that is the position the reader saves —
  // finished, with every note still unread.
  expect(dev.anchorOffset).toBe(MAIN_END);
  expect(MAIN_END).toBeLessThan(index.totalGraphemes);
  await expect.poll(() => readLocationOffset(page, article.id), { timeout: 10_000 }).toBe(MAIN_END);
  // Next still crosses into the footnotes region — reference material the
  // reader may visit; its pages anchor their own passage past the pin.
  const beforeCross = await scope(page);
  await page.keyboard.press("ArrowRight");
  const crossed = windowed(await waitForTurnAcknowledged(page, beforeCross, "next"));
  expect(crossed.scope.startFootnote).toBeDefined();
  const notes = page.locator('.page-fragment section[aria-label="Footnotes"]');
  await expect(notes).toBeVisible();
  expect(crossed.anchorOffset).toBeGreaterThan(MAIN_END);
});

test("a saved passage inside a note restores into the footnote window", async ({ page }) => {
  await openAtOffset(page, rows[1]!.start + 5);
  const restored = await scope(page);
  expect(restored.scope.startFootnote).toBeDefined();
  await expect(page.locator("#fn-2")).toBeVisible();
  await expect(page.locator("#fn-2")).toContainText("The second ledger confirms the claim");
  // A cold reload keeps the same canonical landing (restoration loads the
  // note's source window again — poll for the window, not the first publish).
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect
    .poll(async () => (await readPagination(page))?.scope?.startFootnote !== undefined, {
      timeout: 15_000,
    })
    .toBe(true);
  await expect(page.locator("#fn-2")).toBeVisible();
  await expect(page.locator(".pagination-fallback-banner")).toHaveCount(0);
});

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) await attachPaginationTrail(page);
});

test("an oversized note crosses repeated continuations without omissions", async ({ page }) => {
  await enablePaginationTrail(page);
  await openAtOffset(page, rows[2]!.start);
  // The giant note (fn-3) opens at its head slice.
  await expect(page.locator("#fn-3")).toBeVisible();
  await expect(page.locator("#fn-3")).toContainText("Note 000 of the enormous ledger record.");
  const renderedSlices: string[] = [];
  let dev = await scope(page);
  let turns = 0;
  for (let i = 0; i < 60; i++) {
    renderedSlices.push((await page.locator("#fn-3 [data-footnote-content]").textContent()) ?? "");
    if ((await page.getByRole("button", { name: "Mark read and close" }).count()) > 0) break;
    const before = dev;
    await page.keyboard.press("ArrowRight");
    dev = windowed(await waitForTurnAcknowledged(page, before, "next"));
    turns++;
  }
  // Check coverage of the ENTIRE canonical row, not phrases inside single
  // pages: engines may split a sampled phrase at a page boundary. A live
  // geometry correction can overlap an already-read page while preserving
  // its anchor; it may not skip text, fabricate text, or restart the note.
  const row = rows[2]!;
  const canonical = index.clusters.slice(row.start, row.start + row.length).join("");
  let coveredEnd = 0;
  let previousStart = -1;
  for (const slice of renderedSlices) {
    const text = slice.replace(/\s+/gu, " ").trim();
    expect(text.length).toBeGreaterThan(0);
    const start = canonical.indexOf(text);
    expect(start).toBeGreaterThan(previousStart);
    // Trimming page-edge whitespace must not manufacture a text gap.
    const nextUnread = coveredEnd + (canonical[coveredEnd] === " " ? 1 : 0);
    expect(start).toBeLessThanOrEqual(nextUnread);
    coveredEnd = Math.max(coveredEnd, start + text.length);
    previousStart = start;
  }
  expect(coveredEnd).toBe(canonical.length);
  expect(turns).toBeGreaterThan(0);
  // Issue #58 — the last note page is reference material, not the work's
  // end: it anchors its own passage, past the main-text end-pin.
  expect(dev.anchorOffset).toBeGreaterThan(MAIN_END);
  expect(dev.anchorOffset).toBeLessThan(index.totalGraphemes);
  expect(await page.locator('[id="fn-3"]').count()).toBe(1);
});

/** Drain the fake speech queue in the browser: end every live playback
 * utterance until none remains, returning the texts spoken in order. */
async function drainSpeech(page: Page): Promise<string[]> {
  const spoken: string[] = [];
  await expect
    .poll(
      async () => {
        const drained = await page.evaluate(() => {
          const w = window as unknown as {
            __speechSpoken: { text: string; volume: number; done: boolean; cancelled: boolean }[];
            __speechFire: (event: string) => void;
          };
          const out: string[] = [];
          for (let i = 0; i < 40; i++) {
            const live = [...w.__speechSpoken]
              .reverse()
              .find((r) => r.volume === 1 && !r.done && !r.cancelled);
            if (!live) return { out, done: true };
            out.push(live.text);
            w.__speechFire("start");
            w.__speechFire("end");
          }
          return { out, done: false };
        });
        spoken.push(...drained.out);
        return drained.done;
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  return spoken;
}

test("read-aloud started in the main text stops at its end and speaks no note", async ({
  page,
}) => {
  await installFakeSpeech(page, "word");
  await page.reload();
  // Seed near the body's end and wait for the restore to land BEFORE the
  // voice starts.
  await openAtOffset(page, index.blockStartOffsets[78]!);
  await playAndAwaitProbe(page);
  const spoken = await drainSpeech(page);
  expect(spoken.length).toBeGreaterThan(0);
  // The main text closes on its final heading; nothing after it speaks.
  expect(spoken.at(-1)).toBe("Part 79");
  for (const text of spoken) {
    expect(text).not.toContain("ledger, shelf 12");
    expect(text).not.toContain("second ledger confirms");
    expect(text).not.toContain("enormous ledger record");
  }
  // The finish pins the end of the main text — the work is finished.
  await expect(page.getByRole("status").filter({ hasText: "Read aloud finished." })).toHaveCount(1);
  await expect.poll(() => readLocationOffset(page, article.id), { timeout: 10_000 }).toBe(MAIN_END);
});

test("read-aloud started inside a note reads that note and stops", async ({ page }) => {
  await installFakeSpeech(page, "word");
  await page.reload();
  await openAtOffset(page, rows[0]!.start);
  await expect(page.locator("#fn-1")).toBeVisible();
  await playAndAwaitProbe(page);
  // The spoken word renders on the note while it reads.
  await page.evaluate(() =>
    (window as unknown as { __speechFire: (event: string) => void }).__speechFire("start"),
  );
  await expect(page.locator("#fn-1 mark.spoken-word")).toBeVisible();
  const spoken = await drainSpeech(page);
  expect(spoken.join(" ")).toBe(NORTH_WING_NOTE);
  await expect(page.getByRole("status").filter({ hasText: "Read aloud finished." })).toHaveCount(1);
  // The position stays at the note's end — never snapped to the main end.
  await expect
    .poll(() => readLocationOffset(page, article.id), { timeout: 10_000 })
    .toBe(rows[0]!.start + rows[0]!.length);
});

test("short footnoted works expose note navigation; the note page is not the end-pin", async ({
  page,
}) => {
  const short = {
    ...article,
    id: "short-footnoted-work",
    blocks: [article.blocks[refBlockIndex]!],
    footnotes: [article.footnotes[0]!],
  };
  await seedRows(page, { articles: [short] });
  await page.goto(`${BASE}/#/article/${short.id}`);
  await waitForPaginationSettled(page);
  await expect(page.getByRole("button", { name: "Mark read and close" })).toHaveCount(0);
  await page.locator(".page-fragment #fn-ref-1").click();
  await expect(page.locator(".page-fragment #fn-1")).toBeFocused();
  // Issue #58 — the note page anchors its own passage; the end-pin (the end
  // of the main text) is never manufactured by reaching the notes.
  await expect
    .poll(async () => (await readPagination(page))?.anchorOffset)
    .toBe(footnoteRows(short)[0]!.start);
  expect(mainTextLength(short)).toBeLessThan(footnoteRows(short)[0]!.start);
  await page.locator('.page-fragment a[href="#fn-ref-1"]').click();
  await expect(page.locator(".page-fragment #fn-ref-1")).toBeFocused();
  await expect(page.getByRole("button", { name: "Mark read and close" })).toHaveCount(0);
});

for (const kind of ["blockquote", "bulleted-list", "numbered-list"] as const) {
  test(`returns to a nested ${kind} reference beyond the first source window`, async ({ page }) => {
    const lead: Block = {
      kind: "paragraph",
      content: [
        { text: "The earlier passage is not the referring destination. ".repeat(180), marks: [] },
      ],
    };
    const children: Block[] = [
      lead,
      { kind: "blockquote", children: [article.blocks[refBlockIndex]!] },
    ];
    const container: Block =
      kind === "blockquote"
        ? { kind, children }
        : kind === "numbered-list"
          ? { kind, start: 5, items: [{ content: [] }, { content: children }] }
          : { kind, items: [{ content: [] }, { content: children }] };
    const nested = {
      ...article,
      id: `nested-${kind}-footnotes`,
      blocks: [container],
      footnotes: [article.footnotes[0]!],
    };
    const offset = articleGraphemeIndex(nested).clusters.indexOf("[");
    expect(offset).toBeGreaterThan(8000);
    await seedRows(page, {
      articles: [nested],
      locations: [
        LocationRecordSchema.parse({
          schemaVersion: 1,
          articleId: nested.id,
          revision: nested.revision,
          graphemeOffset: offset,
          savedAt: "2026-01-01T00:00:00Z",
        }),
      ],
    });
    await page.goto(`${BASE}/#/article/${nested.id}`);
    await expect(page.locator(".page-fragment #fn-ref-1")).toBeVisible();
    await waitForPaginationSettled(page);
    expect(await page.locator('[id="fn-ref-1"]').count()).toBe(1);
    expect(await page.locator('.article-body-measurement [id^="fn-"]').count()).toBe(0);
    await page.locator(".page-fragment #fn-ref-1").click();
    await expect(page.locator(".page-fragment #fn-1")).toBeFocused();
    await page.locator('.page-fragment a[href="#fn-ref-1"]').click();
    await expect(page.locator(".page-fragment #fn-ref-1")).toBeFocused();
    expect(await page.locator('[id="fn-ref-1"]').count()).toBe(1);
    await expect(page.locator(".pagination-fallback-banner")).toHaveCount(0);
  });
}

/** Select from `startNeedle` (inside `startSel`) to the end of `endNeedle`
 * (inside `endSel`) on the visible surface, as a DOM Range (never
 * Selection.toString — cross-engine parity). */
async function selectText(
  page: Page,
  startSel: string,
  startNeedle: string,
  endSel: string,
  endNeedle: string,
): Promise<void> {
  const ok = await page.evaluate(
    ({ startSel, startNeedle, endSel, endNeedle }) => {
      const point = (sel: string, needle: string, after: boolean): [Text, number] | null => {
        const root = Array.from(document.querySelectorAll(sel)).find(
          (el) => el.closest(".article-body-measurement") === null,
        );
        if (!root) return null;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
          const at = n.data.indexOf(needle);
          if (at >= 0) return [n, after ? at + needle.length : at];
        }
        return null;
      };
      const start = point(startSel, startNeedle, false);
      const end = point(endSel, endNeedle, true);
      if (!start || !end) return false;
      const range = document.createRange();
      range.setStart(...start);
      range.setEnd(...end);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    },
    { startSel, startNeedle, endSel, endNeedle },
  );
  expect(ok, `selection ${startNeedle} … ${endNeedle}`).toBe(true);
}

// Issue #65 — reversed on purpose: #235 asserted that note rows carry no
// capture binding and that highlights cannot attach to footnote bodies.
// Notes are readable, so they are highlightable: the same toolbar, the same
// creation paths, persistence and re-matching.
test("a note accepts a highlight, which persists and re-matches after reload", async ({ page }) => {
  await openAtOffset(page, rows[0]!.start);
  const note = page.locator(".page-fragment #fn-1");
  await expect(note).toBeVisible();
  await selectText(page, ".page-fragment #fn-1", "north-wing", ".page-fragment #fn-1", "ledger");
  const toolbar = page.locator(".selection-toolbar");
  await toolbar.getByRole("button", { name: "Slot 1: Default" }).click();
  await expect(note.locator("mark.highlight")).toHaveText("north-wing ledger");
  await page.reload();
  await waitForPaginationSettled(page);
  await expect(page.locator(".page-fragment #fn-1 mark.highlight")).toHaveText(
    "north-wing ledger",
    { timeout: 15_000 },
  );
});

test("scrolling: main text → note is refused; a note highlight is reviewed as its note", async ({
  page,
}) => {
  const scrollingSettings = { ...DEFAULT_SETTINGS, readingMode: "scrolling" as const };
  const noted = {
    ...article,
    id: "scrolling-note-highlights",
    blocks: article.blocks.slice(0, refBlockIndex + 1),
    footnotes: [article.footnotes[0]!],
  };
  await seedRows(page, {
    articles: [noted],
    settings: [{ key: "reader-prefs", value: scrollingSettings }],
  });
  await page.addInitScript((seed) => {
    try {
      localStorage.setItem("lem-settings-mirror-v1", seed);
    } catch {
      /* best-effort */
    }
  }, JSON.stringify(scrollingSettings));
  await page.goto("about:blank");
  await page.setViewportSize({ width: 360, height: 700 });
  await page.goto(`${BASE}/#/article/${noted.id}`);
  const note = page.locator("article #fn-1");
  await expect(note).toBeAttached();
  const toolbar = page.locator(".selection-toolbar");

  // A selection from the main text into the note creates nothing.
  const lastPassage = `[data-block-index="${refBlockIndex - 1}"]`;
  await selectText(page, lastPassage, "This is the end", "article #fn-1", "north-wing");
  await expect(toolbar).toContainText("This selection includes content that can't be highlighted.");
  await expect(toolbar.getByRole("button", { name: "Slot 1: Default" })).toHaveCount(0);

  // Inside the note alone, the selection highlights.
  await selectText(page, "article #fn-1", "shelf", "article #fn-1", "folio 3");
  await toolbar.getByRole("button", { name: "Slot 1: Default" }).click();
  await expect(note.locator("mark.highlight")).toHaveText("shelf 12, folio 3");

  // Annotations review labels it with its note; opening it lands on the
  // passage, and the note's return leads to its first reference.
  await page.goto(`${BASE}/#/annotations`);
  const jump = page.getByRole("link", { name: "Go to highlight: shelf 12, folio 3" });
  await expect(jump.locator("xpath=ancestor::li[1]")).toContainText("Note 1");
  await jump.click();
  await expect(page.locator("article #fn-1 mark.highlight")).toBeFocused();
  await expect(page.locator("article #fn-1 mark.highlight")).toBeInViewport();
  await page.locator('article #fn-1 a[href="#fn-ref-1"]').click();
  await expect(page.locator("article #fn-ref-1")).toBeFocused();
});

// Issue #58 — scrolling mode: the end of the main text finishes the work as
// soon as the notes come into view; the reader never walks the notes to the
// document bottom.
test("scrolling: the notes coming into view finishes the work at the main text's end", async ({
  page,
}) => {
  const scrollingSettings = { ...DEFAULT_SETTINGS, readingMode: "scrolling" as const };
  const noted = {
    ...article,
    id: "scrolling-footnoted-work",
    blocks: article.blocks.slice(0, 12),
    footnotes: [article.footnotes[2]!],
  };
  await seedRows(page, {
    articles: [noted],
    settings: [{ key: "reader-prefs", value: scrollingSettings }],
  });
  await page.addInitScript((seed) => {
    try {
      localStorage.setItem("lem-settings-mirror-v1", seed);
    } catch {
      /* best-effort */
    }
  }, JSON.stringify(scrollingSettings));
  await page.goto("about:blank");
  await page.setViewportSize({ width: 360, height: 700 });
  await page.goto(`${BASE}/#/article/${noted.id}`);
  const notes = page.locator('article section[aria-label="Footnotes"]');
  await expect(notes).toBeAttached();
  // Bring the notes' top edge to mid-viewport — the giant note runs far
  // below, so the document bottom is nowhere near.
  await page.evaluate(() => {
    const section = document.querySelector<HTMLElement>('article section[aria-label="Footnotes"]')!;
    const top = section.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, top - window.innerHeight / 2);
  });
  const atBottom = await page.evaluate(
    () => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4,
  );
  expect(atBottom).toBe(false);
  await expect
    .poll(() => readLocationOffset(page, noted.id), { timeout: 10_000 })
    .toBe(mainTextLength(noted));
});
