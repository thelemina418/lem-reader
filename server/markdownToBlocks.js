// server/markdownToBlocks.ts
// Plan 08-01 Task 1 — the strict-CommonMark → 9-kind Block tree adapter. This
// is the second intake format of the Phase 7 ingestion pipeline (sibling of
// `server/htmlToBlocks.ts`). The orchestrator (`server/ingest.ts`) treats
// `markdownToBlocks` and `extractAndNormalize` identically downstream — they
// return the EXACT same `{ blocks, footnotes, lang, provenancePartial,
// isReaderable }` shape, and the same `ArticleSchema.parse` +
// `probeRoundTripAnchor` + `deriveConfidence` stages run on both paths.
//
// ──────────────────────────────────────────────────────────────────────────
// SECURITY BOUNDARY (D8-16 — Pitfall 8-2):
// Strict CommonMark by default escapes raw HTML to inert text. We never
// instruct remark-parse to pass through raw HTML. The mdast walker maps
// `html` nodes to a ParagraphBlock whose inline run text is the literal
// `node.value` string (e.g. the string "<script>alert(1)</script>"). The
// string never re-enters an HTML parser — React escapes text children on
// render, and the Block tree is pure JSON by the time it reaches the
// renderer. The repo-wide eslint `react/no-danger` rule is the
// belt-and-suspenders structural defense.
//
// ⚠️ Future maintainer: DO NOT enable raw-HTML pass-through on the parser,
// DO NOT pipe `html` node values through an HTML parser, DO NOT carry raw
// HTML as a structured payload. The doc model IS the security boundary
// (ING-07) — once content is Block JSON it is inert.
// ──────────────────────────────────────────────────────────────────────────
//
// Pitfall 8-1 (round-trip drift): the inline-run shape MUST match what
// `normalizeText` expects. `extractInlineMdast` + `tidyRuns` mirror the
// DOM-walking pair in `server/htmlToBlocks.ts` L121-181 byte-faithfully
// (whitespace collapse via the same `replace(/\s+/g, " ")`, mark
// accumulation, leading/trailing ws drop, adjacent same-mark merge). A drift
// here silently orphans every annotation anchor and trips
// `probeRoundTripAnchor` on the next ingest.
//
// Server-only (Pitfall 8-6): `unified` / `remark-parse` / `remark-frontmatter`
// / `yaml` are ESM-only and never imported by `/src/*` modules at runtime.
// Only the `Block` / `InlineRun` types are imported (erased by tsc), so the
// client bundle does not grow.
import { unified } from "unified";
import remarkParse from "remark-parse"; // strict CommonMark (raw HTML escaped by default)
import remarkFrontmatter from "remark-frontmatter"; // emits mdast `yaml` node for front-matter
import { gfmFootnote } from "micromark-extension-gfm-footnote"; // issue #62 — `[^n]` syntax only
import { gfmFootnoteFromMarkdown } from "mdast-util-gfm-footnote";
import { parse as parseYaml } from "yaml"; // strict YAML 1.2 (safe-schema; no implicit type coercion)
import { attachAdjacentCaptions, withCaption } from "./figureCaptions";
import { footnoteBodyFromParagraphs } from "../src/content/footnoteBody";
import { MAX_LINKED_FOOTNOTES } from "./footnoteLinks";
// ── The 9 schema-allowed block kinds (src/content/schema.ts BlockSchema). ────
// Used by the catch-all UnsupportedBlock branch (Pattern F — no `default`).
const SCHEMA_KINDS = new Set([
    "heading",
    "paragraph",
    "bulleted-list",
    "numbered-list",
    "blockquote",
    "figure",
    "code-block",
    "footnote-reference",
    "unsupported",
]);
/** The unified processor — strict CommonMark + YAML front-matter (D8-16).
 * `remarkParse` (default CommonMark) escapes raw HTML; we never enable the
 * raw-HTML pass-through option. `remarkFrontmatter` recognises the leading
 * `--- ... ---` block and emits it as a `yaml` mdast node. */
