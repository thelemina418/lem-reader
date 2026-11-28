import { SettingsProvider } from "../../../src/settings/SettingsContext";
// tests/unit/review/review-view-footnote-label.test.tsx
// Issue #65 — Annotations review labels a highlight inside a Footnote with
// its note ("Note 2"); main-text highlights carry no such label. The
// snapshot hook is mocked (a fixture snapshot, no Dexie); the row is the
// REAL ReviewView tree (the review-view-remove.test.tsx harness).
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

// ── Fixture: one main-text highlight, one in the second note ────────────────

const MAIN = "The morning register recorded every bell.";
const NOTE = "The evening ledger is kept in the north wing.";

const article: CanonicalArticle = ArticleSchema.parse({
  id: "a1",
  revision: 1,
  lang: "en",
  provenance: {
    title: "An Essay",
    retrievedAt: "2026-01-01T00:00:00.000Z",
    originalHtmlHash: "0".repeat(64),
  },
  blocks: [{ kind: "paragraph", content: [{ text: MAIN }] }],
  footnotes: [
    { id: "fn-1", content: [{ text: "A first note." }] },
    { id: "fn-2", content: [{ text: NOTE }] },
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
    articleId: article.id,
    revision: 1,
    ...uniqueAnchor(article, exact),
    createdAt: "2026-02-01T00:00:00.000Z",
    tags: [],
  });

const snapshot: LibrarySnapshot = {
  articles: [article],
  standaloneArticles: [article],
  chaptersByBook: new Map(),
  books: [],
  locations: [],
  latestLocationByArticleId: new Map(),
  totalsByArticleId: new Map([[article.id, 128]]),
  highlightCountByArticleId: new Map([[article.id, 2]]),
  annotationCountByArticleId: new Map([[article.id, 2]]),
  tags: [],
  annotationTags: [],
  highlights: [highlight("hl-main", MAIN), highlight("hl-note", "north wing")],
  notes: [],
  articleNotes: [],
  readingSessions: [],
  completionByTargetKey: new Map(),
};

const row = (excerpt: string) =>
  screen.getByRole("link", { name: `Go to highlight: ${excerpt}` }).closest("li")!;

describe("ReviewView — note highlights (issue #65)", () => {
  it("labels a note highlight with its note, and only that row", () => {
    vi.mocked(useLibrarySnapshot).mockReturnValue({ status: "ready", snapshot });
    render(
      <SettingsProvider>
        <ReviewView hasAppHistory={false} />
      </SettingsProvider>,
    );
    expect(within(row("north wing")).getByText("Note 2")).toBeTruthy();
    expect(within(row(MAIN)).queryByText(/^Note \d+$/)).toBeNull();
    expect(row("north wing").querySelector('a[href="#/article/a1/h/hl-note"]')).not.toBeNull();
  });
});
