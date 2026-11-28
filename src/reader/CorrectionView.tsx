// src/reader/CorrectionView.tsx
// Spec #68 / issues #70, #71 — the Correction view: a third presentation
// beside paged and scrolling reading, rendered from the correction-view model
// (src/content/correctionView.ts, produced by the correction engine) through
// the existing block renderer.
//
// Always a scrolling column. Every block is framed: its boundary drawn and
// its type labelled in words, focusable one by one (Tab, or ArrowUp /
// ArrowDown between blocks), and announced as a group named by its type.
// Blocks inside a quotation are framed too (each is correctable). Hidden
// blocks stay here, dimmed and labelled "Hidden" (#71).
// Links, footnote references and highlight marks are inert
// (ArticleBody's inertInteractions); the owner mounts no selection toolbar
// and no annotation panel while this view is up. Highlight tints are mapped
// from reading coordinates into the view's (hidden blocks spend view
// offsets only).
//
// Commands (#71, #75): Hide / Unhide (X), Split at the caret (S) and Merge
// with the next block (J) act on the current block — the frame holding the
// caret, else the focused frame (or the last one focused). Each key and the
// command bar's buttons run them; an unavailable command says why instead
// of doing nothing. Split needs a caret: a collapsed selection in the block
// (or the moving end of a selection — where Shift+arrow keys leave it).
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
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ArticleBody } from "../content/render/BlockRenderer";
import { AssetProvider } from "../content/assets/AssetProvider";
import { effectiveTitle } from "../ingestion/library/effectiveMetadata";
import {
  blockPathKey,
  type CorrectionViewBlock,
  type CorrectionViewModel,
} from "../content/correctionView";
import { isFormField } from "./PageTurnControls";
import { domPointToIntraBlockGraphemeOffset } from "../annotations/capture";
import { blockNormalizedText, graphemeClusters } from "../content/normalizeText";
import type { Block } from "../content/types";

/** Header band height — the same line the reading anchors measure from. */
const HEADER_PX = 48;
/** Where a landed frame's top sits: just under the header band. */
const LANDING_LINE_PX = HEADER_PX + 8;

export interface CorrectionViewHandle {
  /** The passage the reader is at now, in view coordinates. */
  captureOffset(): number;
}

export type BlockAction = "hide" | "unhide" | "split" | "merge";

/** What the command bar offers for a block (computed by the owner). */
export interface BlockCommand {
  readonly action: BlockAction;
  /** The button's words, e.g. "Hide block". */
  readonly label: string;
  /** The single-letter shortcut (plain key, no modifiers), e.g. "X". */
  readonly shortcut: string;
  readonly available: boolean;
  /** Why it is unavailable (shown and announced). */
  readonly reason?: string;
}

/** The caret inside the current block: an offset into the block's own
 * normalized text, or null when the caret isn't in it. */
export type BlockCaret = number | null;

interface CorrectionViewProps {
  model: CorrectionViewModel;
  /** Where the reader was on entry, in view coordinates. */
  entryOffset: number;
  /** The block commands for a block; absent → no command bar. */
  commandsFor?: (block: CorrectionViewBlock, caret: BlockCaret) => readonly BlockCommand[];
  /** Run a command for a block (the owner previews, applies, announces). */
  onCommand?: (block: CorrectionViewBlock, command: BlockCommand, caret: BlockCaret) => void;
  /** True while a command is being applied. */
  busy?: boolean;
  /** Rendered at the end of the view's header (the corrections list, #76). */
  headerExtras?: React.ReactNode;
}

function frameOf(el: Element | null): HTMLElement | null {
  return (el?.closest?.(".correction-block") as HTMLElement | null) ?? null;
}

/** The block at `path` in the view article. */
function blockAtPath(model: CorrectionViewModel, path: readonly number[]): Block | undefined {
  let block: Block | undefined = model.article.blocks[path[0]!];
  for (const i of path.slice(1))
    block = block?.kind === "blockquote" ? block.children[i] : undefined;
  return block;
}

/** Where the selection's moving end sits: its innermost frame and the
 * offset into that frame's block text. Null when outside every frame. */
function caretInFrames(
  root: HTMLElement,
  model: CorrectionViewModel,
): { id: string; offset: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.focusNode) return null;
  const node = selection.focusNode;
  const frameEl = frameOf(
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement,
  );
  if (!frameEl || !root.contains(frameEl)) return null;
  const entry = model.blockById(frameEl.dataset.correctionId ?? "");
  // The frame's block element: its last child (the type label comes first).
  const blockEl = frameEl.lastElementChild as HTMLElement | null;
  const block = entry && blockAtPath(model, entry.path);
  if (!entry || !block || !blockEl || !blockEl.contains(node)) return null;
  const norm = graphemeClusters(blockNormalizedText(block), model.article.lang);
  return {
    id: entry.id,
    offset: domPointToIntraBlockGraphemeOffset(
      blockEl,
      node,
      selection.focusOffset,
      model.article.lang,
      norm,
    ),
  };
}

