// server/epubToBooks.ts
// Plan 12-02 Task 1 — the EPUB → {bookMeta, chapters} adapter. This is the
// fifth intake format of the Phase 7 ingestion pipeline (sibling of
// `server/pdfToBlocks.ts`, `server/htmlToBlocks.ts`, and
// `server/markdownToBlocks.ts`) and the ONLY new server-side parsing surface
// of Phase 12: everything downstream (the orchestrator's fifth Stage-1 branch
// in 12-04, client save, library grouping) composes its output contract.
//
// Decision lineage: D12-09 (TOC-driven chapters; spine items mapping to the
// same top-level TOC entry merge into one article), D12-10 (non-content
// spine items are skipped, not failures), D12-13 (fflate reads the zip —
// in-tree since Phase 9), D12-14 (fast-xml-parser for XML manifests;
// chapters ride the EXISTING sanitize + walk path — never an article-
// extraction pass, chapters are already content; Pitfall 6 renderer
// rejection is why this adapter exists at all), D12-16 RETIRED by 20-06
// (the text-first "every figure downgrades to an unsupported block" pass is
// gone — chapter figures now extract from the ALREADY-OPEN container with
// zero network and either admit as local asset:img refs or refuse calmly
// per-figure with disclosure, per D20-01/D20-03).
//
// ──────────────────────────────────────────────────────────────────────────
// SECURITY BOUNDARY (the doc model IS the boundary — D8-16 precedent):
//   - Chapter XHTML normalizes through the SHARED sanitizeExtractedHtml +
//     htmlToBlocks path (the 07-04 mXSS-suite-covered surface). No forking.
//   - DRM honesty (T-12-07): detection only, never decryption. The gate is
//     allowlist-based — the one legitimate OCF font-obfuscation use passes
//     (we extract no fonts, so obfuscated fonts are simply ignored); every
//     other encryption algorithm, plus rights.xml/license.lcpl presence,
//     refuses `epub-protected`. Marker byte content NEVER enters error
//     messages or logs.
//   - Zip discipline (T-12-01/T-12-02): unzipSync filters over-cap entries
//     BEFORE inflation (Phase 9 bomb discipline — a book carrying an
//     over-cap entry refuses `epub-unreadable`); isSafeEntryName (the
//     tested Phase 9 gate, imported — never re-derived) runs on EVERY entry
//     key before any entry byte is used.
//   - XML hardening (T-12-04/T-12-06/T-12-08): processEntities:false +
//     maxNestedTags + the parser's dangerous-property guard (throws on
//     __proto__-shaped names) + a DTD refusal + the whole-parse try
//     envelope → calm `epub-unreadable`; EPUB_MAX_CHAPTERS and the
//     EPUB_EXTRACTION_TIMEOUT_MS race bound the work.
//   - IP-leak closure (T-12-05, evolved by 20-06/D20-01): the reader never
//     fetches EPUB-embedded resources. The D12-16 blanket downgrade retired —
//     chapter figures now resolve against the ALREADY-OPEN entries map only
//     (zero network by construction; the unit suite proves it with fetch
//     stubbed to throw), and remote-src figures refuse calmly per-figure.
//     Every ADMITTED figure is a local asset:img ref (the 20-04 renderer
//     emits <img> only on the resolved object-URL branch — a remote URL has
//     no code path to an <img src>).
//
// ⚠️ Future maintainer: do NOT add an article-extraction pass to chapter
// documents; do NOT parse XML with regex; do NOT reorder the DRM gate after
// chapter work; do NOT let a new XML document type skip the shared parse
// helpers below.
//
// Server-only (Pitfall 8-6 / 12): fflate and fast-xml-parser stay behind
// /server imports — only the Block/InlineRun types (plus the zipSlip guard
// helper) cross from src, so the client bundle does not grow.
import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { unzipSync } from "fflate";
import { JSDOM } from "jsdom";
import { footnoteBodyFromParagraphs } from "../src/content/footnoteBody";
import { isSafeEntryName } from "../src/portability/zipSlip";
import { rewriteFiguresWithAssets } from "./assetStage";
import { IngestionError } from "./errors";
import { sniffImageAsset } from "./fetchImageAsset";
import { collectCrossFileTargets, copyReferencedNotes, mayHoldNotes, numberChapterNotes, settleCopiedNotes, } from "./epubFootnotes";
import { detectLinkedFootnotes } from "./footnoteLinks";
import { footnoteBodiesParagraphs, htmlToBlocks, sanitizeExtractedHtml, } from "./htmlToBlocks";
import { EPUB_EXTRACTION_TIMEOUT_MS, EPUB_MAX_CHAPTERS, EPUB_MAX_ENTRY_BYTES, MAX_ARTICLE_ASSET_BYTES, MAX_FIGURES_PER_ARTICLE, } from "./limits";
// ── EPUB_THRESHOLDS — every detection/assembly number lives HERE ────────────
// The calibration harness (D12-12) pins against this object exactly as the
// 11-06 PDF_THRESHOLDS discipline: recorded verdicts reference these values
// and re-tuning happens in one place.
export const EPUB_THRESHOLDS = {
    /** D12-10 admission floor: a readerable chapter document walks to at least
     * this many blocks (the 11-07 relaxed algebra, document unit). Cover
     * plates and pure-image pages fail it; front matter with real paragraphs
     * passes. */
    minChapterBlocks: 3,
    /** D12-09 fallback floor: fewer than this many distinct TOC entries
     * resolving to spine positions ⇒ one-chapter-per-readerable-spine-item. */
    tocMergeMinEntries: 2,
    /** XML nesting cap (below the fast-xml-parser 100 default — OPF/NCX/nav
     * are shallow; hostile nesting is T-12-08). */
    maxNestedXmlTags: 40,
};
// ── Small shared constants ───────────────────────────────────────────────────
const UTF8 = new TextDecoder();
/** Calm DOC-06 copy for every DRM refusal — deliberately free of any marker
 * byte content (T-12-07: detection-only, and the refusal must never echo the
 * hostile document back into logs). */
