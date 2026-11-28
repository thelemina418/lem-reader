// src/persistence/locationStore.ts
// Persistence seam for STATE-01 reading-location records (D-05 grapheme-offset
// substrate + D-06 [articleId+revision] key contract). Mirrors the
// settingsStore seam (sibling, same phase): one Zod-validated record per key,
// discriminated LocationLoadResult union on read, STATE-05 error
// classification via the shared errors.ts classifier.
//
// STATE-04 (validated/versioned records): every record loaded from Dexie
// passes through `LocationRecordSchema.safeParse()` on the READ path (T-02-08
// — Tampering V5). An invalid record is treated as corrupt — it routes to
// STATE-05 recovery and the reader falls through to top-of-article. We never
// silently coerce a corrupt offset into a scroll target.
//
// STATE-05 (recoverable error state): loadLocation never throws — it returns
// a discriminated `LocationLoadResult` so ArticleView's restore effect can
// route the reason silently. Per D-06 + the plan's critical_constraints, a
// mismatched-revision record is NOT an error — it simply falls through to
// "no location found" (the saved offset is invalid against the new revision's
// normalized text). Article reading never depends on Dexie (D2-13).
//
// Mirrors src/persistence/settingsStore.ts seam conventions: header comment
// citing the locked decisions, `import type` for types (verbatimModuleSyntax),
// module-level exported functions as the single-import surface.
import { db } from "./db";
import type { LocationRecordRow } from "./db";
import { LocationRecordSchema } from "../content/schema";
import type { LocationRecord } from "../content/schema";
import type { CanonicalArticle } from "../content/types";
import { classifyStorageError } from "./errors";
import { getCompletion, recordCompletion } from "./completionsStore";
import { articleCompletionFinished } from "../content/completion";
import { endPinOffset, fromLegacyEndPin, inNotesOffset } from "../reader/readingPosition";
import { textStamp } from "../content/sameText";

/**
 * Discriminated result of loading a reading location from Dexie.
 * - `ok: true`     → the load succeeded; `location` is null for first-run /
 *                   mismatched-revision (the saved offset is invalid against
 *                   the article's current revision — silent top-of-article)
 * - `ok: false`    → recovery routing required; `reason` selects the surface
 *                   (issue #98 — ArticleView owns the honesty register):
 *   - `"unavailable"`   → silent top-of-article fall-through (reading
 *                        continues; the StorageBanner covers SettingsContext
 *                        WRITE failures only — never this load path)
 *   - `"corrupt"`       → the honest corrupt-location note at restore
 *                        (safeParse rejected the persisted record; one calm
 *                        sentence at the article top + the same announced),
 *                        then top-of-article
 *   - `"unupgradeable"` → silent top-of-article fall-through (Dexie
 *                        UpgradeError/VersionError; the settings wipe path —
 *                        WipeConfirm — covers corrupt SETTINGS, not this)
 */
export type LocationLoadResult =
  | { ok: true; location: LocationRecord | null }
  | { ok: false; reason: "unavailable" | "corrupt" | "unupgradeable" };

/**
 * Load a reading location from Dexie by [articleId+revision] (D-06). Never
 * throws (STATE-05).
 *
 * The Dexie `location` store uses a COMPOUND primary key declared as
 * `[articleId+revision]` — queried as the array `[articleId, revision]`.
 *
 * Read path validates with `LocationRecordSchema.safeParse()`:
 * - absent record      → first run or no saved location → returns null
 * - valid record       → returns the parsed LocationRecord
 * - invalid record     → returns `{ ok: false, reason: "corrupt" }` (T-02-08)
 * - Dexie throws       → classify via errors.ts → "unavailable" | "unupgradeable"
 *
 * Note: the caller (ArticleView) is responsible for cross-checking the
 * returned record's `revision` against the live article's `revision` before
 * trusting the offset. The Dexie compound key already encodes revision, so a
 * normal load by (articleId, revision) only ever returns the matching record —
 * mismatched revisions simply return null (first-load for that revision).
 */
export async function loadLocation(
  articleId: string,
  revision: number,
): Promise<LocationLoadResult> {
  try {
    // Compound primary key: Dexie expects the array [articleId, revision].
    const raw = await db.location.get([articleId, revision]);
    if (!raw) {
      // First open of this [articleId+revision] pair, or the article's
      // revision changed since the save (no row under the new key). Silent
      // fall-through to top-of-article — NOT an error state (D-06).
      return { ok: true, location: null };
    }
    // The row carries LocationRecord fields. Validate the canonical shape.
    const parsed = LocationRecordSchema.safeParse(raw);
    if (parsed.success) {
      return { ok: true, location: parsed.data };
    }
    // Persisted record failed Zod validation. STATE-04 contract: never
    // silently coerce a corrupt offset. Issue #98: the corrupt reason
    // surfaces HONESTLY — ArticleView renders the calm corrupt-location
    // note at the article top and announces the same sentence, then
    // reading proceeds from the top (silence would read as "no saved
    // position" — a lie about the reader's own data). The bad row itself
    // is overwritten by the next location save.
    return { ok: false, reason: "corrupt" };
  } catch (e) {
    return { ok: false, reason: classifyStorageError(e) };
  }
}

