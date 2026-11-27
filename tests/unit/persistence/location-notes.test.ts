// Spec #66 (review S1) — "Reaching or reading the notes never finishes an
// article", and a reader who already finished stays finished while reading
// the notes. A position saved inside the notes is not a completion signal
// (src/content/completion.ts), so the save that crosses from the main text
// into the notes carries the reader's completion state over as a
// "reading" completion record.
import { beforeEach, describe, expect, it } from "vitest";
import fakeIndexedDB, { IDBKeyRange } from "fake-indexeddb";
import { Dexie } from "dexie";
import type { LocationRecord } from "../../../src/content/schema";

Dexie.dependencies.indexedDB = fakeIndexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;
Object.assign(globalThis, { indexedDB: fakeIndexedDB, IDBKeyRange });

const { db } = await import("../../../src/persistence/db");
const { saveLocation } = await import("../../../src/persistence/locationStore");
const { getCompletion, recordCompletion } = await import(
  "../../../src/persistence/completionsStore"
);
const { articleReadingState } = await import("../../../src/ingestion/library/readingState");

const MAIN_END = 100;
const target = { kind: "article" as const, articleId: "noted-article" };

function at(graphemeOffset: number, savedAt: string): LocationRecord {
  return { schemaVersion: 1, articleId: target.articleId, revision: 1, graphemeOffset, savedAt };
}

async function stateNow() {
  const location = (await db.location.get([target.articleId, 1])) as LocationRecord | undefined;
  return articleReadingState(location, MAIN_END, (await getCompletion(target)) ?? undefined);
}

beforeEach(async () => {
  await db.location.clear();
  await db.completions.clear();
});

describe("saving a position inside the notes", () => {
  it("a reader who finished the main text stays finished reading the notes", async () => {
    await saveLocation(at(MAIN_END, "2026-01-02T00:00:00.000Z"), { mainTextEnd: MAIN_END });
    expect(await stateNow()).toBe("finished");
    await saveLocation(at(140, "2026-01-03T00:00:00.000Z"), { mainTextEnd: MAIN_END });
    expect(await stateNow()).toBe("finished");
    // Further reading in the notes keeps it.
    await saveLocation(at(160, "2026-01-04T00:00:00.000Z"), { mainTextEnd: MAIN_END });
    expect(await stateNow()).toBe("finished");
  });

  it("a reader who jumps to the notes early is not finished", async () => {
    await saveLocation(at(10, "2026-01-02T00:00:00.000Z"), { mainTextEnd: MAIN_END });
    await saveLocation(at(140, "2026-01-03T00:00:00.000Z"), { mainTextEnd: MAIN_END });
    expect(await stateNow()).toBe("in-progress");
    expect(await getCompletion(target)).toBeNull();
  });

  it("an older finished correction the reader has since read past does not revive in the notes", async () => {
    await recordCompletion(target, true, "reader");
    await db.completions.update(`article:${target.articleId}`, {
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    // Reading again from the start is newer intent than the correction.
    await saveLocation(at(10, "2026-01-02T00:00:00.000Z"), { mainTextEnd: MAIN_END });
    expect(await stateNow()).toBe("in-progress");
    await saveLocation(at(140, "2026-01-03T00:00:00.000Z"), { mainTextEnd: MAIN_END });
    expect(await stateNow()).toBe("in-progress");
  });

  it("returning to the main text is a completion signal again", async () => {
    await saveLocation(at(MAIN_END, "2026-01-02T00:00:00.000Z"), { mainTextEnd: MAIN_END });
    await saveLocation(at(140, "2026-01-03T00:00:00.000Z"), { mainTextEnd: MAIN_END });
    await saveLocation(at(10, "2026-01-04T00:00:00.000Z"), { mainTextEnd: MAIN_END });
    expect(await stateNow()).toBe("in-progress");
  });
});