const DRM_REFUSAL_MESSAGE = "This book is protected by DRM and cannot be added.";
/** The ONE legitimate non-DRM use of META-INF/encryption.xml (OCF §4.4.5):
 * IDPF font obfuscation. We extract no fonts, so entries under this
 * algorithm are ignored. Every other algorithm — and any unknown vendor URI
 * — refuses. This is the ONLY pass condition in the DRM gate. */
const FONT_OBFUSCATION_ALGORITHM = "http://www.idpf.org/2008/embedding";
// ── XML parsing (ONE hardened factory — D12-14, T-12-04/T-12-06/T-12-08) ────
/** Repeatable elements forced to arrays — a single <creator> otherwise
 * parses as a bare string/object and repeatable spine/nav structures would
 * need per-callshape handling. */
const ARRAY_ELEMENTS = new Set([
    "item",
    "itemref",
    "creator",
    "navPoint",
    "rootfile",
    "EncryptedData",
    "nav",
    "ol",
    "li",
    "navLabel",
]);
/**
 * createEpubXmlParser — the ONE hardened parser configuration shared by the
 * container.xml, OPF, nav, NCX, and encryption.xml parses. Exported so unit
 * tests pin the removeNSPrefix key convention directly (assumption A7: with
 * removeNSPrefix:true, dc:title arrives as key "title" and the nav epub:type
 * attribute as "@_type").
 */
export function createEpubXmlParser() {
    return new XMLParser({
        // Attributes carry full-path/href/idref/media-type/algorithm — required.
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        // Match on local names: dc:title → title, opf:role → role.
        removeNSPrefix: true,
        // Entity-expansion DoS guard (the library docs' own recommendation for
        // untrusted XML) — entities stay literal; see also the DTD refusal below.
        processEntities: false,
        maxNestedTags: EPUB_THRESHOLDS.maxNestedXmlTags,
        isArray: (name) => ARRAY_ELEMENTS.has(name),
    });
}
const epubXmlParser = createEpubXmlParser();
/** Entity-declaring DTD detection — the strong form of the entity-expansion
 * guard, CALIBRATED against real books (12-08 Rule 1 finding): EPUB 3 nav
 * documents legitimately open with the spec's own `<!DOCTYPE html>` template
 * (EPUB 3.3 §7.1), and real-world XHTML/NCX documents commonly carry
 * external-only PUBLIC/SYSTEM declarations the parser never fetches. The
 * 12-08 corpus proved the original blanket DOCTYPE refusal false-refused
 * those navs (resolveNavToc failed → the one-per-spine-doc fallback fired
 * on a fully navigable O'Reilly book — the Pitfall 1 warning sign). The
 * threat (T-12-04) is the ENTITY declaration itself — the billion-laughs
 * internal subset (exactly the entityBombOpf fixture shape) — so a DOCTYPE
 * is refused precisely when its internal subset declares <!ENTITY; bare
 * and external-only DOCTYPEs declare nothing to expand and stay inert
 * under processEntities:false. */
function declaresEntities(text) {
    const m = /<!DOCTYPE[^>]*\[([\s\S]*?)\]>/i.exec(text);
    return m !== null && /<!ENTITY/i.test(m[1]);
}
/** Parse with the hardened config; ANY failure throws calm `epub-unreadable`
 * (malformed XML, hostile property names — the parser's dangerous-property
 * guard throws on __proto__-shaped names — and entity-declaring DTDs all
 * land here). */
function parseEpubXml(text) {
    if (declaresEntities(text)) {
        throw new IngestionError("epub-unreadable", "This EPUB contains a document-type declaration that the reader does not accept.");
    }
    try {
        return epubXmlParser.parse(text);
    }
    catch {
        throw new IngestionError("epub-unreadable", "This EPUB contains XML that could not be read — it may be corrupt.");
    }
}
/** The DRM gate's conservative reader: undefined on ANY parse failure (an
 * encryption manifest that cannot be parsed can never be cleared as
 * DRM-free). */
function tryParseEpubXml(text) {
    if (declaresEntities(text))
        return undefined;
    try {
        return epubXmlParser.parse(text);
    }
    catch {
        return undefined;
    }
}
function asObj(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v) ? v : undefined;
}
/** Repeatable-or-single → array (belt-and-suspenders for hosts whose config
 * drifts from ARRAY_ELEMENTS). */
function xmlArr(v) {
    if (v === undefined || v === null)
        return [];
    return Array.isArray(v) ? v : [v];
}
/** Text content of an element value: bare string, or the "#text" member of
 * an element carrying attributes. */
function xmlText(v) {
    if (typeof v === "string")
        return v;
    const t = asObj(v)?.["#text"];
    return typeof t === "string" ? t : "";
}
/** An attribute value by local name ("@_"-prefixed key), non-empty. */
function xmlAttr(v, name) {
    const a = asObj(v)?.[`@_${name}`];
    return typeof a === "string" && a.length > 0 ? a : undefined;
}
/** Directory portion of a zip-root-relative path ("" for root files). */
function dirOf(path) {
    const slash = path.lastIndexOf("/");
    return slash >= 0 ? path.slice(0, slash) : "";
}
// ── normalizeEpubHref — the ONE shared href normalizer (Pitfall 1) ───────────
/**
 * normalizeEpubHref — map a raw TOC/manifest href onto a zip-root-relative
 * path: decode %XX (an undecodable sequence stays LITERAL — tolerant, a
 * non-matching href is simply ignored downstream, never a refusal), resolve
 * `../` and `./` against `baseDir` (the nav/NCX/OPF document's directory),
 * strip the #fragment, and posix-join. Comparison against entry names stays
 * case-sensitive (spec paths ARE case-sensitive). BOTH the TOC side and the
 * manifest side normalize through THIS function — the whole Pitfall 1
 * mitigation is that they cannot disagree.
 */
