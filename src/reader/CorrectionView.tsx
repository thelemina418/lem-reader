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
// Selection commands (#73): selecting text (pointer, touch, or Shift+←/→
// a word at a time on a focused block) shows the selection command surface
// in the command bar — never the selection toolbar. Each command (move to
// the next / previous block, own paragraph) has a key (]  [  P) and, when
// it doesn't apply, the engine's reason. The bar is fixed, so touch readers
// reach the commands from a selection with a tap, never a drag. After a
// command the owner passes a `landing`: the moved words' block is focused
// and becomes the precise passage leaving returns to.
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
import { captureSelection, domPointToIntraBlockGraphemeOffset } from "../annotations/capture";
import {
  blockNormalizedText,
  graphemeClusters,
  type TextPositionSelector,
} from "../content/normalizeText";
import type { Block } from "../content/types";
import type { BlockTypeChoice } from "../content/schema";
import {
  MOVE_REASONS,
  type SelectionCommand,
  type SelectionCommandKind,
  type SelectionCommands,
} from "../content/corrections/moveWords";
import { CORRECTION_SHORTCUTS, SELECTION_COMMAND_KEYS } from "./correctionShortcuts";

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

/** Issue #74 — one "Change type" choice for a block (computed by the owner
 * from the engine's validity rules). */
export interface TypeChoiceCommand {
  readonly to: BlockTypeChoice;
  readonly label: string;
  readonly available: boolean;
  /** Why it is unavailable (shown beside the choice). */
  readonly reason?: string;
}

/** Where to land after a command: a block path in the NEW model and the
 * offset of the moved words inside it. A new object per command. */
export interface CorrectionLanding {
  readonly path: readonly number[];
  readonly offset: number;
}

const SELECTION_LABELS: Record<SelectionCommandKind, string> = {
  "move-next": "Move to next block",
  "move-previous": "Move to previous block",
  "own-paragraph": "Make own paragraph",
};

function excerpt(words: string): string {
  const list = words.split(/\s+/);
  return list.length <= 6 ? words : `${list.slice(0, 5).join(" ")}…`;
}

