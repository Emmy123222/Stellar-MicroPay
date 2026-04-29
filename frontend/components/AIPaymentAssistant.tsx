/**
 * components/AIPaymentAssistant.tsx
 * AI-powered payment assistant that parses natural language payment requests
 */

import React, { useState, useRef, useEffect } from "react";

interface PaymentIntent {
  amount: string;
  recipient: string;
  memo: string;
  isValid: boolean;
  clarification: string;
}

interface AIPaymentAssistantProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (intent: PaymentIntent) => void;
}

export default function AIPaymentAssistant({
  isOpen,
  onClose,
  onConfirm,
}: AIPaymentAssistantProps) {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [parsedIntent, setParsedIntent] = useState<PaymentIntent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Reset state when closed
  useEffect(() => {
    if (!isOpen) {
      setInput("");
      setParsedIntent(null);
      setError(null);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    setIsLoading(true);
    setError(null);
    setParsedIntent(null);

    try {
      const response = await fetch("/api/parse-payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: input.trim() }),
      });

      if (!response.ok) {
        throw new Error("Failed to parse payment intent");
      }

      const intent: PaymentIntent = await response.json();
      setParsedIntent(intent);
    } catch (err) {
      setError("Failed to parse your request. Please try again.");
      console.error("Payment parsing error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = () => {
    if (parsedIntent && parsedIntent.isValid) {
      onConfirm(parsedIntent);
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleSubmit(e);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-assistant-title"
        className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl animate-slide-up"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 id="ai-assistant-title" className="font-display text-lg font-semibold text-white flex items-center gap-2">
            <SparklesIcon className="w-5 h-5 text-stellar-400" />
            AI Payment Assistant
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
            aria-label="Close assistant"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-slate-400 mb-4">
          Describe your payment in natural language and I&apos;ll help you fill out the form.
        </p>


        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="payment-input" className="sr-only">
              Payment description
            </label>
            <textarea
              ref={inputRef}
              id="payment-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g., Send 50 XLM to GABC123... for design work"
              className="w-full h-24 px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-stellar-500/50 focus:border-stellar-500 resize-none"
              disabled={isLoading}
            />
            <p className="text-xs text-slate-500 mt-1">
              Press Cmd/Ctrl + Enter to parse, or Escape to close
            </p>
          </div>

          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="w-full btn-primary flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <Spinner />
                Parsing...
              </>
            ) : (
              <>
                <SparklesIcon className="w-4 h-4" />
                Parse Payment
              </>
            )}
          </button>
        </form>

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {parsedIntent && (
          <div className="mt-4 p-4 rounded-lg bg-slate-800 border border-slate-700">
            <h4 className="font-medium text-white mb-3 flex items-center gap-2">
              {parsedIntent.isValid ? (
                <>
                  <CheckCircleIcon className="w-4 h-4 text-emerald-400" />
                  Parsed Payment Details
                </>
              ) : (
                <>
                  <ExclamationTriangleIcon className="w-4 h-4 text-amber-400" />
                  Need More Information
                </>
              )}
            </h4>

            {parsedIntent.isValid ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Amount:</span>
                  <span className="text-white font-medium">{parsedIntent.amount || "Not specified"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Recipient:</span>
                  <span className="text-white font-mono text-xs break-all">{parsedIntent.recipient || "Not specified"}</span>
                </div>
                {parsedIntent.memo && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Memo:</span>
                    <span className="text-white">{parsedIntent.memo}</span>
                  </div>
                )}

                <div className="flex gap-2 mt-4">
                  <button
                    onClick={handleConfirm}
                    className="flex-1 btn-primary text-sm py-2"
                  >
                    Fill Payment Form
                  </button>
                  <button
                    onClick={() => setParsedIntent(null)}
                    className="px-4 py-2 text-sm border border-slate-600 rounded-lg text-slate-300 hover:border-slate-500 transition-colors"
                  >
                    Try Again
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-amber-300 text-sm">{parsedIntent.clarification}</p>
                <button
                  onClick={() => setParsedIntent(null)}
                  className="w-full btn-secondary text-sm py-2"
                >
                  Try Again
                </button>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 p-3 rounded-lg bg-stellar-500/5 border border-stellar-500/10">
          <p className="text-xs text-stellar-300 font-medium mb-1">Examples:</p>
          <ul className="text-xs text-slate-400 space-y-1">
            <li>• &quot;Send 50 XLM to GABC123... for design work&quot;</li>
            <li>• &quot;Pay 25 XLM to Alice for the consultation&quot;</li>
            <li>• &quot;Transfer 100 XLM to my colleague&quot;</li>
          </ul>

        </div>
      </div>
    </div>
  );
}

// Floating Assistant Button Component
interface FloatingAssistantButtonProps {
  onClick: () => void;
}

export function FloatingAssistantButton({ onClick }: FloatingAssistantButtonProps) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-r from-stellar-500 to-stellar-400 hover:from-stellar-400 hover:to-stellar-300 text-white rounded-full shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center group z-40"
      aria-label="Open AI Payment Assistant"
    >
      <SparklesIcon className="w-6 h-6 group-hover:scale-110 transition-transform" />

      {/* Tooltip */}
      <div className="absolute bottom-full right-0 mb-2 px-3 py-1 bg-slate-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
        AI Payment Assistant
        <div className="absolute top-full right-3 w-2 h-2 bg-slate-800 rotate-45 -mt-1"></div>
      </div>
    </button>
  );
}

// Icons
function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path fillRule="evenodd" d="M9 4.5a.75.75 0 01.721.544l.813 2.846a3.75 3.75 0 002.576 2.576l2.846.813a.75.75 0 010 1.442l-2.846.813a3.75 3.75 0 00-2.576 2.576l-.813 2.846a.75.75 0 01-1.442 0l-.813-2.846a3.75 3.75 0 00-2.576-2.576l-2.846-.813a.75.75 0 010-1.442l2.846-.813A3.75 3.75 0 007.466 7.89l.813-2.846A.75.75 0 019 4.5zM18 1.5a.75.75 0 01.728.568l.258 1.036c.236.94.97 1.674 1.91 1.91l1.036.258a.75.75 0 010 1.456l-1.036.258c-.94.236-1.674.97-1.91 1.91l-.258 1.036a.75.75 0 01-1.456 0l-.258-1.036a2.625 2.625 0 00-1.91-1.91l-1.036-.258a.75.75 0 010-1.456l1.036-.258a2.625 2.625 0 001.91-1.91l.258-1.036A.75.75 0 0118 1.5zM16.5 15a.75.75 0 01.712.513l.394 1.183c.15.447.5.799.948.948l1.183.395a.75.75 0 010 1.422l-1.183.395c-.447.15-.799.5-.948.948l-.395 1.183a.75.75 0 01-1.422 0l-.395-1.183a1.5 1.5 0 00-.948-.948l-1.183-.395a.75.75 0 010-1.422l1.183-.395c.447-.15.799-.5.948-.948l.395-1.183A.75.75 0 0116.5 15z" clipRule="evenodd" />
    </svg>
  );
}

function XMarkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
    </svg>
  );
}

function ExclamationTriangleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}