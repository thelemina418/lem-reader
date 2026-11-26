// tests/component/add-dialog-collection.test.tsx
// Issue #15 — the ordinary import dialog opened FROM a collection page
// ("Import into collection"). The dialog's job in this mode is routing
// only: submit through importIntoCollection (the service's own suite owns
// the save/entry policy), keep refusals in place, and hand a landed outcome
// to the collection page (which owns focus + the status announcement).
// jsdom is not authoritative for <dialog> behaviour — showModal/close are
// stubbed exactly as in AddDialog.test.tsx.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../src/routes/collections/importIntoCollection", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/routes/collections/importIntoCollection")>();
  return { ...actual, importIntoCollection: vi.fn() };
});
vi.mock("../../src/ingestion/addToLibrary", () => ({ addToLibrary: vi.fn() }));
vi.mock("../../src/settings/SettingsContext", () => ({
  useSettings: () => ({ settings: { openAfterAdd: true }, update: vi.fn() }),
}));

import { AddDialog } from "../../src/ingestion/AddDialog";
import { addToLibrary } from "../../src/ingestion/addToLibrary";
import { importIntoCollection } from "../../src/routes/collections/importIntoCollection";
import { CollectionSchema } from "../../src/content/schema";

const importMock = vi.mocked(importIntoCollection);
const addToLibraryMock = vi.mocked(addToLibrary);

const collection = CollectionSchema.parse({
  schemaVersion: 1,
  id: "queue",
  name: "Reading queue",
  entries: [
    {
      id: "entry-1",
      target: { kind: "article", articleId: "essay" },
      addedAt: "2026-11-25T00:00:00.000Z",
    },
  ],
  createdAt: "2026-11-25T00:00:00.000Z",
  updatedAt: "2026-11-25T00:00:00.000Z",
});

const events: string[] = [];

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  });
  importMock.mockReset();
  addToLibraryMock.mockReset();
  events.length = 0;
});

function renderInCollectionMode() {
  const onImported = vi.fn((o: { outcome: string }) => events.push(`imported:${o.outcome}`));
  const utils = render(
    <AddDialog
      open
      onCancel={() => events.push("cancel")}
      onSaved={() => events.push("saved")}
      onQuietSave={(notice) => events.push(`quiet:${notice}`)}
      tagStats={[]}
      destination={{ collectionId: "queue", collectionName: "Reading queue", onImported }}
    />,
  );
  return { onImported, ...utils };
}

async function submitUrl() {
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "Add by URL" }), "https://example.com/essay");
  await user.click(screen.getByRole("button", { name: /^add$/i }));
}

describe("AddDialog — import into a collection (issue #15)", () => {
  it("names the collection and drops the Open after adding choice (the reader stays on the collection)", () => {
    renderInCollectionMode();
    expect(screen.getByRole("dialog", { name: "Import into Reading queue" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Open after adding" })).toBeNull();
    // The ordinary import flow: the same three sources.
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("submits through importIntoCollection, never the plain library add", async () => {
    importMock.mockReturnValue(new Promise(() => {}));
    renderInCollectionMode();
    await submitUrl();
    await waitFor(() =>
      expect(importMock).toHaveBeenCalledWith(
        "queue",
        { kind: "url", url: "https://example.com/essay" },
        [],
      ),
    );
    expect(addToLibraryMock).not.toHaveBeenCalled();
  });

  it("a landed import invalidates the library, closes, then hands the outcome to the page — no navigation", async () => {
    importMock.mockResolvedValue({
      outcome: "added",
      saved: true,
      collection,
      entryId: "entry-1",
      notes: [],
    });
    const { onImported } = renderInCollectionMode();
    await submitUrl();
    await waitFor(() => expect(events).toEqual(["saved", "cancel", "imported:added"]));
    expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ entryId: "entry-1" }));
  });

  it("an existing reading referenced by the collection does not re-broadcast a library save", async () => {
    importMock.mockResolvedValue({
      outcome: "added",
      saved: false,
      collection,
      entryId: "entry-1",
      notes: [],
    });
    renderInCollectionMode();
    await submitUrl();
    await waitFor(() => expect(events).toEqual(["cancel", "imported:added"]));
  });

  it("a kept save whose entry failed still closes and reports to the page", async () => {
    importMock.mockResolvedValue({ outcome: "not-added", saved: true });
    renderInCollectionMode();
    await submitUrl();
    await waitFor(() => expect(events).toEqual(["saved", "cancel", "imported:not-added"]));
  });

  it("already in this collection: says so in the dialog, adds nothing, stays open", async () => {
    importMock.mockResolvedValue({ outcome: "already-in-collection", saved: false });
    renderInCollectionMode();
    await submitUrl();
    await screen.findByText("That reading is already in Reading queue. Nothing was added.");
    expect(events).toEqual([]);
  });

  it("a library refusal keeps the calm refusal copy in the dialog and adds nothing", async () => {
    importMock.mockResolvedValue({ outcome: "refused", reason: "server-error" });
    renderInCollectionMode();
    await submitUrl();
    await screen.findByText("Something went wrong. Try again.");
    expect(events).toEqual([]);
  });
});
