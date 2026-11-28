import type { Block } from "../types";

const ASSET_SCHEME = "asset:";

/**
 * referencedAssetIds — THE one answer to "which stored assets does this
 * article reference?" (issue #82, spec #81 prefactor). Returns the
 * scheme-stripped `img-<12hex>` asset ids in document order, recursing
 * through containers (blockquote children + list item content — figures
 * nest per the assetStage rewrite recursion), each id listed once
 * (byte-identical twins share one content-hash asset — D7-07).
 *
 * Refused figures (no src) and legacy remote-src figures reference no
 * stored asset and are skipped.
 *
 * Every consumer routes through here — rendering asset resolution
 * (AssetProvider), import's missing-asset gate (portability/conflicts) and
 * the book-arm chapter attribution (addToLibrary) — so a new block kind
 * that carries a stored asset (embed-card thumbnails, spec #81) is added in
 * this one walk and can never be missed by a figure-only twin.
 */
export function referencedAssetIds(blocks: readonly Block[]): string[] {
  const ids: string[] = [];
  const visit = (nodes: readonly Block[]) => {
    for (const block of nodes) {
      if (block.kind === "figure") {
        if (block.src !== undefined && block.src.startsWith(ASSET_SCHEME)) {
          const id = block.src.slice(ASSET_SCHEME.length);
          if (!ids.includes(id)) ids.push(id);
        }
      } else if (block.kind === "blockquote") {
        visit(block.children);
      } else if (block.kind === "bulleted-list" || block.kind === "numbered-list") {
        for (const item of block.items) {
          visit(item.content);
        }
      }
    }
  };
  visit(blocks);
  return ids;
}
