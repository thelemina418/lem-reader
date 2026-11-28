// The annotations drawer's deferred trigger restore must not take focus back
// from a destination the close handed it to. Linux WebKit, lem-reader #2
// attempt 5: navigate-back closes the drawer and focuses the highlight's
// <mark> when the jump settles. When frames ran slow, the two-frame trigger
// restore landed after that and moved focus back to the drawer trigger.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { AnnotationsDrawer } from "../../../src/reader/annotations/AnnotationsDrawer";

vi.mock("../../../src/reader/annotations/HighlightOverlay", () => ({
  useHighlightOverlay: () => ({ highlights: [] }),
}));
vi.mock("../../../src/reader/annotations/ArticleNotes", () => ({
  ArticleNotes: () => null,
}));

if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal =
    HTMLDialogElement.prototype.showModal ??
    function showDialogPolyfill(this: HTMLDialogElement) {
      this.open = true;
    };
  HTMLDialogElement.prototype.close =
    HTMLDialogElement.prototype.close ??
    function closeDialogPolyfill(this: HTMLDialogElement) {
      if (!this.open) return;
      this.open = false;
      this.dispatchEvent(new Event("close"));
    };
}

// Frames run only when the test says so, so each case fixes the order of the
// restore against the destination focus.
let frames: FrameRequestCallback[] = [];
const flushFrames = (count: number) => {
  for (let i = 0; i < count; i++) {
    const due = frames;
    frames = [];
    act(() => due.forEach((cb) => cb(performance.now())));
  }
};

beforeEach(() => {
  frames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function mount() {
  const trigger = document.createElement("button");
  trigger.textContent = "Highlights and notes";
  const destination = document.createElement("mark");
  destination.tabIndex = -1;
  document.body.append(trigger, destination);
  trigger.focus();
  const props = {
    articleId: "a",
    onClose: () => {},
    onNavigate: () => {},
    onEditNote: () => {},
    onDelete: () => {},
    onExportHighlights: () => {},
    exportingHighlights: false,
  };
  const utils = render(<AnnotationsDrawer open {...props} />);
  const close = () => act(() => utils.rerender(<AnnotationsDrawer open={false} {...props} />));
  return { trigger, destination, close };
}

describe("AnnotationsDrawer focus restore after close", () => {
  it("leaves focus on a destination focused before the deferred restore runs", () => {
    const { destination, close } = mount();
    close();
    // navigate-back's settle focus lands first (slow frames)…
    destination.focus();
    // …then the two restore frames run.
    flushFrames(2);
    expect(document.activeElement).toBe(destination);
  });

  it("restores the trigger when focus was dropped to <body>", () => {
    const { trigger, close } = mount();
    close();
    // macOS WebKit's late post-close restore targets <body>.
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    flushFrames(2);
    expect(document.activeElement).toBe(trigger);
  });

  it("restores the trigger when focus is still inside the closed dialog", () => {
    const { trigger, close } = mount();
    // showModal focused the drawer's first control; closing leaves it there
    // in engines without a native restore.
    expect(document.querySelector("dialog")?.contains(document.activeElement)).toBe(true);
    close();
    flushFrames(2);
    expect(document.activeElement).toBe(trigger);
  });
});
