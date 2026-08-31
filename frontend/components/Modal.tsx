/**
 * components/Modal.tsx
 * Shared modal shell: backdrop, dialog semantics, focus trap, focus return,
 * Escape handling and optional body-scroll lock.
 *
 * Extracted from QRCodeModal, PaymentStatusModal and QuickSendModal, which each
 * carried their own copy of this logic (#627).
 */

import { ReactNode, useEffect, useRef } from "react";

const DEFAULT_OVERLAY_CLASSNAME =
  "fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  /** id of the element labelling the dialog. */
  labelledBy?: string;
  /** id of the element describing the dialog. */
  describedBy?: string;
  /** Accessible name, when no visible element can label the dialog. */
  ariaLabel?: string;
  /** Classes for the full-screen backdrop; replaces the default styling. */
  overlayClassName?: string;
  /** Classes for the dialog panel itself. */
  panelClassName?: string;
  /** Close when the backdrop (not the panel) is clicked. Defaults to true. */
  closeOnBackdropClick?: boolean;
  /** Close when Escape is pressed. Defaults to true. */
  closeOnEscape?: boolean;
  /** Hide page scrollbars while the modal is open. Defaults to false. */
  lockBodyScroll?: boolean;
}

export default function Modal({
  isOpen,
  onClose,
  children,
  labelledBy,
  describedBy,
  ariaLabel,
  overlayClassName = DEFAULT_OVERLAY_CLASSNAME,
  panelClassName = "",
  closeOnBackdropClick = true,
  closeOnEscape = true,
  lockBodyScroll = false,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Focus trap: move focus into the dialog, keep Tab cycling inside it, and
  // hand focus back to whatever opened the modal on close.
  useEffect(() => {
    if (!isOpen) return;

    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement ? active : null;

    // The panel is already committed to the DOM when this effect runs, so focus
    // can move straight away rather than waiting for the next frame.
    const focusable = getFocusableElements(dialogRef.current);
    (focusable[0] ?? dialogRef.current)?.focus();

    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;

      const focusable = getFocusableElements(dialogRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;

      if (event.shiftKey) {
        if (!current || !dialogRef.current?.contains(current) || current === first) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (!current || !dialogRef.current?.contains(current) || current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleTab);

    return () => {
      document.removeEventListener("keydown", handleTab);

      const target = returnFocusRef.current;
      if (target) {
        window.setTimeout(() => target.focus(), 0);
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, closeOnEscape, onClose]);

  useEffect(() => {
    if (!lockBodyScroll) return;

    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen, lockBodyScroll]);

  if (!isOpen) return null;

  return (
    <div
      data-testid="modal-backdrop"
      className={overlayClassName}
      onMouseDown={(event) => {
        if (closeOnBackdropClick && event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={panelClassName}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Visible, focusable descendants of `root`, in document order.
 */
export function getFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];

  const selector = [
    "button:not([disabled])",
    "[href]",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");

  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((element) => {
    const style = window.getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none";
  });
}