/**
 * Save a reading location to Dexie keyed [articleId+revision] (compound key).
 * `loc` is validated by construction (the only producer is useScrollSave,
 * which builds the record from typed article fields); we do not re-parse on
 * write.
 *
 * Spec #66 — `mainTextEnd` (the article's end-pin, mainTextLength) lets the
 * save honour "reaching or reading the notes never finishes an article": a
 * position inside the notes is not a completion signal (completion.ts), so
 * the save that crosses from the main text into the notes first carries the
 * reader's completion state over as a "reading" completion record — a reader
 * who already finished stays finished there, one who jumped in early stays
 * unfinished. The location and the record commit together. `textEnd` (the
 * article's whole length, graphemeLength) lets that carry-over read a
 * pre-#66 finish at the end of the notes (fromLegacyEndPin) as a finish.
 *
 * Returns silently on success. A throw propagates to the caller (useScrollSave),
 * which catches it and routes via the onStorageError callback so the
 * StorageBanner surfaces location-save failures too (D2-13/STATE-05) —
 * never throws to the reader.
 */
export async function saveLocation(
  loc: LocationRecord,
  options: { mainTextEnd?: number; textEnd?: number } = {},
): Promise<void> {
  // Dexie constructs the compound primary key from articleId + revision
  // automatically — the row does NOT carry a "[articleId+revision]" field.
  const row: LocationRecordRow = {
    schemaVersion: loc.schemaVersion,
    articleId: loc.articleId,
    revision: loc.revision,
    graphemeOffset: loc.graphemeOffset,
    savedAt: loc.savedAt,
    // Spec #68 / #71 — the substrate stamp rides along only when corrected,
    // so an uncorrected article's row stays byte-identical.
    ...(loc.fingerprint !== undefined ? { fingerprint: loc.fingerprint } : {}),
  };
  const mainEnd = options.mainTextEnd;
  if (mainEnd === undefined || !inNotesOffset(loc.graphemeOffset, mainEnd)) {
    await db.location.put(row);
    return;
  }
  await db.transaction("rw", db.location, db.completions, async () => {
    const parsed = LocationRecordSchema.safeParse(
      await db.location.get([loc.articleId, loc.revision]),
    );
    // The legacy end pin (a pre-#66 finish at the end of the notes) carries
    // over as the finish it was.
    const previous = parsed.success
      ? {
          ...parsed.data,
          graphemeOffset: fromLegacyEndPin(
            parsed.data.graphemeOffset,
            mainEnd,
            options.textEnd ?? mainEnd,
          ),
        }
      : undefined;
    if (previous !== undefined && !inNotesOffset(previous.graphemeOffset, mainEnd)) {
      const target = { kind: "article" as const, articleId: loc.articleId };
      const record = await getCompletion(target);
      const finished = articleCompletionFinished(previous, mainEnd, record ?? undefined);
      if (finished !== (record?.finished ?? false)) {
        await recordCompletion(target, finished, "reading", loc.savedAt);
      }
    }
    await db.location.put(row);
  });
}

/** Set the library's explicit reading state using the existing location model.
 * Unread removes every revision: an older location must not revive progress.
 * Failures propagate so the initiating control can offer a retry.
 */
export async function setArticleReadState(article: CanonicalArticle, read: boolean): Promise<void> {
  if (!read) {
    await db.location.filter((location) => location.articleId === article.id).delete();
    return;
  }
  await saveLocation({
    schemaVersion: 1,
    articleId: article.id,
    ...textStamp(article),
    // Spec #66 — the end pin (the main-text end), never the notes end.
    graphemeOffset: Math.max(1, endPinOffset(article)),
    savedAt: new Date().toISOString(),
  });
}

/**
 * `loadAllLocations` — Load EVERY persisted LocationRecord in a single
 * `db.location.toArray()` read (Plan 08-02 — LIB-06). Used by Plan 03's
 * LibraryView to derive the continue-reading strip (D8-09) + the per-row
 * progress hairline.
 *
 * Read discipline mirrors `loadLocation` (STATE-04 — Zod safeParse on
 * every row): corrupt rows are DROPPED silently (collected into `valid`), never
 * coerced. A single malformed row must not block the rest of the strip — the
 * reader sees the valid rows; the corrupt row is simply absent (it will be
 * surfaced by the honest corrupt-location note (issue #98) the next time
 * loadLocation is called for that specific [articleId+revision] and fails
 * the same parse).
 *
 * D8-09 (continue-reading strip): callers sort by `savedAt` to derive
 * recency. D8-10 (recently-read = opened): `savedAt` is updated on every open
 * via `saveLocation`, so the strip ordering reflects reading activity, not
 * just first-open.
 *
 * Never throws — a Dexie-level error propagates to the caller
 * (LibraryView's load effect), which routes through the same STATE-05
 * classification as a single-row read failure.
 */
export async function loadAllLocations(): Promise<LocationRecord[]> {
  const rows = await db.location.toArray();
  const valid: LocationRecord[] = [];
  for (const row of rows) {
    const parsed = LocationRecordSchema.safeParse(row);
    if (parsed.success) {
      valid.push(parsed.data);
    }
    // else: drop the corrupt row silently — STATE-04 says never coerce.
  }
  return valid;
}
