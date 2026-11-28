import { SettingsProvider } from "../../../src/settings/SettingsContext";
// tests/unit/review/review-view-hidden-block.test.tsx
// Spec #68, story 74 — Annotations review agrees with the corrected article:
// a highlight inside a block the reader's corrections hide is listed as
// hidden while its block is hidden (never "Article missing" / orphaned) and
// has nowhere to jump to until the block is unhidden. The snapshot hook is
// mocked (a fixture snapshot, no Dexie); the row is the REAL ReviewView tree
// (the review-view-footnote-label.test.tsx harness).
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { LibrarySnapshot } from "../../../src/ingestion/library/librarySnapshot";

vi.mock("../../../src/ingestion/library/useLibrarySnapshot", () => ({
  useLibrarySnapshot: vi.fn(),
}));
vi.mock("../../../src/ingestion/library/librarySnapshot", () => ({
  invalidateLibrarySnapshot: vi.fn(),
}));
vi.mock("../../../src/ingestion/library/tagsStore", () => ({
  loadTagStats: vi.fn().mockResolvedValue([]),
  setArticleTags: vi.fn().mockResolvedValue(undefined),
  setBookTags: vi.fn().mockResolvedValue(undefined),
  setHighlightTags: vi.fn(async (_id: string, tags: string[]) => tags),
}));
vi.mock("../../../src/persistence/notesStore", () => ({
  saveNote: vi.fn(),
  deleteNote: vi.fn(),
}));
vi.mock("../../../src/persistence/highlightsStore", () => ({
  deleteHighlight: vi.fn().mockResolvedValue(undefined),
  setHighlightColor: vi.fn().mockResolvedValue(undefined),
}));

import { ReviewView } from "../../../src/routes/review/ReviewView";
import { useLibrarySnapshot } from "../../../src/ingestion/library/useLibrarySnapshot";
import { ArticleSchema, HighlightRecordSchema } from "../../../src/content/schema";
import type { CanonicalArticle, HighlightRecord } from "../../../src/content/schema";
import {
  deriveQuoteSelector,
  graphemeClusters,
  normalizeText,
} from "../../../src/content/normalizeText";
import type { TextPositionSelector, TextQuoteSelector } from "../../../src/content/normalizeText";
import { findAllOccurrences } from "../../../src/annotations/resolution";
import { applyCorrections, blockCorrection } from "../../../src/content/corrections/engine";

// jsdom <dialog> polyfill (mirrors review-view-tags-announcement.test.tsx).
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal =
    HTMLDialogElement.prototype.showModal ??
    function showDialogPolyfill(this: HTMLDialogElement) {
      this.open = true;
    };
  HTMLDialogElement.prototype.close =
    HTMLDialogElement.prototype.close ??
    function closeDialogPolyfill(this: HTMLDialogElement) {
      if (!this.open) return;
      this.open = false;
      this.dispatchEvent(new Event("close"));
    };
}

// ── Fixture: two paragraphs, the second hidden, one highlight in each ─────

const KEPT = "The morning register recorded every bell.";
const HIDDEN = "Share this article with a friend today.";

const original: CanonicalArticle = ArticleSchema.parse({
  id: "a1",
  revision: 1,
  lang: "en",
  provenance: {
    title: "An Essay",
    retrievedAt: "2026-01-01T00:00:00.000Z",
    originalHtmlHash: "0".repeat(64),
  },
  blocks: [
    { kind: "paragraph", content: [{ text: KEPT }] },
    { kind: "paragraph", content: [{ text: HIDDEN }] },
  ],
});

function uniqueAnchor(a: CanonicalArticle, exact: string) {
  const clusters = graphemeClusters(normalizeText(a), a.lang);
  const exactClusters = graphemeClusters(exact, a.lang);
  const positions = findAllOccurrences(clusters, exactClusters);
  if (positions.length !== 1) throw new Error(`fixture drift: "${exact}" not unique`);
  const start = positions[0]!;
  const position: TextPositionSelector = { start, end: start + exactClusters.length };
  const quote: TextQuoteSelector = deriveQuoteSelector(a, position);
  return { position, quote };
}

const highlight = (id: string, exact: string): HighlightRecord =>
  HighlightRecordSchema.parse({
    schemaVersion: 1,
    id,
    articleId: original.id,
    revision: 1,
    ...uniqueAnchor(original, exact),
    createdAt: "2026-02-01T00:00:00.000Z",
    tags: [],
  });

const before = applyCorrections(original, []);
const hide = blockCorrection(
  "hide",
  before,
  before.view.allBlocks.find((b) => b.path.join(".") === "1")!,
  { id: "c-hide", createdAt: "2026-11-27T10:00:00.000Z" },
)!;
const asRead = applyCorrections(original, [hide]).article;

const snapshot: LibrarySnapshot = {
  articles: [original],
  standaloneArticles: [original],
  readingArticleById: new Map([[original.id, asRead]]),
  chaptersByBook: new Map(),
  books: [],
  locations: [],
  latestLocationByArticleId: new Map(),
  totalsByArticleId: new Map([[original.id, 128]]),
  highlightCountByArticleId: new Map([[original.id, 2]]),
  annotationCountByArticleId: new Map([[original.id, 2]]),
  tags: [],
  annotationTags: [],
  highlights: [highlight("hl-kept", KEPT), highlight("hl-hidden", "with a friend")],
  notes: [],
  articleNotes: [],
  readingSessions: [],
  completionByTargetKey: new Map(),
};

const rowOf = (excerpt: string) =>
  screen.getByText(excerpt, { selector: "blockquote" }).closest("li")!;

describe("ReviewView — highlights in hidden blocks (spec #68)", () => {
  it("lists a highlight in a hidden block as hidden, not orphaned, with no jump", () => {
    vi.mocked(useLibrarySnapshot).mockReturnValue({ status: "ready", snapshot });
    render(
      <SettingsProvider>
        <ReviewView hasAppHistory={false} />
      </SettingsProvider>,
    );
    const hiddenRow = rowOf("with a friend");
    expect(within(hiddenRow).getByText("Hidden while its block is hidden")).toBeTruthy();
    expect(within(hiddenRow).queryByText("Article missing")).toBeNull();
    expect(hiddenRow.querySelector('a[href="#/article/a1/h/hl-hidden"]')).toBeNull();
    const jump = within(hiddenRow).getByRole("button", { name: /^Go to highlight: with a friend/ });
    expect(jump.getAttribute("aria-label")).toMatch(/hidden by your corrections/);
    expect(within(rowOf(KEPT)).queryByText("Hidden while its block is hidden")).toBeNull();
  });
});