export function normalizeEpubHref(rawHref, baseDir) {
    const hashAt = rawHref.indexOf("#");
    const path = hashAt >= 0 ? rawHref.slice(0, hashAt) : rawHref;
    let decoded = path;
    try {
        decoded = decodeURIComponent(path);
    }
    catch {
        // Undecodable %XX stays literal (see doc comment).
    }
    const stack = baseDir.length > 0 ? baseDir.split("/") : [];
    for (const seg of decoded.split("/")) {
        if (seg === "" || seg === ".")
            continue;
        if (seg === "..") {
            // Clamp at the zip root — these are lookup keys, not writes; the
            // archive itself was slip-gated before any entry byte is used.
            stack.pop();
            continue;
        }
        stack.push(seg);
    }
    return stack.join("/");
}
// ── Timeout race (the withPdfDocument pattern, EPUB edition) ────────────────
/**
 * withEpubTimeout — race `op` against EPUB_EXTRACTION_TIMEOUT_MS; the timer
 * is ALWAYS cleared in `finally`. A timeout refuses `epub-unreadable` with a
 * message naming the timeout (the planner fold of a dedicated timeout
 * reason — mirrors the pdfToBlocks fold).
 */
export async function withEpubTimeout(op) {
    let timer;
    try {
        return await Promise.race([
            op(),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new IngestionError("epub-unreadable", "Reading this EPUB timed out — the book was too complex to read safely.")), EPUB_EXTRACTION_TIMEOUT_MS);
            }),
        ]);
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
    }
}
// ── Chapter cap (mirrors assertPageCap) ──────────────────────────────────────
/** Refuse books over the chapter cap — `epub-too-large`. Exported so the
 * orchestrator can pre-check the same invariant. */
export function assertChapterCap(count) {
    if (count > EPUB_MAX_CHAPTERS) {
        throw new IngestionError("epub-too-large", `This book has ${count} chapters; the limit is ${EPUB_MAX_CHAPTERS}.`);
    }
}
// ── Archive layer: unzip (bomb filter) + Zip Slip gate ───────────────────────
/**
 * unzipEpub — inflate the archive with the Phase 9 bomb discipline: the
 * fflate filter sees every entry's DECLARED originalSize BEFORE inflation,
 * so an over-cap entry is never inflated (T-12-01). A book carrying any
 * over-cap entry refuses `epub-unreadable` outright — the entry is skipped
 * AND the refusal is honest rather than hoping a required document went
 * missing. Afterwards, isSafeEntryName (the tested Phase 9 gate — imported,
 * never re-derived) runs on EVERY entry key before any entry byte is used
 * (T-12-02). The mimetype entry is a SOFT signal only: presence/value are
 * never enforced (tolerant like URL extraction); corrupt zips already
 * failed at unzipSync.
 */
function unzipEpub(bytes) {
    const overCap = [];
    let entries;
    try {
        entries = unzipSync(bytes, {
            filter: (f) => {
                if (f.originalSize > EPUB_MAX_ENTRY_BYTES) {
                    overCap.push(f.name);
                    return false;
                }
                return true;
            },
        });
    }
    catch {
        throw new IngestionError("epub-unreadable", "This file could not be opened — it may be corrupt or not an EPUB.");
    }
    if (overCap.length > 0) {
        throw new IngestionError("epub-unreadable", "This EPUB contains an entry too large to read safely.");
    }
    for (const name of Object.keys(entries)) {
        if (!isSafeEntryName(name)) {
            throw new IngestionError("epub-unreadable", "This EPUB contains an entry with an unsafe name and cannot be read.");
        }
    }
    return entries;
}
// ── DRM gate — detection-only, allowlist refusal (12-RESEARCH Pattern 3) ─────
/**
 * assertNotDrmProtected — cheapest checks first, BEFORE any chapter work:
 *   1. META-INF/license.lcpl present → Readium LCP (LCP spec §7.1 presence
 *      detection) → refuse.
 *   2. META-INF/rights.xml present → Adobe ADEPT → refuse.
 *   3. META-INF/encryption.xml present → parse conservatively; refuse unless
 *      EVERY EncryptedData EncryptionMethod Algorithm is the font-
 *      obfuscation URI (the only legitimate non-DRM use, OCF §4.4.5 — fonts
 *      are never extracted, so passing entries are simply ignored). FairPlay
 *      and unknown vendors are covered by the allowlist without enumeration
 *      (assumption A1). Never decrypts; never echoes marker bytes.
 */
function assertNotDrmProtected(entries) {
    if (entries["META-INF/license.lcpl"] !== undefined) {
        throw new IngestionError("epub-protected", DRM_REFUSAL_MESSAGE);
    }
    if (entries["META-INF/rights.xml"] !== undefined) {
        throw new IngestionError("epub-protected", DRM_REFUSAL_MESSAGE);
    }
    const encrypted = entries["META-INF/encryption.xml"];
    if (encrypted === undefined)
        return;
    const doc = tryParseEpubXml(UTF8.decode(encrypted));
    const encryptedDataList = xmlArr(asObj(asObj(doc)?.encryption)?.EncryptedData);
    for (const ed of encryptedDataList) {
        if (xmlAttr(asObj(ed)?.EncryptionMethod, "Algorithm") !== FONT_OBFUSCATION_ALGORITHM) {
            // Missing or non-font-obfuscation algorithm — the allowlist refuses.
            throw new IngestionError("epub-protected", DRM_REFUSAL_MESSAGE);
        }
    }
}
/**
 * parseEpubArchive — the verified parse chain up through the OPF (Pattern 2):
 * unzip → slip gate → DRM gate → container.xml → OPF (metadata + manifest +
 * spine). Every refusal on this chain is a typed IngestionError; manifest
 * hrefs normalize through the ONE shared normalizeEpubHref so the manifest
 * side and the TOC side cannot disagree (Pitfall 1). Deprecated OPF
 * elements (bindings/tours/guide — EPUB 3.3 Appendix A) are simply never
 * read.
 */
