// tests/unit/collections/import-into-collection.test.ts
// Issue #15 — importIntoCollection(): the ordinary library import, then ONE
// whole-reading entry appended to the collection. The outcome union is the
// whole test surface; the two collaborators it composes (the addToLibrary
// policy service and the collection membership seam) are module boundaries
// with their own suites, so they are replaced here.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CollectionSchema, type Collection } from "../../../src/content/schema";

vi.mock("../../../src/ingestion/addToLibrary", () => ({ addToLibrary: vi.fn() }));
vi.mock("../../../src/persistence/collectionsStore", () => ({ addCollectionEntry: vi.fn() }));

import { addToLibrary } from "../../../src/ingestion/addToLibrary";
import { addCollectionEntry } from "../../../src/persistence/collectionsStore";
import {
  collectionImportAnnouncement,
  importIntoCollection,
} from "../../../src/routes/collections/importIntoCollection";

const addToLibraryMock = vi.mocked(addToLibrary);
const addEntryMock = vi.mocked(addCollectionEntry);

function collectionWith(...targets: Collection["entries"][number]["target"][]): Collection {
  return CollectionSchema.parse({
    schemaVersion: 1,
    id: "queue",
    name: "Reading queue",
    entries: targets.map((target, i) => ({
      id: `entry-${i + 1}`,
      target,
      addedAt: "2026-11-25T00:00:00.000Z",
    })),
    createdAt: "2026-11-25T00:00:00.000Z",
    updatedAt: "2026-11-25T00:00:00.000Z",
  });
}

const urlInput = { kind: "url", url: "https://example.com/essay" } as const;

beforeEach(() => {
  addToLibraryMock.mockReset();
  addEntryMock.mockReset();
});

