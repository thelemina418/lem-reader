// src/reader/CorrectionView.tsx
// Spec #68 / issue #70 — the Correction view: a third presentation beside
// paged and scrolling reading, rendered from the correction-view model
// (src/content/correctionView.ts) through the existing block renderer.
//
// Always a scrolling column. Every block is framed: its boundary drawn and
// its type labelled in words, focusable one by one (Tab, or ArrowUp /
// ArrowDown between blocks), and announced as a group named by its type.
// Links, footnote references and highlight marks are inert
// (ArticleBody's inertInteractions); the owner mounts no selection toolbar
// and no annotation panel while this view is up.
//
// Position: the owner passes the entry offset (view coordinates); on mount
// the view lands that block under the header and focuses it. The owner
// calls `captureOffset()` on leave: the focused block when it is in view,
// otherwise the top-visible block (the mode-switch anchor rule, measured on
// the block frames), so leaving lands where the reader is looking.
// The view itself saves nothing: scrolling here is not reading progress.

import {
  forwardRef,
  useCallback,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import { ArticleBody } from "../content/render/BlockRenderer";
import { AssetProvider } from "../content/assets/AssetProvider";
import { articleGraphemeIndex } from "../content/normalizeText";
import { effectiveTitle } from "../ingestion/library/effectiveMetadata";
import type { CorrectionViewModel } from "../content/correctionView";
import { findScrollTarget, queryBlocks } from "./restoreLocation";

/** Header band height — the same line the reading anchors measure from. */
const HEADER_PX = 48;
/** Where a landed frame's top sits: just under the header band. */
const LANDING_LINE_PX = HEADER_PX + 8;

export interface CorrectionViewHandle {
  /** The passage the reader is at now, in view coordinates. */
  captureOffset(): number;
}

interface CorrectionViewProps {
  model: CorrectionViewModel;
  /** Where the reader was on entry, in view coordinates. */
  entryOffset: number;
}

function frameOf(el: Element | null): HTMLElement | null {
  return (el?.closest?.(".correction-block") as HTMLElement | null) ?? null;
}

function inViewport(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.bottom > HEADER_PX && r.top < window.innerHeight;
}

export const CorrectionView = forwardRef<CorrectionViewHandle, CorrectionViewProps>(
  function CorrectionView({ model, entryOffset }, ref) {
    const headingId = useId();
    const bodyRef = useRef<HTMLDivElement>(null);
    const { article, blocks } = model;

    // The block frame: boundary + type label. Stable per model so the
    // ArticleBody memo holds across owner re-renders.
    const blockFrame = useCallback(
      (index: number, element: React.ReactElement) => {
        const entry = blocks[index];
        const label = entry?.label ?? "Block";
        return (
          <div
            className="correction-block"
            role="group"
            aria-label={entry?.hidden ? `${label}, hidden` : label}
            tabIndex={0}
            data-correction-block={index}
            data-hidden={entry?.hidden ? "true" : undefined}
          >
            <span className="correction-block-label" aria-hidden="true">
              {label}
              {entry?.hidden ? " · Hidden" : null}
            </span>
            {element}
          </div>
        );
      },
      [blocks],
    );

    const blockAt = useCallback(
      (offset: number): HTMLElement | null => {
        const root = bodyRef.current;
        if (!root) return null;
        return findScrollTarget(article, queryBlocks(root), offset);
      },
      [article],
    );

    // Land the entry passage under the header and give it focus, before
    // paint (no visible jump; nothing animates).
    const entryBlockRef = useRef<HTMLElement | null>(null);
    const readerFocusedRef = useRef(false);
    const entryFrameRef = useRef<HTMLElement | null>(null);
    useLayoutEffect(() => {
      const target = blockAt(entryOffset);
      const frame = frameOf(target);
      entryBlockRef.current = target;
      entryFrameRef.current = frame;
      if (!frame) return;
      const top = frame.getBoundingClientRect().top + window.scrollY - LANDING_LINE_PX;
      window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
      frame.focus({ preventScroll: true });
      // Mount-only: the entry landing happens once per entry.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        captureOffset() {
          const root = bodyRef.current;
          if (!root) return entryOffset;
          const focused = frameOf(document.activeElement);
          let frame: HTMLElement | null = null;
          // Focus counts once the READER has moved it (the entry landing's
          // own focus is not a choice of passage).
          if (
            focused &&
            readerFocusedRef.current &&
            root.contains(focused) &&
            inViewport(focused)
          ) {
            frame = focused;
          } else {
            // Top-visible: the last frame whose top has reached the header
            // line — the same line the entry landing puts a frame on (the
            // reading anchors' rule, measured on the frame so the type label
            // above the block counts as the block).
            for (const candidate of root.querySelectorAll<HTMLElement>(".correction-block")) {
              if (frame !== null && candidate.getBoundingClientRect().top > LANDING_LINE_PX + 4) {
                break;
              }
              frame = candidate;
            }
          }
          const block = frame?.querySelector<HTMLElement>("[data-block-index]") ?? null;
          if (block === null) return entryOffset;
          // Still on the entry block: keep the entry's precise offset (a
          // paged entry may sit mid-block) so a round trip never drifts.
          if (block === entryBlockRef.current) return entryOffset;
          const index = Number(block.dataset.blockIndex);
          return articleGraphemeIndex(article).blockStartOffsets[index] ?? entryOffset;
        },
      }),
      [article, entryOffset],
    );

    // Block-by-block movement: ArrowDown / ArrowUp on a focused block move
    // focus to the neighbouring block (Tab works too — each block is a stop).
    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const current = event.target as HTMLElement;
      if (!current.classList.contains("correction-block")) return;
      const frames = Array.from(
        bodyRef.current?.querySelectorAll<HTMLElement>(".correction-block") ?? [],
      );
      const i = frames.indexOf(current);
      const next = frames[event.key === "ArrowDown" ? i + 1 : i - 1];
      if (!next) return;
      event.preventDefault();
      next.focus();
    };

    return (
      <section className="correction-view" aria-labelledby={headingId}>
        <header className="correction-view-header">
          <h1 id={headingId} className="correction-view-title">
            Correction view
          </h1>
          <p className="correction-view-article">{effectiveTitle(article)}</p>
          <p className="correction-view-help">
            Each block shows its outline and type. Move between blocks with Tab or the arrow keys.
            Press C, or the Correction view button, to go back to reading.
          </p>
        </header>
        <AssetProvider article={article}>
          {/* Keyboard handling is delegated from the focusable block frames. */}
          <div
            className="article-body correction-view-body"
            ref={bodyRef}
            onKeyDown={onKeyDown}
            onFocus={(event) => {
              if (event.target !== entryFrameRef.current) readerFocusedRef.current = true;
            }}
          >
            <ArticleBody article={article} inertInteractions blockFrame={blockFrame} />
          </div>
        </AssetProvider>
      </section>
    );
  },
);