const processor = unified().use(remarkParse).use(remarkFrontmatter).use(remarkFootnotesOnly);
/** Spec #66 / issue #62 — GitHub-style footnotes (`[^label]` references and
 * `[^label]: …` definitions) and NOTHING else from GFM. `remark-gfm` would
 * also switch on tables, task lists, strikethrough and autolinks, changing
 * the output of documents without footnotes; wiring the official footnote
 * extension pair directly keeps those documents byte-identical. Raw HTML
 * inside a definition is parsed by the same CommonMark rules as the body, so
 * the D8-16 inert-text boundary above holds inside notes too. */
function remarkFootnotesOnly() {
    const data = this.data();
    (data.micromarkExtensions ??= []).push(gfmFootnote());
    (data.fromMarkdownExtensions ??= []).push(gfmFootnoteFromMarkdown());
}
/** Keyed by mdast node identity; each parse makes fresh nodes, so calls
 * never see each other's entries. */
const referenceRoles = new WeakMap();
// ── Inline-run extraction (D-04 mark set — mirrors htmlToBlocks L121-156) ────
/** Recurse an mdast node LIST and accumulate inline runs carrying D-04 marks.
 * The node-list form is the byte-faithful core; `extractInlineMdast`
 * delegates to it (and the issue #19 paragraph segmentation reuses it
 * directly so caption runs flow through the IDENTICAL mark logic — no drift,
 * Pitfall 8-1 discipline). The recursion shape mirrors `extractInlineNodes`
 * in htmlToBlocks.ts so the output feeds `normalizeText` identically. */
function extractInlineMdastNodes(nodes, marks) {
    const runs = [];
    for (const child of nodes) {
        if (child.type === "text") {
            // whitespace collapse — Pitfall 8-1 (byte-faithful with htmlToBlocks L125)
            const text = (child.value ?? "").replace(/\s+/g, " ");
            if (text.trim().length > 0)
                runs.push({ text, marks });
            else if (text.length > 0)
                runs.push({ text: " ", marks });
            continue;
        }
        if (child.type === "break") {
            // mdast `break` (a backslash + newline or two trailing spaces) → single
            // space — mirrors htmlToBlocks L130-133 (`<br>` handling).
            runs.push({ text: " ", marks });
            continue;
        }
        if (child.type === "footnoteReference") {
            // Issue #62 — the marker text is the note number (as GitHub renders
            // it). A reference with no role (unreachable: micromark only makes a
            // reference when the label is defined) contributes nothing.
            const role = referenceRoles.get(child);
            if (role?.kind === "mark") {
                const { marker, footnoteId, occurrence } = role;
                runs.push({
                    text: marker,
                    marks: [...marks, { type: "footnote-ref", footnoteId, occurrence }],
                });
            }
            else if (role) {
                runs.push({ text: role.marker, marks });
            }
            continue;
        }
        if (child.type === "inlineCode") {
            // mdast `inlineCode` is a LEAF with `.value` (no `.children`); emit the
            // literal value as a text run carrying the code mark. Mirrors the
            // htmlToBlocks `<code>` path: the mark is pushed AND the element's text
            // content is captured (L145-147 + L152 recursion). For mdast, the text
            // lives in `.value` not `.children`.
            const text = child.value ?? "";
            if (text.length > 0) {
                runs.push({ text, marks: [...marks, { type: "code" }] });
            }
            continue;
        }
        const next = [...marks];
        if (child.type === "link") {
            const href = child.url ?? "";
            // T-7-17 / T-8-02: only http(s)/mailto hrefs become LinkMark; others
            // are demoted to plain text (the run recurses without a link mark). The
            // schema's linkableUrl refinement re-validates at ArticleSchema.parse.
            if (/^(https?:|mailto:)/i.test(href)) {
                const title = child.title ?? undefined;
                next.push(title ? { type: "link", href, title } : { type: "link", href });
            }
        }
        else if (child.type === "strong") {
            next.push({ type: "strong" });
        }
        else if (child.type === "emphasis") {
            next.push({ type: "em" });
        }
        // For all other inline types (image, html inline, etc.) recurse without a
        // new mark — the content is carried as text children of the node, or
        // dropped if the node has no inline-runnable children.
        runs.push(...extractInlineMdastNodes(child.children ?? [], next));
    }
    return runs;
}
/** Extract inline runs from one mdast node's children (the historical shape). */
function extractInlineMdast(node, marks) {
    return extractInlineMdastNodes(node.children ?? [], marks);
}
/** Collapse leading/trailing whitespace-only runs; merge adjacent identical-
 * mark runs. Byte-faithful with htmlToBlocks.ts L159-181 (Pitfall 8-1 — a
 * drift here silently orphans every annotation anchor). */
