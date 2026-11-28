// tests/unit/portability/corrections-roundtrip.spec.ts
// Spec #68 / issue #77 — corrections travel through export/import with
// their original (ADR 0014: a layer over the preserved original).
//
//   - the writer emits the current writer version with an ALWAYS-present
//     `corrections` block (empty on a correction-free library)
//   - export → wipe → import into an empty library: the corrected article
//     is identical, and the reading position keeps its substrate stamp
//   - an older bundle (no corrections block) imports exactly as before and
//     never touches local corrections
//   - corrections follow their article (no new conflict kind): imported
//     corrections are re-applied to the WINNING original through the
//     engine; ones that don't fit are kept as not applied, never stripped
//   - a newer bundle forward-refuses
//
// Real seams only: the stores, buildBundle → validateBundle →
// detectImportPreview → resolveImportPlan → applyImport.
import { beforeEach, describe, expect, it } from "vitest";
import { strFromU8, unzipSync, zipSync } from "fflate";
import fakeIndexedDB, { IDBKeyRange } from "fake-indexeddb";
import { Dexie } from "dexie";
import {
  ArticleSchema,
  CORRECTIONS_SCHEMA_VERSION,
  type CanonicalArticle,
  type Correction,
} from "../../../src/content/schema";
import { normalizeText } from "../../../src/content/normalizeText";
import {
  applyCorrections,
  blockCorrection,
  correctedArticle,
} from "../../../src/content/corrections/engine";
import { textStamp } from "../../../src/content/sameText";
import type { Overrides } from "../../../src/portability/conflicts";
import { computeManifest } from "../../../src/portability/manifest";
import { BUNDLE_WRITER_VERSION } from "../../../src/portability/bundle";

Dexie.dependencies.indexedDB = fakeIndexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;
Object.assign(globalThis, { indexedDB: fakeIndexedDB, IDBKeyRange });

async function wipeDatabase(): Promise<void> {
  const { db } = await import("../../../src/persistence/db");
  await db.delete();
  await db.open();
}

const para = (text: string) => ({ kind: "paragraph" as const, content: [{ text, marks: [] }] });

const article = (overrides: Partial<CanonicalArticle> = {}): CanonicalArticle =>
  ArticleSchema.parse({
    id: "harbour-essay",
    revision: 2,
    lang: "en",
    provenance: {
      sourceUrl: "https://example.com/harbour",
      title: "The harbour",
      retrievedAt: "2026-01-01T00:00:00.000Z",
      originalHtmlHash: "sha256:" + "a".repeat(64),
    },
    blocks: [
      para("The ferry leaves at dawn, before the fog lifts."),
      para("Share this article"),
      para("Gulls follow it out past the breakwater and back."),
      para("Sign up for our newsletter"),
    ],
    footnotes: [],
    ...overrides,
  });

function hideOf(original: CanonicalArticle, path: number[], prior: Correction[] = []): Correction {
  const result = applyCorrections(original, prior);
  const block = result.view.allBlocks.find((b) => b.path.join(".") === path.join("."))!;
  return blockCorrection("hide", result, block, {
    id: `hide-${path.join(".")}`,
    createdAt: "2026-11-27T10:00:00.000Z",
  })!;
}

const ALL_SKIP: Overrides = {
  book: "skip",
  "article-revision": "skip",
  "article-content-divergence": "skip",
  "article-metadata-override": "skip",
  "highlight-id": "skip",
  "note-id": "skip",
  "article-note-id": "skip",
  location: "skip",
};

const preferences = {
  schemaVersion: 2 as const,
  font: "serif" as const,
  size: 18 as const,
  measure: 58 as const,
  spacing: "comfortable" as const,
  theme: "sepia" as const,
  readingMode: "paginated" as const,
};

async function saveCorrections(articleId: string, corrections: Correction[]) {
  const { db } = await import("../../../src/persistence/db");
  await db.corrections.put({
    schemaVersion: CORRECTIONS_SCHEMA_VERSION,
    articleId,
    corrections,
    updatedAt: "2026-11-27T10:00:00.000Z",
  });
}

async function exportedEntries() {
  const { buildBundle } = await import("../../../src/portability/ExportImportService");
  return unzipSync((await buildBundle()).bytes);
}

