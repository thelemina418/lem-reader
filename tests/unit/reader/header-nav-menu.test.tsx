// Issue #19 — the narrow-width destination menu. Below 640px the shell
// nav's destinations sit behind ONE disclosure button (CSS owns which
// presentation shows; e2e owns the geometry). These tests pin the
// behavior contract at the Header seam: the disclosure's ARIA wiring,
// close paths (Escape → focus back to the trigger, link activation,
// outside pointer, focus leaving), and aria-current inside the menu.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SettingsProvider } from "../../../src/settings/SettingsContext";
import { Header } from "../../../src/reader/Header";

type Destination = "library" | "discover" | "annotations" | "reader" | "collections";

function renderHeader(
  opts: { destination?: Destination; readTarget?: { articleId: string } | null } = {},
) {
  const noop = () => {};
  return render(
    <SettingsProvider>
      <Header
        onOpenSettings={noop}
        settingsOpen={false}
        onToggleMode={noop}
        articleMounted={false}
        annotationCount={0}
        drawerOpen={false}
        onToggleAnnotations={noop}
        tagsOpen={false}
        onToggleTags={noop}
        tocOpen={false}
        onToggleToc={noop}
        destination={opts.destination ?? "library"}
        readTarget={opts.readTarget ?? null}
        openArticleId={null}
        addOpen={false}
        onOpenAdd={noop}
      />
      <p>
        <button type="button">outside</button>
      </p>
    </SettingsProvider>,
  );
}

const trigger = () => screen.getByRole("button", { name: "Menu" });
const nav = () => screen.getByRole("navigation", { name: "Primary" });

afterEach(cleanup);

describe("Header narrow destination menu (#19)", () => {
  it("is a collapsed disclosure inside the Primary nav, controlling the destination list", () => {
    renderHeader();
    const button = trigger();
    expect(nav().contains(button)).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const list = document.getElementById(button.getAttribute("aria-controls") ?? "");
    expect(list).not.toBeNull();
    expect(
      within(list!)
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual(["Library", "Discover", "Annotations"]);
    // Never an ARIA menu: these are navigation links, not menuitems.
    expect(button.hasAttribute("aria-haspopup")).toBe(false);
  });

  it("toggles open and closed; the current destination keeps aria-current", () => {
    renderHeader({ destination: "discover", readTarget: { articleId: "a1" } });
    fireEvent.click(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(nav().getAttribute("data-open")).toBe("true");
    expect(screen.getByRole("link", { name: "Discover" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: "Continue reading" })).toBeTruthy();
    fireEvent.click(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(nav().getAttribute("data-open")).toBe("false");
  });

  it("Escape closes and returns focus to the trigger", () => {
    renderHeader();
    fireEvent.click(trigger());
    const link = screen.getByRole("link", { name: "Discover" });
    link.focus();
    fireEvent.keyDown(link, { key: "Escape" });
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger());
  });

  it("activating a destination closes the menu without intercepting navigation", () => {
    renderHeader();
    fireEvent.click(trigger());
    const link = screen.getByRole("link", { name: "Annotations" });
    const notPrevented = fireEvent.click(link);
    expect(notPrevented).toBe(true);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("a pointer press outside the nav closes it; one inside does not", () => {
    renderHeader();
    fireEvent.click(trigger());
    fireEvent.pointerDown(screen.getByRole("link", { name: "Library" }));
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    fireEvent.pointerDown(screen.getByRole("button", { name: "outside" }));
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("focus leaving the nav closes it", () => {
    renderHeader();
    fireEvent.click(trigger());
    const link = screen.getByRole("link", { name: "Annotations" });
    const outside = screen.getByRole("button", { name: "outside" });
    fireEvent.focusOut(link, { relatedTarget: outside });
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });
});
