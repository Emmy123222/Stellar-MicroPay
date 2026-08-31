/**
 * components/AIPaymentAssistant.tsx
 * AI-powered payment assistant that parses natural language payment requests.
 * Conversation history persists across panel close/reopen within a session
 * via sessionStorage.
 */

import React, { useState, useRef, useEffect, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PaymentIntent {
  amount: string;
  recipient: string;
  memo: string;
  isValid: boolean;
  clarification: string;
}

type MessageRole = "user" | "assistant" | "error";

interface Message {
  id: string;
  role: MessageRole;
  text: string;
  /** Populated only when role === "assistant" and parse was successful */
  intent?: PaymentIntent;
  timestamp: number;
}

interface AIPaymentAssistantProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (intent: PaymentIntent) => void;
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

const SESSION_KEY = "stellar-micropay:ai-conversation";

function loadMessages(): Message[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveMessages(msgs: Message[]) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(msgs));
  } catch {
    // ignore quota errors
  }
}

function clearMessages() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(SESSION_KEY);
}

let _msgCounter = 0;
function nextId() {
  return `msg-${Date.now()}-${++_msgCounter}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AIPaymentAssistant({
  isOpen,
  onClose,
  onConfirm,
}: AIPaymentAssistantProps) {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>(loadMessages);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Focus input whenever panel opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Scroll to bottom whenever new messages arrive or panel opens
  useEffect(() => {
    if (isOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [isOpen, messages]);

  // Persist messages to sessionStorage on every change
  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  const appendMessage = useCallback((msg: Omit<Message, "id" | "timestamp">) => {
    const full: Message = { ...msg, id: nextId(), timestamp: Date.now() };
    setMessages((prev) => [...prev, full]);
    return full;
  }, []);

  const handleClearConversation = () => {
    setMessages([]);
    clearMessages();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    // Append user message immediately
    appendMessage({ role: "user", text: trimmed });
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/parse-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: trimmed }),
      });

      if (!response.ok) {
        throw new Error("Failed to parse payment intent");
      }

      const intent: PaymentIntent = await response.json();

      if (intent.isValid) {
        appendMessage({
          role: "assistant",
          text: `I've parsed your payment — ${intent.amount} XLM to ${intent.recipient}${intent.memo ? ` (memo: "${intent.memo}")` : ""}. Confirm below to fill the payment form.`,
          intent,
        });
      } else {
        appendMessage({
          role: "assistant",
          text: intent.clarification || "I need a bit more detail. Could you clarify your request?",
          intent,
        });
      }
    } catch (err) {
      appendMessage({
        role: "error",
        text: "Sorry, I couldn't parse that request. Please try again.",
      });
      console.error("Payment parsing error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = (intent: PaymentIntent) => {
    onConfirm(intent);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      void handleSubmit(e as unknown as React.FormEvent);
    }
  };

  if (!isOpen) return null;

  const hasMessages = messages.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-assistant-title"
        className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl animate-slide-up flex flex-col"
        style={{ maxHeight: "90vh" }}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <h3
            id="ai-assistant-title"
            className="font-display text-lg font-semibold text-white flex items-center gap-2"
          >
            <SparklesIcon className="w-5 h-5 text-stellar-400" />
            AI Payment Assistant
          </h3>
          <div className="flex items-center gap-2">
            {hasMessages && (
              <button
                onClick={handleClearConversation}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors px-2 py-1 rounded-lg hover:bg-slate-800"
                title="Clear conversation"
                aria-label="Clear conversation history"
              >
                Clear
              </button>
            )}
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white transition-colors"
              aria-label="Close assistant"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ── Conversation thread ─────────────────────────────────────────── */}
        {hasMessages ? (
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-6 pb-2 space-y-3 min-h-0"
            aria-live="polite"
            aria-label="Conversation history"
          >
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} onConfirm={handleConfirm} />
            ))}
            {isLoading && (
              <div className="flex items-center gap-2 text-slate-400 text-sm pl-1">
                <Spinner />
                <span>Thinking…</span>
              </div>
            )}
          </div>
        ) : (
          <div className="px-6 pb-2 shrink-0">
            <p className="text-sm text-slate-400">
              Describe your payment in natural language and I&apos;ll help you fill out the form.
            </p>
          </div>
        )}

        {/* ── Input area ─────────────────────────────────────────────────── */}
        <div className="px-6 pb-6 pt-3 shrink-0 border-t border-slate-700/50 mt-2">
          <form onSubmit={handleSubmit} className="space-y-3">
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
                placeholder={
                  hasMessages
                    ? "Ask a follow-up or describe another payment…"
                    : "e.g., Send 50 XLM to GABC123... for design work"
                }
                rows={3}
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-stellar-500/50 focus:border-stellar-500 resize-none"
                disabled={isLoading}
              />
              <p className="text-xs text-slate-500 mt-1">Cmd/Ctrl + Enter to send · Esc to close</p>
            </div>

            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="w-full btn-primary flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Spinner />
                  Parsing…
                </>
              ) : (
                <>
                  <SparklesIcon className="w-4 h-4" />
                  {hasMessages ? "Send" : "Parse Payment"}
                </>
              )}
            </button>
          </form>

          {/* Examples — only shown when conversation is empty */}
          {!hasMessages && (
            <div className="mt-3 p-3 rounded-lg bg-stellar-500/5 border border-stellar-500/10">
              <p className="text-xs text-stellar-300 font-medium mb-1">Examples:</p>
              <ul className="text-xs text-slate-400 space-y-1">
                <li>&bull; &quot;Send 50 XLM to GABC123... for design work&quot;</li>
                <li>&bull; &quot;Pay 25 XLM to Alice for the consultation&quot;</li>
                <li>&bull; &quot;Transfer 100 XLM to my colleague&quot;</li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

interface MessageBubbleProps {
  message: Message;
  onConfirm: (intent: PaymentIntent) => void;
}

function MessageBubble({ message, onConfirm }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isError = message.role === "error";
  const intent = message.intent;

  return (
    <div className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-stellar-500/20 text-stellar-100 rounded-br-sm"
            : isError
              ? "bg-red-500/10 border border-red-500/20 text-red-400 rounded-bl-sm"
              : "bg-slate-800 text-slate-200 rounded-bl-sm"
        }`}
      >
        {message.text}
      </div>

      {/* Parsed intent action card (only on valid assistant messages) */}
      {intent?.isValid && (
        <div className="w-full max-w-[85%] mt-1 p-3 rounded-xl bg-slate-800/80 border border-slate-700 text-sm space-y-1.5">
          <div className="flex justify-between gap-4">
            <span className="text-slate-400 shrink-0">Amount</span>
            <span className="text-white font-medium text-right">{intent.amount || "—"}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-slate-400 shrink-0">Recipient</span>
            <span className="text-white font-mono text-xs break-all text-right">
              {intent.recipient || "—"}
            </span>
          </div>
          {intent.memo && (
            <div className="flex justify-between gap-4">
              <span className="text-slate-400 shrink-0">Memo</span>
              <span className="text-white text-right">{intent.memo}</span>
            </div>
          )}
          <button
            onClick={() => onConfirm(intent)}
            className="w-full mt-2 btn-primary text-sm py-1.5 flex items-center justify-center gap-1.5"
          >
            <CheckCircleIcon className="w-4 h-4" />
            Fill Payment Form
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M9 4.5a.75.75 0 01.721.544l.813 2.846a3.75 3.75 0 002.576 2.576l2.846.813a.75.75 0 010 1.442l-2.846.813a3.75 3.75 0 00-2.576 2.576l-.813 2.846a.75.75 0 01-1.442 0l-.813-2.846a3.75 3.75 0 00-2.576-2.576l-2.846-.813a.75.75 0 010-1.442l2.846-.813A3.75 3.75 0 007.466 7.89l.813-2.846A.75.75 0 019 4.5zM18 1.5a.75.75 0 01.728.568l.258 1.036c.236.94.97 1.674 1.91 1.91l1.036.258a.75.75 0 010 1.456l-1.036.258c-.94.236-1.674.97-1.91 1.91l-.258 1.036a.75.75 0 01-1.456 0l-.258-1.036a2.625 2.625 0 00-1.91-1.91l-1.036-.258a.75.75 0 010-1.456l1.036-.258a2.625 2.625 0 001.91-1.91l.258-1.036A.75.75 0 0118 1.5zM16.5 15a.75.75 0 01.712.513l.394 1.183c.15.447.5.799.948.948l1.183.395a.75.75 0 010 1.422l-1.183.395c-.447.15-.799.5-.948.948l-.395 1.183a.75.75 0 01-1.422 0l-.395-1.183a1.5 1.5 0 00-.948-.948l-1.183-.395a.75.75 0 010-1.422l1.183-.395c.447-.15.799-.5.948-.948l.395-1.183A.75.75 0 0116.5 15z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function XMarkIcon({ className }: { className?: string }) {
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

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