async function importFile(file: File, overrides: Overrides = ALL_SKIP) {
  const { validateBundle, applyImport } =
    await import("../../../src/portability/ExportImportService");
  const { detectImportPreview, resolveImportPlan } =
    await import("../../../src/portability/conflicts");
  const validated = await validateBundle(file);
  if (!validated.ok) throw new Error(`bundle refused: ${JSON.stringify(validated.refusal)}`);
  const preview = await detectImportPreview(validated.bundle, []);
  const plan = await resolveImportPlan(validated.bundle, preview, overrides, false);
  await applyImport(plan);
  return plan;
}

/** The dry-run preview of a bundle file (nothing written). */
async function previewFile(file: File) {
  const { validateBundle } = await import("../../../src/portability/ExportImportService");
  const { detectImportPreview } = await import("../../../src/portability/conflicts");
  const validated = await validateBundle(file);
  if (!validated.ok) throw new Error(`bundle refused: ${JSON.stringify(validated.refusal)}`);
  return detectImportPreview(validated.bundle, []);
}

/** A hand-built bundle at `schemaVersion` (the corrections block only when given). */
async function bundleFile(
  schemaVersion: number,
  articles: CanonicalArticle[],
  corrections?: unknown[],
): Promise<File> {
  const { ExportBundleSchema } = await import("../../../src/portability/bundle");
  const bundle = ExportBundleSchema.parse({
    schemaVersion,
    exportedAt: "2026-11-27T12:00:00.000Z",
    appVersion: "test",
    articles: JSON.parse(JSON.stringify(articles)),
    locations: [],
    highlights: [],
    notes: [],
    preferences,
    fixtureIds: [],
    books: [],
    assets: [],
    readingSessions: [],
    subscriptions: [],
    articleNotes: [],
    collections: [],
    completions: [],
    collectionActiveEntries: [],
    starterRemoved: true,
    ...(corrections !== undefined ? { corrections } : {}),
  });
  const manifest = await computeManifest(bundle);
  return new File(
    [
      zipSync({
        "bundle.json": new TextEncoder().encode(JSON.stringify(bundle)),
        "manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
      }),
    ],
    "x.zip",
  );
}

async function storedCorrections(articleId: string) {
  const { loadCorrections } = await import("../../../src/persistence/correctionsStore");
  return loadCorrections(articleId);
}

async function storedArticle(id: string) {
  const { db } = await import("../../../src/persistence/db");
  return ArticleSchema.parse(await db.articles.get(id));
}

describe("exporting corrections", () => {
  beforeEach(wipeDatabase);

  it("writes the current writer version with an always-present corrections block", async () => {
    const { db } = await import("../../../src/persistence/db");
    await db.articles.put(article());
    const bundle = JSON.parse(strFromU8((await exportedEntries())["bundle.json"]!)) as {
      schemaVersion: number;
      corrections?: unknown[];
    };
    expect(bundle.schemaVersion).toBe(12);
    expect(BUNDLE_WRITER_VERSION).toBe(12);
    expect(bundle.corrections).toEqual([]);
  });
});

describe("round trip", () => {
  beforeEach(wipeDatabase);

  it("brings back the original and its corrections into an empty library, and the corrected article is identical", async () => {
    const { db } = await import("../../../src/persistence/db");
    const original = article();
    const first = [hideOf(original, [1])];
    const corrections = [...first, hideOf(original, [3], first)];
    await db.articles.put(original);
    await saveCorrections(original.id, corrections);
    const corrected = correctedArticle(original, corrections);
    const stamp = textStamp(corrected);
    await db.location.put({
      schemaVersion: 1,
      articleId: original.id,
      revision: stamp.revision,
      graphemeOffset: 20,
      savedAt: "2026-11-27T11:00:00.000Z",
      ...(stamp.fingerprint !== undefined ? { fingerprint: stamp.fingerprint } : {}),
    });

    const entries = await exportedEntries();
    await wipeDatabase();
    const plan = await importFile(new File([zipSync(entries)], "x.zip"));

    expect(plan.correctionsNotApplied).toBe(0);
    const restored = await storedArticle(original.id);
    expect(restored).toEqual(original); // the original is preserved, never rewritten
    expect(await storedCorrections(original.id)).toEqual(corrections);
    const again = correctedArticle(restored, await storedCorrections(original.id));
    expect(normalizeText(again)).toBe(normalizeText(corrected));
    expect(again.blocks).toEqual(corrected.blocks);
    expect(normalizeText(again)).not.toContain("Share this article");
    // The saved position still names the corrected substrate it was saved on.
    const [location] = await db.location.toArray();
    expect(location).toMatchObject({ graphemeOffset: 20, fingerprint: stamp.fingerprint });
  });
});