export function parseEpubArchive(bytes) {
    const entries = unzipEpub(bytes);
    assertNotDrmProtected(entries);
    // container.xml → the OPF path relative to the zip root.
    const containerEntry = entries["META-INF/container.xml"];
    if (containerEntry === undefined) {
        throw new IngestionError("epub-unreadable", "This EPUB is missing its container manifest and cannot be read.");
    }
    const containerRoot = asObj(asObj(parseEpubXml(UTF8.decode(containerEntry)))?.container);
    const rootfiles = asObj(containerRoot?.rootfiles);
    const firstRootfile = xmlArr(rootfiles?.rootfile)[0];
    const opfPath = xmlAttr(firstRootfile, "full-path");
    if (opfPath === undefined) {
        throw new IngestionError("epub-unreadable", "This EPUB's container manifest does not name its package document.");
    }
    const opfEntry = entries[opfPath];
    if (opfEntry === undefined) {
        throw new IngestionError("epub-unreadable", "This EPUB's package document is missing.");
    }
    const opfDir = dirOf(opfPath);
    // OPF → metadata + manifest + spine.
    const pkg = asObj(asObj(parseEpubXml(UTF8.decode(opfEntry)))?.package);
    const metadataObj = asObj(pkg?.metadata);
    const manifestObj = asObj(pkg?.manifest);
    const spineObj = asObj(pkg?.spine);
    if (pkg === undefined ||
        metadataObj === undefined ||
        manifestObj === undefined ||
        spineObj === undefined) {
        throw new IngestionError("epub-unreadable", "This EPUB's package document is incomplete.");
    }
    const title = xmlText(xmlArr(metadataObj.title)[0]).trim() || "Untitled book";
    const language = xmlText(xmlArr(metadataObj.language)[0]).trim() || "en";
    const creatorFields = xmlArr(metadataObj.creator)
        .map((c) => ({ text: xmlText(c).trim(), role: xmlAttr(c, "role") }))
        .filter((c) => c.text.length > 0);
    // role="aut" authors first when present (stable otherwise); ALL creators
    // are kept — a book's byline is the publisher's to order.
    creatorFields.sort((a, b) => (a.role === "aut" ? 0 : 1) - (b.role === "aut" ? 0 : 1));
    const bookMeta = {
        title,
        authors: creatorFields.map((c) => c.text),
        language,
    };
    const publisher = xmlText(xmlArr(metadataObj.publisher)[0]).trim();
    if (publisher.length > 0)
        bookMeta.publisher = publisher;
    const publishedDate = xmlText(xmlArr(metadataObj.date)[0]).trim();
    if (publishedDate.length > 0)
        bookMeta.publishedDate = publishedDate;
    const identifier = xmlText(xmlArr(metadataObj.identifier)[0]).trim();
    if (identifier.length > 0)
        bookMeta.identifier = identifier;
    const manifestItems = [];
    const manifestById = new Map();
    for (const rawItem of xmlArr(manifestObj.item)) {
        const id = xmlAttr(rawItem, "id");
        const href = xmlAttr(rawItem, "href");
        const mediaType = xmlAttr(rawItem, "media-type");
        // Items missing required attributes are tolerated out (spec-invalid but
        // never worth refusing a readable book over).
        if (id === undefined || href === undefined || mediaType === undefined)
            continue;
        const item = {
            id,
            href: normalizeEpubHref(href, opfDir),
            mediaType,
        };
        const properties = xmlAttr(rawItem, "properties");
        if (properties !== undefined)
            item.properties = properties;
        if (!manifestById.has(id)) {
            manifestById.set(id, item);
            manifestItems.push(item);
        }
    }
    const spine = [];
    for (const rawRef of xmlArr(spineObj.itemref)) {
        const idref = xmlAttr(rawRef, "idref");
        if (idref === undefined)
            continue;
        const linearAttr = xmlAttr(rawRef, "linear");
        spine.push({
            idref,
            linear: linearAttr === "no" || linearAttr === "yes" ? linearAttr : undefined,
            item: manifestById.get(idref),
        });
    }
    const navItem = manifestItems.find((it) => (it.properties ?? "").split(/\s+/).includes("nav")) ?? undefined;
    const tocIdref = xmlAttr(spineObj, "toc");
    const ncxItem = tocIdref !== undefined ? manifestById.get(tocIdref) : undefined;
    const entryText = (href) => {
        const entry = entries[href];
        return entry === undefined ? undefined : UTF8.decode(entry);
    };
    const entryBytes = (href) => entries[href];
    return { bookMeta, opfDir, manifestItems, spine, navItem, ncxItem, entryText, entryBytes };
}
/** Flatten one nav <ol> level: each <li> with an <a> yields an entry at
 * `depth`; a nested <ol> inside a li increments depth (top-level li = 1 —
 * deeper entries are in-chapter sections, never chapter units). */
function flattenNavOl(ol, navDir, depth, out) {
    for (const li of xmlArr(asObj(ol)?.li)) {
        const liObj = asObj(li);
        const a = asObj(liObj?.a);
        const href = a !== undefined ? xmlAttr(a, "href") : undefined;
        const label = a !== undefined ? xmlText(a).trim() : "";
        if (a !== undefined && href !== undefined && href.length > 0 && label.length > 0) {
            out.push({ label, href: normalizeEpubHref(href, navDir), depth });
        }
        for (const nested of xmlArr(liObj?.ol)) {
            flattenNavOl(nested, navDir, depth + 1, out);
        }
    }
}
/**
 * resolveNavToc — the EPUB 3 navigation document (EPUB 3.3 §7): the manifest
 * item whose properties include "nav", parsed with the shared hardened
 * config; the single nav element whose epub:type is "toc" (the "@_type" key
 * under removeNSPrefix — assumption A7); its ol>li>a hierarchy flattened to
 * ordered {label, href, depth}. A nav document that fails XML parsing falls
 * through to the NCX path (tolerated — malformed XHTML navs are common);
 * undefined when no usable toc nav exists.
 */