function tidyRuns(runs) {
    const out = [];
    for (const r of runs) {
        if (r.text.trim().length === 0 && out.length === 0)
            continue; // drop leading ws
        const last = out[out.length - 1];
        const sameMarks = last !== undefined &&
            last.marks.length === r.marks.length &&
            last.marks.every((m, i) => JSON.stringify(m) === JSON.stringify(r.marks[i]));
        if (sameMarks && last !== undefined) {
            last.text += r.text;
        }
        else {
            out.push({ ...r });
        }
    }
    while (out.length) {
        const last = out[out.length - 1];
        if (last && last.text.trim().length === 0)
            out.pop();
        else
            break;
    }
    for (const r of out)
        r.text = r.text.replace(/[ \t]{2,}/g, " ");
    return out;
}
// ── Block mapping (exhaustive if-chain — Pattern F; no `default:` clause) ────
/** Walk one top-level mdast node and emit 0..N Block nodes. Container kinds
 * (blockquote, listItem) recurse via flatMap so nested content composes
 * cleanly. Mirrors `visit()` in htmlToBlocks.ts L272-366. */
function visit(node) {
    // yaml front-matter is handled by the top-level walker (does NOT emit a
    // Block). Defensive guard — if a yaml node ever reaches visit(), emit
    // nothing rather than a misleading block.
    if (node.type === "yaml")
        return [];
    if (node.type === "heading") {
        const depth = node.depth ?? 1;
        // Clamp to 1..6 — schema's HeadingBlock.level union refuses anything
        // outside, and mdast depth is already 1..6 per CommonMark, but the guard
        // keeps the level typed as the schema's literal union.
        const level = Math.max(1, Math.min(6, depth));
        const content = tidyRuns(extractInlineMdast(node, []));
        return content.length ? [{ kind: "heading", level, content }] : [];
    }
    if (node.type === "paragraph") {
        const children = node.children ?? [];
        const images = children.filter((c) => c.type === "image");
        // markdown has no native figure syntax — images are inline constructs.
        // Issue #19: when the paragraph's meaningful content BEGINS at its first
        // image (image-first), each image promotes to a figure carrying its
        // trailing text as caption runs (a real <figcaption> below the image);
        // the previously-silent image drop is gone. Text-first mixed paragraphs
        // keep their runs byte-identical (images contribute nothing to run
        // extraction — Pitfall 8-1) and still hoist their figures with empty
        // captions (HTML parity). Images nested inside inline wrappers
        // (emphasis/link/…) cannot be segmented at the child level, so such
        // paragraphs keep the legacy paragraph-only shape — a heuristic miss
        // degrades to today's behavior, never to lost text.
        if (images.length > 0) {
            const nestedImage = children.some((c) => c.type !== "image" && containsImageDeep(c));
            const segments = nestedImage ? null : splitChildSegments(children);
            if (segments && tidyRuns(extractInlineMdastNodes(segments[0], [])).length === 0) {
                return images.flatMap((img, k) => withCaption(figureFromImage(img), tidyRuns(extractInlineMdastNodes(segments[k + 1] ?? [], []))));
            }
            const content = tidyRuns(extractInlineMdast(node, []));
            const hoisted = images.flatMap((img) => figureFromImage(img));
            if (content.length) {
                return hoisted.length
                    ? [{ kind: "paragraph", content }, ...hoisted]
                    : [{ kind: "paragraph", content }];
            }
            return hoisted;
        }
        const content = tidyRuns(extractInlineMdast(node, []));
        return content.length ? [{ kind: "paragraph", content }] : [];
    }
    if (node.type === "blockquote") {
        const children = visitChildren(node.children ?? []);
        if (children.length)
            return [{ kind: "blockquote", children }];
        // Fallback: empty blockquote → nothing. Mirrors htmlToBlocks L312-315.
        return [];
    }
    if (node.type === "list") {
        const ordered = node.ordered === true;
        const items = [];
        for (const item of node.children ?? []) {
            if (item.type !== "listItem")
                continue;
            // listItem.children is typically [paragraph, ...]; walk each as a block.
            const itemContent = visitChildren(item.children ?? []);
            if (itemContent.length)
                items.push({ content: itemContent });
        }
        if (!items.length)
            return [];
        if (!ordered)
            return [{ kind: "bulleted-list", items }];
        const start = typeof node.start === "number" && node.start > 0 ? node.start : 1;
        return [{ kind: "numbered-list", items, start }];
    }
    if (node.type === "code") {
        const source = node.value ?? "";
        if (!source.trim().length)
            return [];
        const lang = typeof node.lang === "string" && node.lang.length > 0 ? node.lang.toLowerCase() : undefined;
        return [lang ? { kind: "code-block", source, language: lang } : { kind: "code-block", source }];
    }
    if (node.type === "thematicBreak") {
        // Decorative; no Block kind in the schema (mirrors htmlToBlocks hr case).
        return [];
    }
    if (node.type === "html") {
        // Pitfall 8-2 — raw HTML block: emit a ParagraphBlock whose inline run
        // text is the literal `node.value` string. The string is INERT TEXT — it
        // never re-enters an HTML parser. React escapes text children on render.
        // The doc model IS the security boundary (ING-07).
        const text = node.value ?? "";
        if (!text.length)
            return [];
        return [{ kind: "paragraph", content: [{ text, marks: [] }] }];
    }
    // image at top level (rare — mdast usually wraps in paragraph) → FigureBlock
    if (node.type === "image") {
        return figureFromImage(node);
    }
    // Catch-all (Pattern F — no `default:` clause; the unsupported branch IS
    // the catch-all). Any mdast node type not enumerated above becomes an
    // honest DOC-06 disclosure.
    return [
        {
            kind: "unsupported",
            originalKind: node.type,
            plainDescription: `A ${node.type} element from the original document that the reader could not render.`,
        },
    ];
}
/** Issue #19 — split a paragraph's child nodes into caption segments:
 * segments[0] holds the nodes before the first image, then one segment per
 * image holds the nodes between it and the next image (or the paragraph
 * end). Each segment's runs feed the caption channel through the shared
 * extractor, so marks and whitespace behave byte-identically to paragraph
 * runs. */