describe("older bundles", () => {
  beforeEach(wipeDatabase);

  it("an older bundle without a corrections block imports exactly as before", async () => {
    const plan = await importFile(await bundleFile(11, [article()]));
    expect(plan.correctionsToWrite).toEqual([]);
    expect(plan.correctionsNotApplied).toBe(0);
    expect(await storedArticle("harbour-essay")).toEqual(article());
    expect(await storedCorrections("harbour-essay")).toEqual([]);
  });

  it("an older bundle never touches local corrections, even when its article wins", async () => {
    const { db } = await import("../../../src/persistence/db");
    const local = article();
    const mine = [hideOf(local, [1])];
    await db.articles.put(local);
    await saveCorrections(local.id, mine);
    const newer = article({ revision: 3 });
    await importFile(await bundleFile(11, [newer]), {
      ...ALL_SKIP,
      "article-revision": "overwrite",
    });
    expect((await storedArticle(local.id)).revision).toBe(3);
    expect(await storedCorrections(local.id)).toEqual(mine);
  });

  it("refuses a bundle newer than the writer version", async () => {
    const { validateBundle } = await import("../../../src/portability/ExportImportService");
    const raw = { schemaVersion: 13, exportedAt: "2026-11-27T12:00:00.000Z" };
    const file = new File(
      [
        zipSync({
          "bundle.json": new TextEncoder().encode(JSON.stringify(raw)),
          "manifest.json": new TextEncoder().encode("{}"),
        }),
      ],
      "x.zip",
    );
    const result = await validateBundle(file);
    expect(result).toEqual({
      ok: false,
      refusal: { kind: "newer-schema-version", bundleVersion: 13 },
    });
  });
});

describe("corrections follow their article", () => {
  beforeEach(wipeDatabase);

  const incomingRecord = (corrections: Correction[]) => ({
    schemaVersion: CORRECTIONS_SCHEMA_VERSION,
    articleId: "harbour-essay",
    corrections,
    updatedAt: "2026-11-27T10:00:00.000Z",
  });

  it("re-applies imported corrections to the winning original, keeping ones that don't fit as not applied", async () => {
    const { db } = await import("../../../src/persistence/db");
    // The local article wins (keep-local), and its text no longer has the
    // newsletter line the second imported correction hides.
    const local = article({
      revision: 3,
      blocks: [
        para("The ferry leaves at dawn, before the fog lifts."),
        para("Share this article"),
        para("Gulls follow it out past the breakwater and back."),
      ],
    });
    await db.articles.put(local);
    const incoming = article();
    const first = [hideOf(incoming, [1])];
    const corrections = [...first, hideOf(incoming, [3], first)];

    const file = await bundleFile(BUNDLE_WRITER_VERSION, [incoming], [incomingRecord(corrections)]);
    // The preview already says how many won't fit (keep-local default).
    expect((await previewFile(file)).corrections).toEqual({
      incoming: 2,
      notApplied: 1,
      setAside: 0,
    });
    const plan = await importFile(file);

    expect(plan.correctionsNotApplied).toBe(1);
    expect(plan.correctionsSetAside).toBe(0);
    expect(await storedArticle(local.id)).toEqual(local);
    // Never stripped: both are kept, in order.
    const kept = await storedCorrections(local.id);
    expect(kept).toEqual(corrections);
    const result = applyCorrections(local, kept);
    expect(result.outcomes.map((o) => o.status)).toEqual(["applied", "not-applied"]);
    expect(normalizeText(result.article)).not.toContain("Share this article");
  });

  it("the corrections of an incoming winning article replace the local ones with it", async () => {
    const { db } = await import("../../../src/persistence/db");
    const local = article();
    await db.articles.put(local);
    await saveCorrections(local.id, [hideOf(local, [3])]);
    const incoming = article({ revision: 3 });
    const theirs = [hideOf(incoming, [1])];

    const plan = await importFile(
      await bundleFile(BUNDLE_WRITER_VERSION, [incoming], [incomingRecord(theirs)]),
      { ...ALL_SKIP, "article-revision": "overwrite" },
    );

    expect(plan.correctionsNotApplied).toBe(0);
    expect((await storedArticle(local.id)).revision).toBe(3);
    expect(await storedCorrections(local.id)).toEqual(theirs);
  });

  it("a local article that wins keeps its own corrections", async () => {
    const { db } = await import("../../../src/persistence/db");
    const local = article();
    await db.articles.put(local);
    const mine = [hideOf(local, [3])];
    await saveCorrections(local.id, mine);

    const file = await bundleFile(
      BUNDLE_WRITER_VERSION,
      [article()],
      [incomingRecord([hideOf(local, [1])])],
    );
    // Set aside, and said so: before (preview) and after (the plan's count).
    expect((await previewFile(file)).corrections).toEqual({
      incoming: 1,
      notApplied: 0,
      setAside: 1,
    });
    const plan = await importFile(file);

    expect(plan.correctionsToWrite).toEqual([]);
    expect(plan.correctionsSetAside).toBe(1);
    expect(await storedCorrections(local.id)).toEqual(mine);
  });

  it("corrections whose article is nowhere after the import are not written", async () => {
    const plan = await importFile(
      await bundleFile(BUNDLE_WRITER_VERSION, [], [incomingRecord([hideOf(article(), [1])])]),
    );
    expect(plan.correctionsToWrite).toEqual([]);
    expect(await storedCorrections("harbour-essay")).toEqual([]);
  });
});

