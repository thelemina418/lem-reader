import type { ReactNode, Ref } from "react";
import { useActionInspection } from "./useActionInspection";

/**
 * One icon-only annotation panel action. The accessible name is the
 * aria-label; the same words float on hover, keyboard focus, and
 * touch-and-hold through the slot row's inspection vocabulary, so a hold
 * inspects without activating. `align` keeps the floating label inside the
 * panel for controls pinned to the footer's inline end.
 */
export function AnnotationIconButton({
  label,
  onActivate,
  children,
  align = "start",
  disabled = false,
  className,
  buttonRef,
}: {
  label: string;
  onActivate: () => void;
  children: ReactNode;
  align?: "start" | "end";
  disabled?: boolean;
  className?: string;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const { activeLabel, inspectionProps } = useActionInspection({ keyboardFocusOnly: true });
  return (
    <span className={`annotation-icon-action annotation-icon-action-${align}`}>
      <button
        ref={buttonRef}
        type="button"
        className={`highlight-controls-button annotation-icon-button${className ? ` ${className}` : ""}`}
        aria-label={label}
        disabled={disabled}
        {...inspectionProps(label, onActivate)}
      >
        {children}
      </button>
      <span
        className="annotation-panel-slot-label annotation-icon-label"
        aria-hidden="true"
        hidden={!activeLabel}
      >
        {activeLabel}
      </span>
    </span>
  );
}