function splitChildSegments(children) {
    const segments = [[]];
    for (const child of children) {
        if (child.type === "image") {
            segments.push([]);
            continue;
        }
        segments[segments.length - 1].push(child);
    }
    return segments;
}
/** True when an image hides INSIDE an inline wrapper (emphasis, link, …) —
 * such images cannot be segmented at the paragraph-child level. */
function containsImageDeep(node) {
    for (const child of node.children ?? []) {
        if (child.type === "image")
            return true;
        if (containsImageDeep(child))
            return true;
    }
    return false;
}
/**
 * visitChildren — walk one container's mdast children through `visit`, then
 * run the issue #19 adjacent-caption pass over the flattened result so
 * caption-looking paragraphs attach to caption-empty figures at every
 * container level (top level, blockquote children, list items).
 */
function visitChildren(nodes) {
    return attachAdjacentCaptions(nodes.flatMap((c) => visit(c)));
}
/** Build a FigureBlock from an mdast image node. http(s) srcs produce the
 * accepted-remote form (the 20-02 asset stage rewrites them inline); every
 * non-http src (relative paths, data: URIs, bare words) produces a REFUSED
 * FigureBlock — alt preserved as content, src omitted (20-RESEARCH OQ2
 * resolution; D20-06 one-placeholder-surface rule) — NOT an
 * UnsupportedBlock. T-8-02's scheme discipline holds: ArticleSchema.httpUrl
 * re-validates at parse time and the FigureBlock src union has no arm for
 * any non-http scheme (D20-02). */
