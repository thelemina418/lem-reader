// src/content/corrections/describe.ts
// Spec #68 / issue #76 — every correction in plain words with the text it
// touched, for the corrections list, the undo/redo announcements and the
// consequences dialog ("Hid the paragraph “Share this article”").
//
// One describer per kind (`DESCRIBERS`): the mapped type makes a new kind
// in the Correction union a compile error here until it says what it does
// (#73–#75, #78 plug in by adding their entry). Describers read only the
// correction's own recorded text, never the article, so a not-applied
// correction is described just as well as an applied one.

import { graphemeClusters } from "../normalizeText";
import type { BlockTarget, Correction } from "../schema";

/** The first words of a quote, at most `max` graphemes-ish, with "…". */
export function excerpt(text: string, max = 40): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** The last words of a quote, at most `max`, with a leading "…". */
export function tailExcerpt(text: string, max = 30): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(flat.length - max);
  const firstSpace = cut.indexOf(" ");
  return `…${(firstSpace >= 0 && firstSpace < max / 2 ? cut.slice(firstSpace + 1) : cut).trimStart()}`;
}

const BLOCK_NOUN: Record<BlockTarget["kind"], string> = {
  heading: "heading",
  paragraph: "paragraph",
  blockquote: "quotation",
  "bulleted-list": "list",
  "numbered-list": "numbered list",
  figure: "figure",
  "code-block": "code block",
  "footnote-reference": "footnote reference",
  unsupported: "block",
};

/** “the paragraph “Share this article”” */
export function blockPhrase(target: BlockTarget): string {
  return `the ${BLOCK_NOUN[target.kind]} “${excerpt(target.quote.exact)}”`;
}

type Describer<K extends Correction["kind"]> = (correction: Extract<Correction, { kind: K }>) => {
  /** Past tense, for the list and "Undid: …" ("Hid the paragraph “…”"). */
  readonly done: string;
};

const DESCRIBERS: { [K in Correction["kind"]]: Describer<K> } = {
  hide: (c) => ({ done: `Hid ${blockPhrase(c.target)}` }),
  unhide: (c) => ({ done: `Unhid ${blockPhrase(c.target)}` }),
  split: (c) => {
    // `at` is a grapheme offset into the target's whole text (#75).
    const before = graphemeClusters(c.target.quote.exact, "und").slice(0, c.at).join("");
    return { done: `Split ${blockPhrase(c.target)} after “${tailExcerpt(before)}”` };
  },
  merge: (c) => ({
    done: `Merged ${blockPhrase(c.next)} into the ${BLOCK_NOUN[c.target.kind]} before`,
  }),
};

/** "Hid the paragraph “Share this article”" — one sentence, no full stop. */
export function describeCorrection(correction: Correction): string {
  const describe = DESCRIBERS[correction.kind] as Describer<typeof correction.kind>;
  return describe(correction as never).done;
}