describe("importIntoCollection", () => {
  it("saves a new article and appends it as a whole-reading entry", async () => {
    addToLibraryMock.mockResolvedValue({
      outcome: "saved-article",
      articleId: "essay",
      title: "Essay",
      warnings: [],
    });
    const updated = collectionWith({ kind: "article", articleId: "essay" });
    addEntryMock.mockResolvedValue({ outcome: "added", collection: updated });

    const outcome = await importIntoCollection("queue", urlInput, ["tag"]);

    expect(addToLibraryMock).toHaveBeenCalledWith(urlInput, ["tag"]);
    expect(addEntryMock).toHaveBeenCalledWith("queue", { kind: "article", articleId: "essay" });
    expect(outcome).toEqual({
      outcome: "added",
      saved: true,
      collection: updated,
      entryId: "entry-1",
      notes: [],
    });
  });

  it("carries an admitted-with-limits article's limit notes", async () => {
    addToLibraryMock.mockResolvedValue({
      outcome: "saved-article",
      articleId: "essay",
      title: "Essay",
      note: "Some of this page couldn't be read.",
      warnings: ["A table was left out."],
      degraded: "Highlights may drift.",
    });
    addEntryMock.mockResolvedValue({
      outcome: "added",
      collection: collectionWith({ kind: "article", articleId: "essay" }),
    });

    const outcome = await importIntoCollection("queue", urlInput);

    expect(outcome).toMatchObject({
      outcome: "added",
      notes: [
        "Some of this page couldn't be read.",
        "A table was left out.",
        "Highlights may drift.",
      ],
    });
  });

  it("adds a saved EPUB as ONE whole-book entry and notes skipped chapters", async () => {
    addToLibraryMock.mockResolvedValue({
      outcome: "saved-book",
      bookId: "book-1",
      title: "A Book",
      skippedChapterCount: 2,
      firstChapterArticleId: "book-1-c01",
    });
    addEntryMock.mockResolvedValue({
      outcome: "added",
      collection: collectionWith({ kind: "book", bookId: "book-1" }),
    });

    const outcome = await importIntoCollection("queue", {
      kind: "file",
      file: new File(["PK"], "a.epub"),
    });

    expect(addEntryMock).toHaveBeenCalledWith("queue", { kind: "book", bookId: "book-1" });
    expect(outcome).toMatchObject({ outcome: "added", saved: true });
    expect(outcome.outcome === "added" && outcome.notes).toEqual(["2 chapters could not be read."]);
  });

  it("references an article already in the library instead of duplicating it", async () => {
    addToLibraryMock.mockResolvedValue({
      outcome: "refused",
      reason: "already-in-library",
      existingArticleId: "essay",
    });
    addEntryMock.mockResolvedValue({
      outcome: "added",
      collection: collectionWith({ kind: "article", articleId: "essay" }),
    });

    const outcome = await importIntoCollection("queue", urlInput);

    expect(addEntryMock).toHaveBeenCalledWith("queue", { kind: "article", articleId: "essay" });
    expect(outcome).toMatchObject({ outcome: "added", saved: false, entryId: "entry-1" });
  });

  it("references a book already in the library by its existing id", async () => {
    addToLibraryMock.mockResolvedValue({
      outcome: "refused",
      reason: "already-in-library",
      existingBookId: "book-1",
    });
    addEntryMock.mockResolvedValue({
      outcome: "added",
      collection: collectionWith({ kind: "book", bookId: "book-1" }),
    });

    await importIntoCollection("queue", { kind: "file", file: new File(["PK"], "a.epub") });

    expect(addEntryMock).toHaveBeenCalledWith("queue", { kind: "book", bookId: "book-1" });
  });

  it("says the collection already has the target and adds nothing", async () => {
    addToLibraryMock.mockResolvedValue({
      outcome: "refused",
      reason: "already-in-library",
      existingArticleId: "essay",
    });
    addEntryMock.mockResolvedValue({ outcome: "duplicate" });

    expect(await importIntoCollection("queue", urlInput)).toEqual({
      outcome: "already-in-collection",
      saved: false,
    });
  });

  it("passes a library refusal through and never touches the collection", async () => {
    addToLibraryMock.mockResolvedValue({ outcome: "refused", reason: "fetch-failed" });

    expect(await importIntoCollection("queue", urlInput)).toEqual({
      outcome: "refused",
      reason: "fetch-failed",
    });
    expect(addEntryMock).not.toHaveBeenCalled();
  });

  it("keeps an already-in-library refusal with no known id as a plain refusal", async () => {
    addToLibraryMock.mockResolvedValue({ outcome: "refused", reason: "already-in-library" });

    expect(await importIntoCollection("queue", urlInput)).toEqual({
      outcome: "refused",
      reason: "already-in-library",
    });
    expect(addEntryMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a refused entry", () => addEntryMock.mockResolvedValue({ outcome: "collection-missing" })],
    ["a storage failure", () => addEntryMock.mockRejectedValue(new Error("quota"))],
  ])("reports a kept save, never a rollback, after %s", async (_label, arrange) => {
    addToLibraryMock.mockResolvedValue({
      outcome: "saved-article",
      articleId: "essay",
      title: "Essay",
      warnings: [],
    });
    arrange();

    expect(await importIntoCollection("queue", urlInput)).toEqual({
      outcome: "not-added",
      saved: true,
    });
  });
});

describe("collectionImportAnnouncement", () => {
  it.each([
    [
      { outcome: "added", saved: true, notes: [] },
      ["Saved to your library and added to Reading queue."],
    ],
    [
      { outcome: "added", saved: true, notes: ["A table was left out."] },
      ["Saved to your library and added to Reading queue.", "A table was left out."],
    ],
    [
      { outcome: "added", saved: false, notes: [] },
      ["Already in your library — added to Reading queue."],
    ],
    [
      { outcome: "not-added", saved: true },
      ["Saved to your library, but it couldn't be added to Reading queue."],
    ],
    [
      { outcome: "not-added", saved: false },
      ["Already in your library, but it couldn't be added to Reading queue."],
    ],
    [
      { outcome: "already-in-collection", saved: false },
      ["That reading is already in Reading queue. Nothing was added."],
    ],
  ] as const)("%o → %o", (outcome, expected) => {
    expect(collectionImportAnnouncement(outcome, "Reading queue")).toEqual(expected);
  });
});