describe("applying corrections is atomic with the rest of the import", () => {
  beforeEach(wipeDatabase);

  // starterRemoved absent → the transaction WITHOUT settings; present → WITH.
  for (const starterRemoved of [undefined, true]) {
    const branch = starterRemoved === undefined ? "without" : "with";

    it(`writes corrections inside the import transaction (${branch} settings)`, async () => {
      const { ExportBundleSchema } = await import("../../../src/portability/bundle");
      const { applyImport } = await import("../../../src/portability/ExportImportService");
      const { detectImportPreview, resolveImportPlan } =
        await import("../../../src/portability/conflicts");
      const incoming = article();
      const corrections = [hideOf(incoming, [1])];
      const bundle = ExportBundleSchema.parse({
        schemaVersion: starterRemoved === undefined ? 6 : BUNDLE_WRITER_VERSION,
        exportedAt: "2026-11-27T12:00:00.000Z",
        appVersion: "test",
        articles: [incoming],
        locations: [],
        highlights: [],
        notes: [],
        preferences,
        fixtureIds: [],
        ...(starterRemoved !== undefined ? { starterRemoved } : {}),
        corrections: [
          {
            schemaVersion: CORRECTIONS_SCHEMA_VERSION,
            articleId: incoming.id,
            corrections,
            updatedAt: "2026-11-27T10:00:00.000Z",
          },
        ],
      });
      const plan = await resolveImportPlan(
        bundle,
        await detectImportPreview(bundle),
        ALL_SKIP,
        false,
      );
      await applyImport(plan);
      expect(await storedCorrections(incoming.id)).toEqual(corrections);
    });
  }

  it("a failure while writing corrections rolls back the whole import", async () => {
    const { db } = await import("../../../src/persistence/db");
    const { applyImport } = await import("../../../src/portability/ExportImportService");
    const { detectImportPreview, resolveImportPlan } =
      await import("../../../src/portability/conflicts");
    const { validateBundle } = await import("../../../src/portability/ExportImportService");
    const incoming = article();
    const validated = await validateBundle(
      await bundleFile(
        BUNDLE_WRITER_VERSION,
        [incoming],
        [
          {
            schemaVersion: CORRECTIONS_SCHEMA_VERSION,
            articleId: incoming.id,
            corrections: [hideOf(incoming, [1])],
            updatedAt: "2026-11-27T10:00:00.000Z",
          },
        ],
      ),
    );
    if (!validated.ok) throw new Error("bundle refused");
    const plan = await resolveImportPlan(
      validated.bundle,
      await detectImportPreview(validated.bundle, []),
      ALL_SKIP,
      false,
    );
    const boom = () => {
      throw new Error("injected failure");
    };
    db.corrections.hook("creating", boom);
    try {
      await expect(applyImport(plan)).rejects.toThrow("injected failure");
    } finally {
      db.corrections.hook("creating").unsubscribe(boom);
    }
    expect(await db.articles.count()).toBe(0);
    expect(await db.corrections.count()).toBe(0);
  });
});