function figureFromImage(node) {
    const src = node.url ?? "";
    const alt = node.alt ?? "";
    if (/^https?:/i.test(src)) {
        return [{ kind: "figure", alt, src, caption: [] }];
    }
    return [{ kind: "figure", alt, caption: [] }];
}
/**
 * markdownToBlocks — the strict-CommonMark → Block tree adapter. Pure function
 * (no I/O); safe to call concurrently. Returns the same shape as
 * `extractAndNormalize` so `server/ingest.ts` dispatches both identically.
 *
 * Front-matter handling (D8-17): a leading `---\ntitle: T\nauthor: A\ndate: D\n---`
 * block is parsed via strict YAML 1.2 and merged into `provenancePartial`.
 * Only `title` / `author` / `date` string fields are carried; non-string
 * fields are dropped. `date` becomes an ISO-8601 string via
 * `new Date(date).toISOString()` — the schema's `.datetime()` refinement
 * re-validates at ArticleSchema.parse.
 *
 * The filename → title fallback chain (D8-17) runs in `server/ingest.ts`
 * (Task 2), not here — this adapter is filename-agnostic.
 */
export async function markdownToBlocks(md) {
    const tree = processor.parse(md);
    const definitions = takeFootnoteDefinitions(tree);
    const provenancePartial = {};
    const body = [];
    for (const node of tree.children ?? []) {
        // yaml front-matter → provenancePartial (does NOT emit a Block).
        if (node.type === "yaml") {
            mergeYamlFrontMatter(node.value ?? "", provenancePartial);
            continue;
        }
        body.push(node);
    }
    const numbered = numberFootnotes(body, definitions);
    // Issue #60 — the note cap HTML shares; the rest are counted for the
    // ingest disclosure (their references already read as plain markers).
    const notes = numbered.slice(0, MAX_LINKED_FOOTNOTES);
    const omittedFootnoteCount = numbered.length - notes.length;
    const blocks = visitChildren(body);
    const footnotes = notes.map((def, i) => footnoteBodyFromParagraphs(`fn-${i + 1}`, noteRuns(def)));
    return {
        blocks,
        footnotes,
        lang: "en", // markdown carries no lang attribute (mirrors htmlToBlocks detectLang default)
        provenancePartial,
        isReaderable: blocks.length >= 3, // mirrors deriveConfidence heuristic; planner-tunable
        // Present only when the cap cut notes: documents under it are unchanged.
        ...(omittedFootnoteCount > 0 ? { omittedFootnoteCount } : {}),
    };
}
// ── Footnotes (spec #66 / issue #62) ────────────────────────────────────────
/** Remove every `footnoteDefinition` from the tree (definitions may sit at
 * any container level) and return them in document order, first definition
 * per identifier winning, as GitHub does. Removing them keeps a note from
 * also appearing in the body flow. */
function takeFootnoteDefinitions(root) {
    const definitions = new Map();
    const walk = (node) => {
        if (!node.children)
            return;
        const kept = [];
        for (const child of node.children) {
            if (child.type === "footnoteDefinition") {
                const id = child.identifier ?? "";
                if (!definitions.has(id))
                    definitions.set(id, child);
                continue;
            }
            walk(child);
            kept.push(child);
        }
        node.children = kept;
    };
    walk(root);
    return definitions;
}
/** Assign every reference its role and return the notes in `fn-N` order:
 * notes numbered by their first body reference (GitHub's rendered order),
 * then definitions nothing in the body points at, in definition order —
 * kept rather than silently dropped. Notes past MAX_LINKED_FOOTNOTES are
 * still returned (the caller cuts and counts them); their body references
 * become plain markers. The body walk is a plain document-order
 * traversal, matching the order the canonical reference spans read. */