/** A frame's text nodes, without the type label(s). */
function frameTextNodes(frame: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(frame, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(".correction-block-label") || !node.textContent?.trim()
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  return nodes;
}

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
  /** The selection commands for a view-coordinate selection (#73). */
  selectionCommandsFor?: (range: TextPositionSelector) => SelectionCommands;
  /** Run a selection command (the owner previews, applies, announces). */
  onSelectionCommand?: (command: SelectionCommand, words: string) => void;
  /** Land here after a command (see CorrectionLanding). */
  landing?: CorrectionLanding | null;
  /** Rendered at the end of the view's header (the corrections list, #76). */
  headerExtras?: React.ReactNode;
  /** Issue #74 — the Change type choices for a block; absent → no menu. */
  typeChoicesFor?: (block: CorrectionViewBlock) => readonly TypeChoiceCommand[];
  /** Run a Change type choice (the owner previews, applies, announces). */
  onChangeType?: (block: CorrectionViewBlock, choice: TypeChoiceCommand) => void;
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
    {
      model,
      entryOffset,
      commandsFor,
      onCommand,
      busy = false,
      selectionCommandsFor,
      onSelectionCommand,
      landing = null,
      headerExtras,
      typeChoicesFor,
      onChangeType,
    },
    ref,
  ) {
    const headingId = useId();
    const reasonId = useId();
    const typeMenuId = useId();
    const selectionReasonId = useId();
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
    // The precise passage for a block: the entry offset on the entry block,
    // or the moved words after a command. Leaving on that block returns it.
    const anchorRef = useRef<{ id: string; offset: number } | null>(null);
    useLayoutEffect(() => {
      const landed = frameAt(entryOffset);
      entryFrameRef.current = landed;
      if (!landed) return;
      anchorRef.current = { id: landed.dataset.correctionId ?? "", offset: entryOffset };
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
          const anchor = anchorRef.current;
          if (chosen === null) return anchor?.offset ?? entryOffset;
          // Still on the anchored block: keep its precise offset (a paged
          // entry may sit mid-block; moved words sit mid-block after a move)
          // so a round trip never drifts.
          if (anchor && chosen.dataset.correctionId === anchor.id) return anchor.offset;
          const block = model.blockById(chosen.dataset.correctionId ?? "");
          return block?.viewStart ?? anchor?.offset ?? entryOffset;
        },
      }),
      [model, entryOffset],
    );

    // A correction that changes the blocks re-renders the column: land on
    // the moved words when the owner says where; otherwise an anchor into
    // the old text is stale and is dropped.
    const shownArticleRef = useRef(model.article);
    const appliedLandingRef = useRef<CorrectionLanding | null>(null);
    useLayoutEffect(() => {
      const changed = shownArticleRef.current !== model.article;
      shownArticleRef.current = model.article;
      if (landing && landing !== appliedLandingRef.current) {
        appliedLandingRef.current = landing;
        const key = blockPathKey(landing.path);
        const block = model.allBlocks.find((b) => blockPathKey(b.path) === key);
        const el = block
          ? bodyRef.current?.querySelector<HTMLElement>(`[data-correction-id="${block.id}"]`)
          : null;
        if (block && el) {
          window.getSelection()?.removeAllRanges();
          anchorRef.current = { id: block.id, offset: block.viewStart + landing.offset };
          readerFocusedRef.current = true;
          el.focus();
          setCurrentId(block.id);
          return;
        }
      }
      if (changed) anchorRef.current = null;
    }, [model, landing]);

    // The selection, as the engine sees it (#73).
    const [selection, setSelection] = useState<SelectionCommands | null>(null);
    const [selectionReason, setSelectionReason] = useState("");
    useEffect(() => {
      if (!selectionCommandsFor) return;
      const update = () => {
        const root = bodyRef.current;
        const sel = window.getSelection();
        if (!root || !sel || sel.isCollapsed || sel.rangeCount === 0) {
          setSelection(null);
          return;
        }
        const range = sel.getRangeAt(0);
        if (!root.contains(range.startContainer) && !root.contains(range.endContainer)) {
          setSelection(null);
          return;
        }
        const captured = captureSelection(model.article, root);
        if (!captured.ok) {
          // In the view but not words one command can act on.
          if (captured.reason === "empty" || captured.reason === "empty-span") {
            setSelection(null);
            return;
          }
          setSelection({
            range: null,
            words: "",
            commands: (["move-next", "move-previous", "own-paragraph"] as const).map((kind) => ({
              kind,
              available: false,
              reason: MOVE_REASONS.oneBlock,
            })),
          });
          return;
        }
        setSelection(selectionCommandsFor(captured.position));
      };
      update();
      document.addEventListener("selectionchange", update);
      return () => document.removeEventListener("selectionchange", update);
    }, [model, selectionCommandsFor]);
    useEffect(() => setSelectionReason(""), [selection]);

    const runSelection = useCallback(
      (kind: SelectionCommandKind) => {
        if (!selection || busy) return;
        const command = selection.commands.find((c) => c.kind === kind);
        if (!command) return;
        if (!command.available) setSelectionReason(command.reason ?? "");
        onSelectionCommand?.(command, selection.words);
      },
      [selection, busy, onSelectionCommand],
    );
    const runSelectionRef = useRef(runSelection);
    runSelectionRef.current = runSelection;
    const hasSelectionRef = useRef(false);
    hasSelectionRef.current = selection !== null;

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
    // contract). ] [ P — the selection commands (#73); Esc clears the
    // selection.
    useEffect(() => {
      if (!commandsFor && !selectionCommandsFor) return;
      const onKey = (event: KeyboardEvent) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (isFormField(event.target)) return;
        const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
        if (selectionCommandsFor) {
          const kind = (Object.keys(SELECTION_COMMAND_KEYS) as SelectionCommandKind[]).find(
            (k) => SELECTION_COMMAND_KEYS[k] === key,
          );
          if (kind) {
            if (!hasSelectionRef.current) return;
            event.preventDefault();
            runSelectionRef.current(kind);
            return;
          }
          if (key === "Escape" && hasSelectionRef.current) {
            window.getSelection()?.removeAllRanges();
            return;
          }
        }
        if (!commandsFor) return;
        const command = runRef.current.commands.find((c) => c.shortcut === key.toUpperCase());
        if (!command) return;
        event.preventDefault();
        runRef.current.run(command);
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [commandsFor, selectionCommandsFor]);

    // Issue #74 — Change type: T (or the button) opens the choices for the
    // current block; a choice runs it, Escape closes and returns focus to
    // the block. Unavailable choices stay listed with their reason.
    const [typeMenuOpen, setTypeMenuOpen] = useState(false);
    const typeMenuRef = useRef<HTMLDivElement>(null);
    const typeChoices = current && typeChoicesFor ? typeChoicesFor(current) : [];
    const currentIdRef = useRef(currentId);
    currentIdRef.current = currentId;
    const focusCurrentBlock = useCallback(() => {
      const id = currentIdRef.current;
      const el = id
        ? bodyRef.current?.querySelector<HTMLElement>(`[data-correction-id="${id}"]`)
        : null;
      el?.focus();
    }, []);
    const openTypeMenu = useCallback(() => {
      if (!currentIdRef.current || busy) return;
      setTypeMenuOpen(true);
    }, [busy]);
    const closeTypeMenu = useCallback(() => {
      setTypeMenuOpen(false);
      focusCurrentBlock();
    }, [focusCurrentBlock]);
    useEffect(() => {
      if (!typeMenuOpen) return;
      const menu = typeMenuRef.current;
      const first =
        menu?.querySelector<HTMLElement>("button:not([aria-disabled='true'])") ??
        menu?.querySelector<HTMLElement>("button");
      first?.focus();
    }, [typeMenuOpen]);
    const openTypeMenuRef = useRef(openTypeMenu);
    openTypeMenuRef.current = openTypeMenu;
    useEffect(() => {
      if (!typeChoicesFor) return;
      const onKey = (event: KeyboardEvent) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (isFormField(event.target)) return;
        if (event.key !== "t" && event.key !== "T") return;
        event.preventDefault();
        openTypeMenuRef.current();
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [typeChoicesFor]);
    const chooseType = (choice: TypeChoiceCommand) => {
      // An unavailable choice says why beside it; the menu stays open.
      if (!current || busy || !choice.available) return;
      setTypeMenuOpen(false);
      focusCurrentBlock();
      onChangeType?.(current, choice);
    };
    const onTypeMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeTypeMenu();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = Array.from(typeMenuRef.current?.querySelectorAll<HTMLElement>("button") ?? []);
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = items[event.key === "ArrowDown" ? i + 1 : i - 1];
      if (!next) return;
      event.preventDefault();
      next.focus();
    };

    // Block-by-block movement: ArrowDown / ArrowUp on a focused block move
    // focus to the neighbouring block (Tab works too — each block is a stop).
    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      // Shift+← / Shift+→ on a focused block: select its words a word at a
      // time — from its end backwards, or its start forwards — so keyboard
      // readers select without caret browsing (#73).
      if (
        (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
        event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        const frame = frameOf(document.activeElement);
        const sel = window.getSelection();
        if (!frame || !sel || !bodyRef.current?.contains(frame)) return;
        event.preventDefault();
        const forward = event.key === "ArrowRight";
        // A collapsed caret doesn't count (Firefox parks one at the start
        // of a block it focuses): start from the block's edge instead.
        const inFrame =
          !sel.isCollapsed &&
          sel.rangeCount > 0 &&
          sel.anchorNode !== null &&
          frame.contains(sel.anchorNode);
        if (!inFrame) {
          const nodes = frameTextNodes(frame);
          const edge = forward ? nodes[0] : nodes[nodes.length - 1];
          if (!edge) return;
          sel.collapse(edge, forward ? 0 : edge.length);
        }
        sel.modify("extend", forward ? "forward" : "backward", "word");
        return;
      }
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
      window.getSelection()?.removeAllRanges();
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
            Each block shows its outline and type. Selecting text offers corrections.
          </p>
          <h2 className="correction-shortcuts-title">Keyboard shortcuts</h2>
          <dl className="correction-shortcuts">
            {CORRECTION_SHORTCUTS.map((shortcut) => (
              <div key={shortcut.label} className="correction-shortcut">
                <dt>
                  {shortcut.keys.map((k, i) => (
                    <span key={k}>
                      {i > 0 ? " " : null}
                      <kbd>{k}</kbd>
                    </span>
                  ))}
                </dt>
                <dd>{shortcut.label}</dd>
              </div>
            ))}
          </dl>
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
            {typeChoicesFor && (
              <button
                type="button"
                className="correction-command"
                aria-expanded={typeMenuOpen}
                aria-controls={typeMenuId}
                aria-disabled={!current || busy ? "true" : undefined}
                aria-keyshortcuts="T"
                onClick={() => (typeMenuOpen ? closeTypeMenu() : openTypeMenu())}
              >
                Change type <kbd>T</kbd>
              </button>
            )}
            {typeChoicesFor && typeMenuOpen && current ? (
              <div
                id={typeMenuId}
                ref={typeMenuRef}
                className="correction-type-menu"
                role="group"
                aria-label={`Change ${current.label} to`}
                onKeyDown={onTypeMenuKeyDown}
              >
                <ul>
                  {typeChoices.map((choice) => {
                    const reason = `${typeMenuId}-${choice.label.replace(/\s+/g, "-")}`;
                    return (
                      <li key={choice.label}>
                        <button
                          type="button"
                          className="correction-type-choice"
                          aria-disabled={!choice.available || busy ? "true" : undefined}
                          aria-describedby={choice.available ? undefined : reason}
                          onClick={() => chooseType(choice)}
                        >
                          {choice.label}
                        </button>
                        {!choice.available && choice.reason ? (
                          <span id={reason} className="correction-type-reason">
                            {choice.reason}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            {selection ? (
              <div
                className="correction-selection-commands"
                role="group"
                aria-label="Selection commands"
              >
                <span className="correction-commands-current">
                  {selection.words ? `Selected: “${excerpt(selection.words)}”` : "Selection"}
                </span>
                {selection.commands.map((c) => {
                  const key = SELECTION_COMMAND_KEYS[c.kind].toUpperCase();
                  return (
                    <button
                      key={c.kind}
                      type="button"
                      className="correction-command"
                      data-command={c.kind}
                      aria-disabled={!c.available || busy ? "true" : undefined}
                      aria-describedby={!c.available ? `${selectionReasonId}-${c.kind}` : undefined}
                      aria-keyshortcuts={key}
                      // Keep the text selection when the button is pressed.
                      onPointerDown={(e) => e.preventDefault()}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => runSelection(c.kind)}
                    >
                      {SELECTION_LABELS[c.kind]} <kbd>{key}</kbd>
                    </button>
                  );
                })}
                {selection.commands.map((c) =>
                  !c.available && c.reason ? (
                    <span
                      key={c.kind}
                      id={`${selectionReasonId}-${c.kind}`}
                      className="visually-hidden"
                    >
                      {c.reason}
                    </span>
                  ) : null,
                )}
                {selectionReason ? (
                  <span className="correction-commands-reason">{selectionReason}</span>
                ) : null}
              </div>
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