function resolveNavToc(archive) {
    if (archive.navItem === undefined)
        return undefined;
    const text = archive.entryText(archive.navItem.href);
    if (text === undefined)
        return undefined;
    let doc;
    try {
        doc = parseEpubXml(text);
    }
    catch {
        return undefined; // tolerated → NCX path
    }
    const body = asObj(asObj(asObj(doc)?.html)?.body);
    const navDir = dirOf(archive.navItem.href);
    const out = [];
    for (const navEl of xmlArr(body?.nav)) {
        if (xmlAttr(navEl, "type") !== "toc")
            continue;
        for (const ol of xmlArr(asObj(navEl)?.ol)) {
            flattenNavOl(ol, navDir, 1, out);
        }
    }
    return out.length > 0 ? out : undefined;
}
/** Flatten NCX navPoints recursively: label = navLabel text, href =
 * content@src, depth by nesting (top level = 1). */
function flattenNcxNavPoints(points, ncxDir, depth, out) {
    for (const np of points) {
        const obj = asObj(np);
        const label = xmlText(asObj(xmlArr(obj?.navLabel)[0])?.text).trim();
        const src = xmlAttr(obj?.content, "src");
        if (label.length > 0 && src !== undefined && src.length > 0) {
            out.push({ label, href: normalizeEpubHref(src, ncxDir), depth });
        }
        flattenNcxNavPoints(xmlArr(obj?.navPoint), ncxDir, depth + 1, out);
    }
}
/**
 * resolveNcxToc — the EPUB 2 fallback (also used when an EPUB 3 book's nav
 * is unusable): spine@toc idref → the application/x-dtbncx+xml manifest
 * item → navMap>navPoint flattening. EPUB 3 nav is ALWAYS preferred over
 * NCX when both exist (EPUB 3.3 §5.9.5 — "the EPUB navigation document
 * replaces the NCX for EPUB 3 reading systems"); undefined when no NCX
 * resolves.
 */
function resolveNcxToc(archive) {
    if (archive.ncxItem === undefined)
        return undefined;
    const text = archive.entryText(archive.ncxItem.href);
    if (text === undefined)
        return undefined;
    let doc;
    try {
        doc = parseEpubXml(text);
    }
    catch {
        return undefined;
    }
    const navMap = asObj(asObj(asObj(doc)?.ncx)?.navMap);
    if (navMap === undefined)
        return undefined;
    const ncxDir = dirOf(archive.ncxItem.href);
    const out = [];
    flattenNcxNavPoints(xmlArr(navMap.navPoint), ncxDir, 1, out);
    return out.length > 0 ? out : undefined;
}
// ── Chapter normalization — the SHARED sanitize + walk path (D12-14) ─────────
/** Plain text of a paragraph/heading block (admission + title chain). */
function blockText(b) {
    if (b.kind === "paragraph" || b.kind === "heading") {
        return b.content
            .map((r) => r.text)
            .join("")
            .trim();
    }
    return "";
}
/** http(s) predicate — the remote-src arm of the container extraction
 * (auto-refused: the container is the only read source, D20-01). */
const HTTP_SRC = /^https?:/i;
/**
 * figureSrcResolver — the container-marker claim (20-RESEARCH Pattern 5,
 * option (a)): htmlToBlocks consults it ONLY for non-http figure srcs, so
 * claiming every non-empty src turns each chapter-relative marker into a
 * FigureBlock carrying the RAW src string for container resolution below
 * (data: URIs included — they never match an archive key and refuse calmly,
 * one placeholder surface everywhere per D20-06). The url/paste path passes
 * nothing and stays byte-stable (locked by extraction.spec.ts).
 */
const figureSrcResolver = (src) => src.length > 0;
/**
 * walkChapterDocument — normalize ONE spine document through the shared
 * path: sanitizeExtractedHtml (the DOMPurify SANITIZE_CONFIG surface, the
 * 07-04 mXSS suite's exact coverage) → a fresh JSDOM → htmlToBlocks. The
 * article-extraction pass is intentionally NOT applied — chapters are
 * already content documents and extraction would strip heading structure
 * and footnote lists (the 12-RESEARCH anti-pattern). Figure srcs survive as
 * container markers (figureSrcResolver above); resolution happens per
 * chapter unit in extractUnitFigures, AFTER the D12-10 admission gate.
 */
function walkChapterDocument(xhtml, path, noteSources) {
    const rawDom = new JSDOM(xhtml);
    const rawDocument = rawDom.window.document;
    const titleText = rawDocument.querySelector("title")?.textContent?.trim();
    const docTitle = titleText !== undefined && titleText.length > 0 ? titleText : undefined;
    // Issue #61 — footnotes, read from the RAW document (the sanitizer drops
    // every id and epub:type): notes this document references in another
    // spine document are copied in first, then the shared link-graph
    // detection (with EPUB note semantics) extracts every note.
    const copied = copyReferencedNotes({ path, document: rawDocument }, noteSources, resolveBookHref);
    const linked = detectLinkedFootnotes(rawDocument, { epubSemantics: true });
    const footnoteSources = settleCopiedNotes(copied, linked.noteHtml.length, linked.omittedCount);
    const footnotes = footnoteBodiesParagraphs(linked.noteHtml, undefined).map((paragraphs, i) => footnoteBodyFromParagraphs(`fn-${i + 1}`, paragraphs));
    // A document with no notes walks its original markup, byte-stable.
    const sanitized = sanitizeExtractedHtml(footnotes.length > 0 || copied !== undefined ? rawDom.serialize() : xhtml);
    const dom = new JSDOM(sanitized);
    const walked = htmlToBlocks(dom.window.document, undefined, figureSrcResolver, new Set(footnotes.map((_, i) => i + 1)));
    return {
        blocks: walked.blocks,
        footnotes,
        footnoteSources,
        notesCopiedFrom: (copied?.copies ?? []).map((c) => c.notePath),
        omittedFootnoteCount: linked.omittedCount,
        docTitle,
    };
}
/** A book-internal href (written in the document at `fromPath`) → the spine
 * path + element id it names; null for external schemes and links without
 * a fragment. Paths go through the ONE shared normalizer. */
