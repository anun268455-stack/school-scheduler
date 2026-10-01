/**
 * ModalShell — the backdrop every dialog sits on.
 *
 * Closing a dialog shouldn't mean hunting for the ✕: clicking the dimmed area
 * around it closes it, and so does Esc. Clicks inside the panel are kept from
 * bubbling out, so interacting with the contents never dismisses it by accident.
 */
import React, { useEffect } from "react";
import clsx from "clsx";

interface ModalShellProps {
  onClose:   () => void;
  children:  React.ReactNode;
  /** Tailwind max-width for the panel, e.g. "max-w-2xl". */
  maxWidth?: string;
  /** Raise above other dialogs when one opens on top of another. */
  z?:        string;
  className?: string;
}

export const ModalShell: React.FC<ModalShellProps> = ({
  onClose, children, maxWidth = "max-w-lg", z = "z-[200]", className,
}) => {
  // Esc closes, matching the click-outside behaviour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className={clsx("fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4", z)}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className={clsx(
          "bg-white rounded-2xl shadow-2xl w-full overflow-hidden flex flex-col max-h-[90vh]",
          maxWidth, className,
        )}
      >
        {children}
      </div>
    </div>
  );
};

/**
 * Closes a floating panel (a toolbar popover, say) when the pointer goes down
 * anywhere outside it, or Esc is pressed.
 */
export function useDismissOnOutside(
  ref: { current: HTMLElement | null },
  open: boolean,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [ref, open, onClose]);
}