function numberFootnotes(body, definitions) {
    const numbers = new Map();
    const order = [];
    const occurrences = new Map();
    const number = (id) => {
        let n = numbers.get(id);
        if (n === undefined) {
            order.push(definitions.get(id));
            n = order.length;
            numbers.set(id, n);
        }
        return n;
    };
    const visitRefs = (nodes, inNote) => {
        for (const node of nodes) {
            if (node.type === "footnoteReference") {
                const id = node.identifier ?? "";
                if (!definitions.has(id))
                    continue;
                if (inNote)
                    continue; // numbered after the body pass
                const n = number(id);
                if (n > MAX_LINKED_FOOTNOTES) {
                    // Past the cap (issue #60): the note is left out, so its
                    // reference is its plain marker, never a link to nowhere.
                    referenceRoles.set(node, { kind: "plain", marker: String(n) });
                    continue;
                }
                const footnoteId = `fn-${n}`;
                const occurrence = (occurrences.get(footnoteId) ?? 0) + 1;
                occurrences.set(footnoteId, occurrence);
                referenceRoles.set(node, { kind: "mark", marker: String(n), footnoteId, occurrence });
                continue;
            }
            visitRefs(node.children ?? [], inNote);
        }
    };
    visitRefs(body, false);
    for (const id of definitions.keys())
        number(id);
    const markInNotes = (nodes) => {
        for (const node of nodes) {
            if (node.type === "footnoteReference" && definitions.has(node.identifier ?? "")) {
                referenceRoles.set(node, { kind: "plain", marker: String(numbers.get(node.identifier)) });
                continue;
            }
            markInNotes(node.children ?? []);
        }
    };
    for (const def of definitions.values())
        markInNotes(def.children ?? []);
    return order;
}
/** A definition's note body (issue #59): its children through the normal
 * block walker, flattened to paragraphs — a quotation or list inside a note
 * becomes paragraphs with its text intact. Figures contribute their caption;
 * code keeps its text. */
function noteRuns(definition) {
    return noteParagraphs(visitChildren(definition.children ?? []))
        .map((runs) => tidyRuns(runs))
        .filter((runs) => runs.length > 0);
}
function noteParagraphs(blocks) {
    return blocks.flatMap((block) => {
        if (block.kind === "paragraph" || block.kind === "heading")
            return [block.content];
        if (block.kind === "figure")
            return block.caption.length ? [block.caption] : [];
        if (block.kind === "blockquote")
            return noteParagraphs(block.children);
        if (block.kind === "bulleted-list" || block.kind === "numbered-list") {
            return block.items.flatMap((item) => noteParagraphs(item.content));
        }
        if (block.kind === "code-block") {
            const text = block.source.replace(/\s+/g, " ").trim();
            return text ? [[{ text, marks: [{ type: "code" }] }]] : [];
        }
        return []; // unsupported / legacy reference kinds carry no note text
    });
}
/** Parse a YAML front-matter block and merge title/author/date string fields
 * into `provenancePartial` (D8-17). Non-string fields are dropped. `date` is
 * converted to ISO-8601 via `new Date(date).toISOString()`; if the parse
 * throws (invalid date) the field is dropped. Strict YAML 1.2 mitigates
 * T-8-03 (billion-laughs / type coercion — the `yaml` package uses the
 * safe-schema by default; no implicit type coercion). */
function mergeYamlFrontMatter(yamlText, out) {
    let meta;
    try {
        meta = parseYaml(yamlText);
    }
    catch {
        // Invalid YAML → drop the front-matter silently; the title fallback chain
        // in ingest.ts picks up filename → neutral string.
        return;
    }
    if (typeof meta !== "object" || meta === null)
        return;
    const record = meta;
    if (typeof record.title === "string" && record.title.length > 0) {
        out.title = record.title;
    }
    if (typeof record.author === "string" && record.author.length > 0) {
        out.author = record.author;
    }
    if (typeof record.date === "string" && record.date.length > 0) {
        try {
            out.publishedAt = new Date(record.date).toISOString();
        }
        catch {
            /* invalid date string — drop the field */
        }
    }
}
/**
 * stripMarkdownExtension — pure string-only helper that strips a trailing
 * `.md` or `.markdown` extension (case-insensitive). Implements the D8-17
 * filename-fallback channel that `server/ingest.ts` consumes when deriving a
 * title from the uploaded filename (front-matter absent). The File API
 * returns just the filename (no leading path), so this helper does NO
 * path-basename logic — it operates on the raw string the client passes.
 *
 * Examples (mirrored in the unit suite):
 *   stripMarkdownExtension("essay.md")         === "essay"
 *   stripMarkdownExtension("essay.markdown")   === "essay"
 *   stripMarkdownExtension("Essay.MD")         === "Essay"
 *   stripMarkdownExtension("no-extension")     === "no-extension"
 *   stripMarkdownExtension("archive.post.md")  === "archive.post"
 */
export function stripMarkdownExtension(filename) {
    return filename.replace(/\.(md|markdown)$/i, "");
}
// Re-export SCHEMA_KINDS for the unit suite (single source of truth).
export { SCHEMA_KINDS };
