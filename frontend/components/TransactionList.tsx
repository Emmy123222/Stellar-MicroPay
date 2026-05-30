/**
 * components/TransactionList.tsx
 * Displays paginated payment history for a Stellar account.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/router";
import {
  getPaymentHistory,
  shortenAddress,
  explorerUrl,
  PaymentRecord,
  PaymentHistoryResponse,
} from "@/lib/stellar";
import { formatAsset, timeAgo, copyToClipboard } from "@/utils/format";
import {
  HistoryIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  RefreshIcon,
  ExternalLinkIcon,
  PrinterIcon,
} from "@/components/icons";
import clsx from "clsx";

export type TransactionDirectionFilter = "all" | "sent" | "received";

export interface TransactionFilters {
  direction: TransactionDirectionFilter;
  minAmount: string;
  memoSearch: string;
}

interface TransactionListProps {
  publicKey: string;
  limit?: number;
  compact?: boolean;
  filters?: TransactionFilters;
  /** Called whenever the payments array changes so the parent can access it. */
  onPaymentsChange?: (payments: PaymentRecord[]) => void;
  /** Called when the user wants to print a receipt for a payment. */
  onPrintReceipt?: (payment: PaymentRecord) => void;
  /** Optional single incoming payment to prepend in real-time. */
  incomingPayment?: PaymentRecord | null;
  onSendAgain?: (to: string, amount: string) => void;
}

interface CachedPaymentHistory {
  records: PaymentRecord[];
  hasMore: boolean;
  nextCursor?: string;
  savedAt: number;
}

const PAYMENT_HISTORY_CACHE_PREFIX = "stellar-micropay:offline-payments:";

function getPaymentHistoryCacheKey(publicKey: string, limit: number) {
  return `${PAYMENT_HISTORY_CACHE_PREFIX}${publicKey}:${limit}`;
}

function loadCachedPaymentHistory(
  publicKey: string,
  limit: number
): CachedPaymentHistory | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(getPaymentHistoryCacheKey(publicKey, limit));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPaymentHistory;
    if (!Array.isArray(parsed.records) || typeof parsed.savedAt !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function savePaymentHistorySnapshot(
  publicKey: string,
  limit: number,
  snapshot: Omit<CachedPaymentHistory, "savedAt">
) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(
    getPaymentHistoryCacheKey(publicKey, limit),
    JSON.stringify({ ...snapshot, savedAt: Date.now() })
  );
}

