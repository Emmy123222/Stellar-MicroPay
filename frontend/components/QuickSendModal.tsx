/**

 * The Quick-send modal opened via Ctrl+K / Cmd+K from any page.
 *
 * This is for Issue #64 / #33 — Add keyboard shortcut to open send payment form
 */

import Modal from "@/components/Modal";
import SendPaymentForm from "@/components/SendPaymentForm";

interface QuickSendModalProps {
  isOpen: boolean;
  onClose: () => void;
  publicKey: string;
  xlmBalance: string;
  usdcBalance?: string | null;
}

export default function QuickSendModal({
  isOpen,
  onClose,
  publicKey,
  xlmBalance,
  usdcBalance,
}: QuickSendModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Quick send payment"
      lockBodyScroll
      overlayClassName="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-fade-in"
      panelClassName="relative w-full max-w-md animate-slide-up outline-none"
    >
      {/* Close button */}
      <button
        onClick={onClose}
        aria-label="Close quick send modal"
        className="absolute -top-3 -right-3 z-10 w-7 h-7 flex items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-400 hover:text-white hover:border-slate-500 transition-colors shadow-lg"
      >
        <XIcon className="w-3.5 h-3.5" />
      </button>

      {/* Keyboard hint */}
      <p className="mb-2 text-xs text-slate-400 text-right select-none">
        Press{" "}
        <kbd className="px-1.5 py-0.5 rounded border border-slate-700 bg-slate-800 text-slate-400 font-mono text-xs">
          Esc
        </kbd>{" "}
        to close
      </p>

      <SendPaymentForm
        publicKey={publicKey}
        xlmBalance={xlmBalance}
        usdcBalance={usdcBalance}
        onSuccess={onClose}
      />
    </Modal>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
