// src/reader/CorrectionViewToggle.tsx
// Spec #68 / issue #70 — the header control that enters and leaves the
// Correction view, beside the reading-mode toggle and in the same quiet
// register (.mode-toggle anatomy: 44×44, --board-soft at rest, lit only when
// pressed). aria-pressed carries the state; the glyph is the secondary cue.
// The C shortcut (registered in ArticleView) shares the same handler.
// Presentational: the parent routes the click through ArticleView's
// position-carrying enter/leave path.

import { BlocksIcon } from "../ui/icons";

interface CorrectionViewToggleProps {
  active: boolean;
  onToggle: () => void;
}

export function CorrectionViewToggle({
  active,
  onToggle,
}: CorrectionViewToggleProps): React.ReactElement {
  return (
    <button
      type="button"
      className="mode-toggle correction-toggle"
      aria-pressed={active}
      aria-label="Correction view"
      aria-keyshortcuts="C"
      title="Correction view (C)"
      onClick={(event) => {
        // macOS WebKit does not focus a clicked <button>; leaving restores
        // focus here, so make the click path match the keyboard path.
        event.currentTarget.focus();
        onToggle();
      }}
    >
      <BlocksIcon />
    </button>
  );
}