const resolveBookHref = (rawHref, fromPath) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(rawHref) || rawHref.startsWith("//"))
        return null;
    const hashAt = rawHref.indexOf("#");
    if (hashAt < 0)
        return null;
    let fragment = rawHref.slice(hashAt + 1);
    try {
        fragment = decodeURIComponent(fragment);
    }
    catch {
        return null; // malformed escape — never a link-graph edge
    }
    if (fragment.length === 0)
        return null;
    const path = hashAt === 0 ? fromPath : normalizeEpubHref(rawHref, dirOf(fromPath));
    return { path, fragment };
};
/**
 * extractUnitFigures — resolve one ADMITTED chapter unit's figure srcs
 * against the already-open archive (zero network — D20-01):
 *   1. Collect per-document unique srcs with occurrence counts (document
 *      order; the same src string in two documents at different depths is
 *      TWO resolutions, so maps are per-doc and keyed by the raw src).
 *   2. Remote http(s) srcs auto-refuse "fetch" — the container is the only
 *      read source (T-12-05 anti-beacon; the refusal keeps originalSrc
 *      provenance, exactly what the network path writes).
 *   3. Markers resolve chapter-relative → zip-root-relative through the ONE
 *      shared normalizeEpubHref against dirOf(the document's href); the
 *      composed key passes isSafeEntryName BEFORE any byte use (T-20-23 —
 *      the existing discipline), then the entry bytes run through
 *      sniffImageAsset — the same seam and caps as the network path minus
 *      fetch (type/SVG, bytes, pixels, animated — D20-08/09/10/11).
 *   4. Caps identical to the network-path constants: MAX_FIGURES_PER_ARTICLE
 *      unique srcs per chapter unit (beyond-cap refuse "count", never
 *      sniffed) + the MAX_ARTICLE_ASSET_BYTES per-book running byte budget
 *      (over-budget figures refuse "budget" per-figure — Pitfall 6; the
 *      container's own 10MB cap bounds it naturally).
 *   5. Rewrite each document's blocks through the SHARED
 *      rewriteFiguresWithAssets (never a forked EPUB rewrite) claiming every
 *      figure src — refused markers omit src with alt + caption intact
 *      (D20-05 composure; provenance stays http-only inside the helper).
 * Never throws for per-figure problems; one bad figure never blocks the
 * chapter (or the book).
 */
function extractUnitFigures(unitDocs, archive, budget) {
    // ── Collect: per-doc unique srcs + occurrence counts, document order ──
    const perDocCounts = [];
    const collect = (bs, counts) => {
        for (const b of bs) {
            if (b.kind === "figure") {
                const src = b.src;
                if (typeof src === "string" && src.length > 0) {
                    counts.set(src, (counts.get(src) ?? 0) + 1);
                }
            }
            else if (b.kind === "blockquote") {
                collect(b.children, counts);
            }
            else if (b.kind === "bulleted-list" || b.kind === "numbered-list") {
                for (const item of b.items)
                    collect(item.content, counts);
            }
        }
    };
    for (const d of unitDocs) {
        const counts = new Map();
        collect(d.walked.blocks, counts);
        perDocCounts.push(counts);
    }
    const hasFigures = perDocCounts.some((c) => c.size > 0);
    if (!hasFigures)
        return { docs: unitDocs, assets: [], refusedCount: 0 };
    // ── Resolve: per-doc maps (same src in two documents = two entries) ────
    const perDocMaps = perDocCounts.map(() => new Map());
    const assets = [];
    let refusedCount = 0;
    let capSlotsUsed = 0; // unique srcs across the UNIT (the article, D20-11)
    unitDocs.forEach((doc, docIdx) => {
        const counts = perDocCounts[docIdx];
        const resolution = perDocMaps[docIdx];
        const chapterDir = dirOf(doc.item.href);
        for (const src of counts.keys()) {
            if (capSlotsUsed >= MAX_FIGURES_PER_ARTICLE) {
                resolution.set(src, "count"); // image-spam stopper — never sniffed
                continue;
            }
            capSlotsUsed += 1;
            let res;
            if (HTTP_SRC.test(src)) {
                res = "fetch"; // zero-network: remote srcs refuse, never fetched
            }
            else {
                const entryKey = normalizeEpubHref(src, chapterDir);
                const entry = isSafeEntryName(entryKey) ? archive.entryBytes(entryKey) : undefined;
                res = entry === undefined ? "fetch" : sniffImageAsset(entry);
            }
            if (typeof res !== "string") {
                const known = budget.byAssetId.get(res.assetId);
                if (known !== undefined) {
                    res = known; // byte-identical twin — reuse, no double charge
                }
                else if (budget.usedBytes + res.bytes.byteLength > MAX_ARTICLE_ASSET_BYTES) {
                    res = "budget"; // per-book guard — Pitfall 6 response inflation
                }
                else {
                    budget.usedBytes += res.bytes.byteLength;
                    budget.byAssetId.set(res.assetId, res);
                    assets.push(res);
                }
            }
            resolution.set(src, res);
        }
    });
    // ── Rewrite through the SHARED stage helper (claim every figure src) ───
    const docs = unitDocs.map((doc, docIdx) => {
        const counts = perDocCounts[docIdx];
        if (counts.size === 0)
            return doc;
        const rewritten = rewriteFiguresWithAssets(doc.walked.blocks, perDocMaps[docIdx], () => true);
        return { ...doc, walked: { ...doc.walked, blocks: rewritten } };
    });
    // ── Disclosure: per-FIGURE occurrences of refused resolutions ──────────
    unitDocs.forEach((_, docIdx) => {
        const counts = perDocCounts[docIdx];
        const resolution = perDocMaps[docIdx];
        for (const [src, occurrences] of counts) {
            if (typeof resolution.get(src) === "string")
                refusedCount += occurrences;
        }
    });
    return { docs, assets, refusedCount };
}
/**
 * D12-10 admission — the EPUB-adapted readerability algebra (the 11-07
 * relaxed form): the ASSEMBLED CHAPTER UNIT must walk to at least
 * minChapterBlocks blocks AND carry at least one paragraph/heading block
 * with non-empty text. The unit is the reading document the reader
 * experiences — a publisher-split chapter or a multi-document front-matter
 * range is judged as a whole (its pieces are often individually tiny), while
 * a lone cover plate or pure-image page fails alone. Cover plates and
 * pure-image pages fail; front matter with real paragraphs passes.
 * linear="no" is a skip HINT only — THIS gate decides (spec: "purely
 * supplemental").
 */
