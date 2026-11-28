// tests/unit/persistence/corrections-migration.spec.ts
// Spec #68 / issue #71 — the Dexie v14 → v15 additive upgrade preserves
// every existing row and the new `corrections` store starts empty and is
// immediately usable. NO .upgrade() callback — the v15 block only adds a
// store (the v11–v14 delta-declaration precedent, Pitfall 9).
//
// Own spec FILE (the completions v11→v12 precedent): the legacy instance must
// open the same database name at a LOWER version than the app singleton.
import { beforeEach, describe, expect, it } from "vitest";
import fakeIndexedDB, { IDBKeyRange } from "fake-indexeddb";
import { Dexie } from "dexie";

Dexie.dependencies.indexedDB = fakeIndexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;
(globalThis as { indexedDB?: typeof fakeIndexedDB }).indexedDB = fakeIndexedDB;
(globalThis as { IDBKeyRange?: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

async function wipeDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = fakeIndexedDB.deleteDatabase("lem-reader");
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

describe("Dexie v14 → v15 additive upgrade (spec #68 / #71, Pitfall 9)", () => {
  beforeEach(wipeDatabase);

  it("keeps every legacy row; corrections starts empty and works", async () => {
    const { db } = await import("../../../src/persistence/db");
    db.close();

    // A v14-shaped database: the exact store strings of db.ts history.
    const legacy = new Dexie("lem-reader");
    legacy.version(14).stores({
      articles: "id, revision, source, addedAt, *tags, bookId",
      settings: "key",
      location: "[articleId+revision]",
      highlights: "id, [articleId+revision]",
      notes: "id, highlightId",
      books: "id, title, *tags",
      assets: "[articleId+assetId], articleId",
      readingSessions: "id, articleId, startedAt",
      subscriptions: "id, feedUrl",
      noteDrafts: "highlightId",
      articleNotes: "id, articleId",
      articleNoteDrafts: "id, articleId",
      collections: "id, updatedAt",
      completions: "targetKey",
      collectionActiveEntries: "collectionId",
      pdfRepairs: "articleId",
    });
    await legacy.open();
    await legacy.table("location").put({
      schemaVersion: 1,
      articleId: "legacy-v14-article",
      revision: 1,
      graphemeOffset: 7,
      savedAt: "2026-10-01T00:00:00.000Z",
    });
    await legacy.table("pdfRepairs").put({ articleId: "legacy-v14-article", value: { kept: 1 } });
    await legacy.close();

    const { db: upgraded } = await import("../../../src/persistence/db");
    await upgraded.open();
    expect(upgraded.verno).toBe(15);
    expect((await upgraded.location.get(["legacy-v14-article", 1]))?.graphemeOffset).toBe(7);
    expect((await upgraded.pdfRepairs.get("legacy-v14-article"))?.value).toEqual({ kept: 1 });
    expect(await upgraded.corrections.count()).toBe(0);
    await upgraded.corrections.put({
      schemaVersion: 1,
      articleId: "legacy-v14-article",
      corrections: [],
      updatedAt: "2026-11-27T00:00:00.000Z",
    });
    expect(await upgraded.corrections.count()).toBe(1);
    await upgraded.delete();
  });
});