function formatSnapshotTime(savedAt: number) {
  return new Date(savedAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function filterPayments(
  payments: PaymentRecord[],
  filters: TransactionFilters
): PaymentRecord[] {
  const minimumAmount =
    filters.minAmount.trim() === "" ? null : Number(filters.minAmount);
  const hasMinimumAmount =
    minimumAmount !== null && Number.isFinite(minimumAmount) && minimumAmount >= 0;
  const memoQuery = filters.memoSearch.trim().toLowerCase();

  return payments.filter((payment) => {
    const matchesDirection =
      filters.direction === "all" || payment.type === filters.direction;
    const matchesAmount =
      !hasMinimumAmount || Number(payment.amount) >= (minimumAmount ?? 0);
    const matchesMemo =
      !memoQuery ||
      (payment.memo && payment.memo.toLowerCase().includes(memoQuery));

    return matchesDirection && matchesAmount && matchesMemo;
  });
}

export default function TransactionList({
  publicKey,
  limit = 20,
  compact = false,
  filters = { direction: "all", minAmount: "", memoSearch: "" },
  onPaymentsChange,
  onPrintReceipt,
  incomingPayment,
}: TransactionListProps) {
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [stalePaymentsAt, setStalePaymentsAt] = useState<number | null>(null);
  const router = useRouter();

  // Sentinel ref for IntersectionObserver — defer initial fetch until visible
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const updatePayments = useCallback(
    (next: PaymentRecord[]) => {
      setPayments(next);
      onPaymentsChange?.(next);
    },
    [onPaymentsChange]
  );

  const fetchPayments = useCallback(
    async (isLoadMore = false) => {
      if (isLoadMore) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        updatePayments([]);
        setNextCursor(undefined);
        setHasMore(true);
      }
      setError(null);
      try {
        const data: PaymentHistoryResponse = await getPaymentHistory(
          publicKey,
          limit,
          isLoadMore ? nextCursor : undefined
        );

        if (isLoadMore) {
          setPayments((prev) => {
            const merged = [...prev, ...data.records];
            onPaymentsChange?.(merged);
            savePaymentHistorySnapshot(publicKey, limit, {
              records: merged,
              hasMore: data.hasMore,
              nextCursor: data.nextCursor,
            });
            return merged;
          });
        } else {
          updatePayments(data.records);
          savePaymentHistorySnapshot(publicKey, limit, {
            records: data.records,
            hasMore: data.hasMore,
            nextCursor: data.nextCursor,
          });
        }

        setHasMore(data.hasMore);
        setNextCursor(data.nextCursor);
        setStalePaymentsAt(null);
      } catch (err) {
        const cached = !isLoadMore
          ? loadCachedPaymentHistory(publicKey, limit)
          : null;
        if (cached) {
          updatePayments(cached.records);
          setHasMore(cached.hasMore);
          setNextCursor(cached.nextCursor);
          setStalePaymentsAt(cached.savedAt);
          setError(null);
          return;
        }

        setError("Could not load transaction history.");
        console.error(err);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [publicKey, limit, nextCursor, updatePayments, onPaymentsChange]
  );

  useEffect(() => {
    if (!isVisible) return;
    fetchPayments();
  }, [fetchPayments, isVisible]);

  const handleLoadMore = () => fetchPayments(true);

  const handleCopy = async (text: string, id: string) => {
    await copyToClipboard(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Prepend a newly streamed payment if it doesn't already exist
  useEffect(() => {
    if (!incomingPayment) return;

    setPayments((prev) => {
      const exists = prev.some((p) => p.id === incomingPayment.id);
      if (exists) return prev;
      const next = [incomingPayment, ...prev];
      onPaymentsChange?.(next);
      return next;
    });
  }, [incomingPayment, onPaymentsChange]);

  const visiblePayments = filterPayments(payments, filters);
  const hasActiveFilters =
    filters.direction !== "all" || filters.minAmount.trim() !== "" || filters.memoSearch.trim() !== "";

  if (loading) {
    return (
      <div ref={containerRef} className={compact ? "" : "card"}>
        {!compact && (
          <div className="flex items-center justify-between mb-6">
            <div className="h-5 w-36 rounded-lg bg-cosmos-700 animate-pulse" />
            <div className="h-4 w-14 rounded-lg bg-cosmos-700 animate-pulse" />
          </div>
        )}
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 p-3 rounded-xl bg-cosmos-800"
            >
              <div className="w-10 h-10 rounded-full bg-cosmos-700 animate-pulse flex-shrink-0" />
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-14 rounded bg-cosmos-700 animate-pulse" />
                  <div className="h-5 w-28 rounded-lg bg-cosmos-700 animate-pulse" />
                </div>
                <div className="h-2.5 w-20 rounded bg-cosmos-700/70 animate-pulse" />
              </div>
              <div className="flex-shrink-0 h-4 w-20 rounded bg-cosmos-700 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div ref={containerRef} className={compact ? "" : "card"}>
        <div className="text-center py-8">
          <p className="text-red-400 text-sm mb-3">{error}</p>
          <button
            onClick={() => fetchPayments()}
            className="btn-secondary text-sm py-2 px-4"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (payments.length === 0) {
    if (compact) return null;
    return (
      <div ref={containerRef} className="card">
        <div className="text-center py-12">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-white/5 flex items-center justify-center">
            <HistoryIcon className="w-6 h-6 text-slate-500" />
          </div>
          <p className="text-slate-400 text-sm">No transactions yet</p>
          <p className="text-slate-600 text-xs mt-1">
            Send your first payment to get started
          </p>
          {process.env.NEXT_PUBLIC_STELLAR_NETWORK !== "mainnet" && (
            <p className="text-xs mt-3">
              Need test XLM?{" "}
              <a
                href={`https://friendbot.stellar.org/?addr=${publicKey}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-stellar-400 hover:underline"
              >
                Fund this account with Friendbot
              </a>
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={compact ? "" : "card"}>
          {!compact && (
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-display text-lg font-semibold text-white flex items-center gap-2">
                <HistoryIcon className="w-5 h-5 text-stellar-400" />
                Recent Payments
              </h2>
              <button
                onClick={() => fetchPayments()}
                className="text-xs text-slate-500 hover:text-stellar-400 transition-colors flex items-center gap-1"
              >
                <RefreshIcon className="w-3.5 h-3.5" />
                Refresh
              </button>
            </div>
          )}

          {stalePaymentsAt && (
            <div className="mb-4 inline-flex items-center rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-200">
              Offline history snapshot from {formatSnapshotTime(stalePaymentsAt)}
            </div>
          )}
          
          <div className="mb-4 flex items-center gap-3 text-xs text-stellar-400">
            <span className="w-1 h-1 rounded-full bg-stellar-400 flex-shrink-0" />
            <span>Keyboard navigation: ↑ ↓ to navigate, Enter to copy address</span>
          </div>
          
          <div
            role="list"
            aria-label="Payment history"
            className="space-y-2"
          >
        {visiblePayments.map((tx, index) => (
          <div
            key={tx.id}
            role="listitem"
            tabIndex={focusedIndex === index ? 0 : -1}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setFocusedIndex((prev) => Math.min(prev + 1, visiblePayments.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setFocusedIndex((prev) => Math.max(prev - 1, 0));
              } else if (e.key === 'Enter' && focusedIndex === index) {
                e.preventDefault();
                const address = tx.type === "sent" ? tx.to : tx.from;
                copyToClipboard(address);
                setCopiedId(tx.id);
                setTimeout(() => setCopiedId(null), 2000);
              }
            }}
            onBlur={() => setFocusedIndex(-1)}
            onFocus={() => setFocusedIndex(index)}
            className={clsx(
              "flex items-center gap-3 p-3 rounded-xl bg-white/3 hover:bg-white/5 transition-colors group relative",
              focusedIndex === index && "outline-none ring-2 ring-stellar-500 ring-offset-2"
            )}
            aria-label={`${tx.type === "sent" ? "Sent" : "Received"} ${formatAsset(tx.amount, tx.asset)} ${tx.type === "sent" ? "to" : "from"} ${tx.type === "sent" ? tx.to : tx.from}`}
          >
            {/* Direction icon */}
            <div
              className={clsx(
                "w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0",
                tx.type === "sent"
                  ? "bg-red-500/10 border border-red-500/20"
                  : "bg-emerald-500/10 border border-emerald-500/20"
              )}
            >
              {tx.type === "sent" ? (
                <ArrowUpIcon className="w-4 h-4 text-red-400" />
              ) : (
                <ArrowDownIcon className="w-4 h-4 text-emerald-400" />
              )}
            </div>

            {/* Details */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-200 capitalize">
                  {tx.type === "sent" ? "Sent to" : "Received from"}
                </span>
                <button
                  onClick={() =>
                    handleCopy(
                      tx.type === "sent" ? tx.to : tx.from,
                      tx.id
                    )
                  }
                  aria-label={`Copy ${tx.type === "sent" ? "recipient" : "sender"} address`}
                  className="address-pill hover:border-stellar-500/40 transition-colors text-xs"
                >
                  {copiedId === tx.id
                    ? "Copied!"
                    : shortenAddress(tx.type === "sent" ? tx.to : tx.from, 5)}
                </button>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-slate-500">
                  {timeAgo(tx.createdAt)}
                </span>
                {tx.memo && (
                  <span className="text-xs text-slate-600 truncate max-w-32">
                    · &ldquo;{tx.memo}&rdquo;
                  </span>
                )}
              </div>
            </div>

            {/* Amount + link */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <span
                className={clsx(
                  "text-sm font-mono font-medium",
                  tx.type === "sent" ? "text-red-400" : "text-emerald-400"
                )}
              >
                {tx.type === "sent" ? "-" : "+"}
                {formatAsset(tx.amount, tx.asset)}
              </span>

              {/* Send Again — only for sent transactions */}
              {tx.type === "sent" && (
                <button
                  onClick={() =>
                    router.push(`/dashboard?to=${encodeURIComponent(tx.to)}&amount=${encodeURIComponent(tx.amount)}`)
                  }
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-stellar-400 hover:text-stellar-300 font-medium whitespace-nowrap"
                  title="Pre-fill send form with this transaction"
                  aria-label="Send again to this recipient"
                >
                  Send again
                </button>
              )}
              
              <a
                href={explorerUrl(tx.transactionHash) ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-stellar-400"
                title="View on Stellar Expert"
                aria-label="View transaction on Stellar Expert"
              >
                <ExternalLinkIcon className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        ))}

        {/* Load more */}
        {hasMore && payments.length > 0 && (
          <div className="flex justify-center mt-4">
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="btn-secondary text-sm py-2 px-6 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loadingMore ? (
                <>
                  <div className="w-4 h-4 border-2 border-stellar-400 border-t-transparent rounded-full animate-spin" />
                  Loading...
                </>
              ) : (
                hasActiveFilters ? "Load more results" : "Load more"
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