function isReaderableDocument(blocks) {
    return (blocks.length >= EPUB_THRESHOLDS.minChapterBlocks && blocks.some((b) => blockText(b).length > 0));
}
/** Media types that can be content documents; anything else in the spine
 * (a CSS file, an image) is a structural skip, not a disclosed skip. */
const CONTENT_MEDIA_TYPES = new Set(["application/xhtml+xml", "text/html"]);
/**
 * loadSpineDocs — walk every spine document once. Structural skips (the nav
 * document by its known manifest id, dangling idrefs, missing entries,
 * non-content media types) are NOT failures and NOT disclosed; admission
 * (D12-10) is judged per assembled chapter unit in assembleChapters, and
 * disclosure (D12-11's skippedCount) counts UNITS — the "2 chapters could
 * not be read" the reader sees, consistent with admitted-only numbering
 * (Pitfall 10).
 */
function loadSpineDocs(archive) {
    const loaded = [];
    for (const [pos, spineItem] of archive.spine.entries()) {
        const item = spineItem.item;
        if (item === undefined)
            continue; // dangling idref — no document exists
        if (archive.navItem !== undefined && item.id === archive.navItem.id) {
            continue; // the nav document itself — structural skip
        }
        if (!CONTENT_MEDIA_TYPES.has(item.mediaType))
            continue;
        const xhtml = archive.entryText(item.href);
        if (xhtml === undefined)
            continue; // manifest item with no zip entry
        loaded.push({ pos, item, xhtml });
    }
    // Issue #61 — the spine documents other documents link into (a Notes
    // file, usually) are parsed once more, read-only, as cross-file note
    // sources; every document then walks against them.
    const targets = new Map();
    for (const d of loaded)
        collectCrossFileTargets(d.xhtml, d.item.href, resolveBookHref, targets);
    const noteSources = new Map();
    for (const d of loaded) {
        const fragments = targets.get(d.item.href);
        if (fragments === undefined || noteSources.has(d.item.href))
            continue;
        const document = new JSDOM(d.xhtml).window.document;
        if (mayHoldNotes(document, fragments))
            noteSources.set(d.item.href, document);
    }
    const docs = loaded.map((d) => ({
        ...d,
        walked: walkChapterDocument(d.xhtml, d.item.href, noteSources),
        suppliesNotes: false,
    }));
    const supplying = new Set(docs.flatMap((d) => d.walked.notesCopiedFrom));
    for (const d of docs)
        d.suppliesNotes = supplying.has(d.item.href);
    return docs;
}
/**
 * partitionChapters — the book's own TOC declares the chapter unit (D12-09):
 *
 *   1. Top-level (depth-1) TOC entries are chapter units; deeper entries are
 *      in-chapter sections (Pitfall 4 — flattening them yields 300
 *      "chapters"). Degenerate case: exactly one depth-1 entry (often
 *      "Contents" wrapping the real book) → descend one level and use its
 *      depth-2 children.
 *   2. Each unit's href → manifest id → FIRST spine position it appears at
 *      (a TOC-only href absent from the spine is ignored; fragments were
 *      already stripped by the shared normalizer). Two units resolving to
 *      the same position keep the first.
 *   3. Chapter k's spine range = [pos(k), pos(k+1)); spine items BEFORE the
 *      first TOC entry form their own leading unit (front matter — it stays
 *      only when its assembled blocks pass admission).
 *   4. Fallback: no usable TOC, or fewer than tocMergeMinEntries distinct
 *      entries resolve → one unit per spine document, fallbackUsed: true —
 *      the calibration warning sign (Pitfall 1: fallback on a book with a
 *      good TOC means href normalization regressed).
 */
function partitionChapters(archive, docs) {
    const fallbackUnits = () => docs.map((d) => ({
        label: undefined,
        fallbackLabel: "Chapter",
        startPos: d.pos,
        endPos: d.pos + 1,
    }));
    // EPUB 3 nav preferred over NCX whenever both exist (EPUB 3.3 §5.9.5).
    const toc = resolveNavToc(archive) ?? resolveNcxToc(archive);
    if (toc === undefined)
        return { units: fallbackUnits(), fallbackUsed: true };
    let units = toc.filter((e) => e.depth === 1);
    if (units.length === 1) {
        const children = toc.filter((e) => e.depth === 2);
        if (children.length > 0)
            units = children; // degenerate descent (D12-09)
    }
    // href → manifest id → first spine position among the loaded docs (the
    // nav document and structurally-skipped items hold no position, so TOC
    // entries pointing at them resolve to nothing and are ignored).
    const firstPosByItemId = new Map();
    for (const d of docs) {
        if (!firstPosByItemId.has(d.item.id))
            firstPosByItemId.set(d.item.id, d.pos);
    }
    const hrefToItem = new Map();
    for (const it of archive.manifestItems) {
        if (!hrefToItem.has(it.href))
            hrefToItem.set(it.href, it);
    }
    const resolved = [];
    const seenPos = new Set();
    for (const unit of units) {
        if (unit.href.length === 0)
            continue;
        const item = hrefToItem.get(unit.href);
        if (item === undefined)
            continue; // TOC-only href — ignored
        const pos = firstPosByItemId.get(item.id);
        if (pos === undefined || seenPos.has(pos))
            continue;
        seenPos.add(pos);
        resolved.push({ unit, pos });
    }
    resolved.sort((a, b) => a.pos - b.pos);
    if (resolved.length < EPUB_THRESHOLDS.tocMergeMinEntries) {
        return { units: fallbackUnits(), fallbackUsed: true };
    }
    const spineEnd = archive.spine.length;
    const out = [];
    const firstPos = resolved[0]?.pos ?? 0;
    if (firstPos > 0) {
        // Spine items before the first TOC entry — the leading front-matter
        // unit (A5 resolution: titled from its first document, "Front matter"
        // as the label of last resort).
        out.push({
            label: undefined,
            fallbackLabel: "Front matter",
            startPos: 0,
            endPos: firstPos,
        });
    }
    resolved.forEach((r, i) => {
        const next = resolved[i + 1];
        out.push({
            label: r.unit.label,
            fallbackLabel: "Chapter",
            startPos: r.pos,
            endPos: next !== undefined ? next.pos : spineEnd,
        });
    });
    return { units: out, fallbackUsed: false };
}
/** The chapter title chain (12-RESEARCH Pattern 4): TOC label (publisher
 * intent — primary) → first document's <title> → first heading block text →
 * the unit's label of last resort. Numbering runs over ADMITTED chapters
 * only (Pitfall 10 — skipped chapters are disclosed, never renumbered). */