function inViewport(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.bottom > HEADER_PX && r.top < window.innerHeight;
}

export const CorrectionView = forwardRef<CorrectionViewHandle, CorrectionViewProps>(
  function CorrectionView(
    { model, entryOffset, commandsFor, onCommand, busy = false, headerExtras },
    ref,
  ) {
    const headingId = useId();
    const reasonId = useId();
    const bodyRef = useRef<HTMLDivElement>(null);
    const { article, blocks } = model;
    // The current block: the focused frame, or the last one focused.
    const [currentId, setCurrentId] = useState<string | null>(null);

    // The block frame: boundary + type label (+ "Hidden"). Stable per model
    // so the ArticleBody memo holds across owner re-renders.
    const frame = useCallback(
      (entry: CorrectionViewBlock | undefined, element: React.ReactElement) => {
        const label = entry?.label ?? "Block";
        return (
          <div
            className="correction-block"
            role="group"
            aria-label={entry?.hidden ? `${label}, hidden` : label}
            tabIndex={0}
            data-correction-block={entry ? blockPathKey(entry.path) : undefined}
            data-correction-id={entry?.id}
            data-hidden={entry?.hidden ? "true" : undefined}
          >
            <span className="correction-block-label" aria-hidden="true">
              {label}
              {entry?.hidden ? <span className="correction-block-hidden"> · Hidden</span> : null}
            </span>
            {element}
          </div>
        );
      },
      [],
    );
    const blockFrame = useCallback(
      (index: number, element: React.ReactElement) => frame(blocks[index], element),
      [blocks, frame],
    );
    const childFrame = useCallback(
      (path: readonly number[], element: React.ReactElement) =>
        frame(model.blockById(`block-${blockPathKey(path)}`), element),
      [model, frame],
    );
    // Highlights arrive in reading coordinates; the view renders hidden
    // blocks too. Identity when nothing is hidden (byte-unchanged tints).
    const highlightOffsetMap = model.allBlocks.some((b) => b.hidden)
      ? model.viewOffsetFor
      : undefined;

    // The top-level frame holding a view offset — from the model, never
    // from DOM text (the frames' type labels are text the article lacks).
    const frameAt = useCallback(
      (offset: number): HTMLElement | null => {
        const root = bodyRef.current;
        if (!root || blocks.length === 0) return null;
        const block = blocks.find((b) => offset <= b.viewEnd) ?? blocks[blocks.length - 1]!;
        return root.querySelector<HTMLElement>(`[data-correction-id="${block.id}"]`);
      },
      [blocks],
    );

    // Land the entry passage under the header and give it focus, before
    // paint (no visible jump; nothing animates).
    const readerFocusedRef = useRef(false);
    const entryFrameRef = useRef<HTMLElement | null>(null);
    useLayoutEffect(() => {
      const landed = frameAt(entryOffset);
      entryFrameRef.current = landed;
      if (!landed) return;
      const top = landed.getBoundingClientRect().top + window.scrollY - LANDING_LINE_PX;
      window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
      landed.focus({ preventScroll: true });
      setCurrentId(landed.dataset.correctionId ?? null);
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
          let chosen: HTMLElement | null = null;
          // Focus counts once the READER has moved it (the entry landing's
          // own focus is not a choice of passage).
          if (
            focused &&
            readerFocusedRef.current &&
            root.contains(focused) &&
            inViewport(focused)
          ) {
            chosen = focused;
          } else {
            // Top-visible: the last top-level frame whose top has reached the
            // header line — the same line the entry landing puts a frame on
            // (the reading anchors' rule, measured on the frame so the type
            // label above the block counts as the block).
            for (const candidate of root.querySelectorAll<HTMLElement>(
              ".correction-view-body > .correction-block",
            )) {
              if (chosen !== null && candidate.getBoundingClientRect().top > LANDING_LINE_PX + 4) {
                break;
              }
              chosen = candidate;
            }
          }
          if (chosen === null) return entryOffset;
          // Still on the entry block: keep the entry's precise offset (a
          // paged entry may sit mid-block) so a round trip never drifts.
          if (chosen === entryFrameRef.current) return entryOffset;
          const block = model.blockById(chosen.dataset.correctionId ?? "");
          return block?.viewStart ?? entryOffset;
        },
      }),
      [model, entryOffset],
    );

    // The caret: where the selection's moving end sits, tracked so the
    // command bar's availability follows it. A caret in a frame makes that
    // frame's block the current one.
    const [caret, setCaret] = useState<{ id: string; offset: number } | null>(null);
    useEffect(() => {
      if (!commandsFor) return;
      const onSelection = () => {
        const root = bodyRef.current;
        const at = root ? caretInFrames(root, model) : null;
        setCaret((was) => (was?.id === at?.id && was?.offset === at?.offset ? was : at));
        if (at) setCurrentId(at.id);
      };
      document.addEventListener("selectionchange", onSelection);
      return () => document.removeEventListener("selectionchange", onSelection);
    }, [commandsFor, model]);

    const current = currentId !== null ? model.blockById(currentId) : undefined;
    const caretOffset = current && caret?.id === current.id ? caret.offset : null;
    const commands = current && commandsFor ? commandsFor(current, caretOffset) : [];
    // The reason last asked for (an unavailable command tried), shown until
    // the current block or the caret moves.
    const [asked, setAsked] = useState<BlockAction | null>(null);
    useEffect(() => setAsked(null), [currentId, caretOffset, model]);
    const run = useCallback(
      (command: BlockCommand) => {
        if (!current || busy) return;
        if (!command.available) setAsked(command.action);
        onCommand?.(current, command, caretOffset);
      },
      [current, busy, onCommand, caretOffset],
    );
    const runRef = useRef({ run, commands });
    runRef.current = { run, commands };

    // X / S / J — the current block's commands. Plain keys only (Ctrl/Cmd+X
    // stays cut), never from form fields or dialogs (the isFormField
    // contract).
    useEffect(() => {
      if (!commandsFor) return;
      const onKey = (event: KeyboardEvent) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (isFormField(event.target)) return;
        const key = event.key.toUpperCase();
        const command = runRef.current.commands.find((c) => c.shortcut === key);
        if (!command) return;
        event.preventDefault();
        runRef.current.run(command);
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [commandsFor]);

    // Block-by-block movement: ArrowDown / ArrowUp on a focused block move
    // focus to the neighbouring block (Tab works too — each block is a stop).
    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const at = event.target as HTMLElement;
      if (!at.classList.contains("correction-block")) return;
      const frames = Array.from(
        bodyRef.current?.querySelectorAll<HTMLElement>(".correction-block") ?? [],
      );
      const i = frames.indexOf(at);
      const next = frames[event.key === "ArrowDown" ? i + 1 : i - 1];
      if (!next) return;
      event.preventDefault();
      next.focus();
    };

    const askedReason = commands.find((c) => c.action === asked && !c.available)?.reason;

    return (
      <section className="correction-view" aria-labelledby={headingId}>
        <header className="correction-view-header">
          <h1 id={headingId} className="correction-view-title">
            Correction view
          </h1>
          <p className="correction-view-article">{effectiveTitle(article)}</p>
          <p className="correction-view-help">
            Each block shows its outline and type. Move between blocks with Tab or the arrow keys.
            {commandsFor
              ? " Press X to hide or unhide the current block, S to split it at the caret, J to merge it with the next block."
              : null}
            {headerExtras
              ? " Ctrl+Z undoes your last change and Ctrl+Shift+Z redoes it; L lists every correction."
              : null}{" "}
            Press C, or the Correction view button, to go back to reading.
          </p>
          {headerExtras}
        </header>
        {commandsFor && (
          <div className="correction-commands" role="toolbar" aria-label="Block commands">
            <span className="correction-commands-current">
              {current
                ? `Current block: ${current.label}${current.hidden ? ", hidden" : ""}`
                : null}
            </span>
            {commands.map((command) => (
              <button
                key={command.action}
                type="button"
                className="correction-command"
                data-action={command.action}
                aria-disabled={!command.available || busy ? "true" : undefined}
                aria-describedby={
                  !command.available && command.reason ? `${reasonId}-${command.action}` : undefined
                }
                aria-keyshortcuts={command.shortcut}
                onClick={() => run(command)}
              >
                {command.label} <kbd>{command.shortcut}</kbd>
              </button>
            ))}
            {commands.map((command) =>
              !command.available && command.reason ? (
                <span
                  key={command.action}
                  id={`${reasonId}-${command.action}`}
                  className="visually-hidden"
                >
                  {command.reason}
                </span>
              ) : null,
            )}
            {askedReason ? (
              <span className="correction-commands-reason" aria-hidden="true">
                {askedReason}
              </span>
            ) : null}
          </div>
        )}
        <AssetProvider article={article}>
          {/* Keyboard handling is delegated from the focusable block frames. */}
          <div
            className="article-body correction-view-body"
            ref={bodyRef}
            onKeyDown={onKeyDown}
            onFocus={(event) => {
              if (event.target !== entryFrameRef.current) readerFocusedRef.current = true;
              const focusedFrame = frameOf(event.target as Element);
              if (focusedFrame?.dataset.correctionId) {
                setCurrentId(focusedFrame.dataset.correctionId);
              }
            }}
          >
            <ArticleBody
              article={article}
              inertInteractions
              blockFrame={blockFrame}
              childFrame={childFrame}
              highlightOffsetMap={highlightOffsetMap}
            />
          </div>
        </AssetProvider>
      </section>
    );
  },
);