function chapterTitle(unit, unitDocs, number) {
    const label = unit.label?.trim();
    if (label !== undefined && label.length > 0)
        return label;
    const docTitle = unitDocs[0]?.walked.docTitle?.trim();
    if (docTitle !== undefined && docTitle.length > 0)
        return docTitle;
    for (const d of unitDocs) {
        for (const b of d.walked.blocks) {
            if (b.kind === "heading") {
                const t = blockText(b);
                if (t.length > 0)
                    return t;
            }
        }
    }
    // The leading unit's last resort is its plain label (an unnumbered
    // "Front matter 1" would read as a chapter number the book never had).
    return unit.fallbackLabel === "Front matter"
        ? unit.fallbackLabel
        : `${unit.fallbackLabel} ${number}`;
}
/** Emit one ChapterDraft from a unit's documents, in spine order. */
function emitChapter(unit, unitDocs, number, lang, assets, figureRefusedCount) {
    const hasher = createHash("sha256");
    for (const d of unitDocs)
        hasher.update(d.xhtml);
    // Issue #61 — one fn-1…fn-N sequence for the chapter's documents.
    const numbered = numberChapterNotes(unitDocs.map((d) => ({
        blocks: d.walked.blocks,
        footnotes: d.walked.footnotes,
        sources: d.walked.footnoteSources,
    })));
    const blocks = numbered.blocks.flat();
    const footnotes = numbered.footnotes;
    const first = unitDocs[0];
    return {
        blocks,
        footnotes,
        lang,
        title: chapterTitle(unit, unitDocs, number),
        spineIndex: first !== undefined ? first.pos : unit.startPos,
        sourceHtmlHash: hasher.digest("hex"),
        assets,
        figureRefusedCount,
        omittedFootnoteCount: unitDocs.reduce((n, d) => n + d.walked.omittedFootnoteCount, 0),
    };
}
/**
 * assembleChapters — partition the walked spine documents into chapter
 * units (D12-09), judge each unit's assembled blocks against the D12-10
 * admission algebra, and emit the admitted chapters in spine order. A unit
 * that fails admission is DISCLOSED (skippedCount, D12-11) — never a
 * whole-book refusal; only zero admitted chapters refuses (epub-empty).
 */
function assembleChapters(archive) {
    const docs = loadSpineDocs(archive);
    const { units, fallbackUsed } = partitionChapters(archive, docs);
    const chapters = [];
    let skippedCount = 0;
    // The per-book asset budget, charged in admission order across chapter
    // units (first-come deterministic; byte-identical twins reuse admissions).
    const budget = { usedBytes: 0, byAssetId: new Map() };
    for (const unit of units) {
        const unitDocs = docs.filter((d) => d.pos >= unit.startPos && d.pos < unit.endPos);
        if (unitDocs.length === 0)
            continue; // structurally empty (e.g. a
        // leading range holding only the nav document) — not a disclosed skip
        const blocks = [];
        for (const d of unitDocs)
            blocks.push(...d.walked.blocks);
        // Issue #61: a Notes file is often one heading and one long list — under
        // the block floor, yet the very notes the chapters cite. It stays.
        const suppliesNotes = unitDocs.some((d) => d.suppliesNotes) && blocks.length > 0;
        if (!isReaderableDocument(blocks) && !suppliesNotes) {
            skippedCount += 1; // cover plates / pure-image pages — disclosed
            continue;
        }
        // 20-06: figures resolve ONLY after admission — skipped plates never
        // spend sniff work and never contribute assets (D20-03 scope).
        const { docs: resolvedDocs, assets, refusedCount, } = extractUnitFigures(unitDocs, archive, budget);
        chapters.push(emitChapter(unit, resolvedDocs, chapters.length + 1, archive.bookMeta.language, assets, refusedCount));
    }
    return { chapters, skippedCount, fallbackUsed };
}
// ── epubToBooks — the SC#4 swappable adapter entry ───────────────────────────
/**
 * epubToBooks — bytes in, book + chapter drafts out (pure: no I/O beyond
 * the bytes, no Dexie, no React — SC#4 adapter isolation). The whole parse
 * races the extraction timeout. A book whose spine yields ZERO readerable
 * documents refuses `epub-empty` here (the orchestrator separately refuses
 * when all chapters fail stages 2+ — D12-11).
 */
export async function epubToBooks(bytes) {
    return withEpubTimeout(async () => {
        const archive = parseEpubArchive(bytes);
        const { chapters, skippedCount, fallbackUsed } = assembleChapters(archive);
        assertChapterCap(chapters.length);
        if (chapters.length === 0) {
            throw new IngestionError("epub-empty", "This book has no chapters with readable text.");
        }
        return {
            bookMeta: archive.bookMeta,
            chapters,
            skippedCount,
            originalFileHash: createHash("sha256").update(bytes).digest("hex"),
            fallbackUsed,
        };
    });
}
