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
import { formatAsset, timeAgo, copyToClipboard, exportFilteredTransactionsToCSV } from "@/utils/format";
import { loadAllPaymentNotes, savePaymentNote } from "@/lib/usePaymentNotes";
import { useToast } from "@/lib/useToast";
import Toast from "@/components/Toast";
import clsx from "clsx";
import { AssetBadge } from "@/components/AssetBadge";

export type TransactionDirectionFilter = "all" | "sent" | "received";

export interface TransactionFilters {
  direction?: TransactionDirectionFilter;
  minAmount?: string;
  memoSearch?: string;
  searchQuery?: string;
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
  onRepeatPayment?: (payment: PaymentRecord) => void;
  hideSearchBar?: boolean;
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

export function matchesPaymentSearch(payment: PaymentRecord, rawQuery: string): boolean {
  const query = rawQuery.trim();
  if (!query) return true;

  const lowerQuery = query.toLowerCase();

  // Check amount comparison syntax: e.g. >10, >=10, <5, <=5, =10, or >10 XLM
  const compMatch = query.match(/^([><]=?|=)\s*([0-9]+(?:\.[0-9]+)?)(?:\s*(?:xlm|usdc))?$/i);
  if (compMatch) {
    const op = compMatch[1];
    const targetAmt = parseFloat(compMatch[2]);
    const amt = parseFloat(payment.amount);
    if (!isNaN(amt) && !isNaN(targetAmt)) {
      if (op === ">") return amt > targetAmt;
      if (op === ">=") return amt >= targetAmt;
      if (op === "<") return amt < targetAmt;
      if (op === "<=") return amt <= targetAmt;
      if (op === "=") return Math.abs(amt - targetAmt) < 0.0000001;
    }
  }

  // Pure numeric / formatted amount match e.g. "10", "10.5", "10 XLM"
  const numMatch = query.match(/^([0-9]+(?:\.[0-9]+)?)(?:\s*(?:xlm|usdc))?$/i);
  if (numMatch) {
    const targetAmt = parseFloat(numMatch[1]);
    const amt = parseFloat(payment.amount);
    if (!isNaN(amt) && !isNaN(targetAmt) && (amt === targetAmt || payment.amount.includes(numMatch[1]))) {
      return true;
    }
  }

  // Destination address match
  if (payment.to && payment.to.toLowerCase().includes(lowerQuery)) {
    return true;
  }

  // Source address match
  if (payment.from && payment.from.toLowerCase().includes(lowerQuery)) {
    return true;
  }

  // Memo match
  if (payment.memo && payment.memo.toLowerCase().includes(lowerQuery)) {
    return true;
  }

  // Transaction hash match
  if (payment.transactionHash && payment.transactionHash.toLowerCase().includes(lowerQuery)) {
    return true;
  }

  return false;
}

export function filterPayments(
  payments: PaymentRecord[],
  filters: TransactionFilters
): PaymentRecord[] {
  const direction = filters.direction || "all";
  const minimumAmount =
    filters.minAmount && filters.minAmount.trim() !== "" ? Number(filters.minAmount) : null;
  const hasMinimumAmount =
    minimumAmount !== null && Number.isFinite(minimumAmount) && minimumAmount >= 0;
  const memoQuery = (filters.memoSearch || "").trim().toLowerCase();
  const search = (filters.searchQuery || "").trim();

  return payments.filter((payment) => {
    const matchesDirection =
      direction === "all" || payment.type === direction;
    const matchesAmount =
      !hasMinimumAmount || Number(payment.amount) >= (minimumAmount ?? 0);
    const matchesMemo =
      !memoQuery ||
      (payment.memo && payment.memo.toLowerCase().includes(memoQuery));
    const matchesSearch = !search || matchesPaymentSearch(payment, search);

    return matchesDirection && matchesAmount && matchesMemo && matchesSearch;
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
  onSendAgain,
  onRepeatPayment,
  hideSearchBar = false,
}: TransactionListProps) {
  const router = useRouter();
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [stalePaymentsAt, setStalePaymentsAt] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Search state with 300ms debounce (#1186)
  const initialQuery = (router.query?.q as string) || filters.searchQuery || "";
  const [searchInputValue, setSearchInputValue] = useState(initialQuery);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(initialQuery);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const { visible: toastVisible, message: toastMessage, showToast } = useToast(2500);

  useEffect(() => {
    if (router.isReady && typeof router.query.q === "string") {
      setSearchInputValue(router.query.q);
      setDebouncedSearchQuery(router.query.q);
    }
  }, [router.isReady, router.query.q]);

  const handleSearchChange = (val: string) => {
    setSearchInputValue(val);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedSearchQuery(val);
      if (router.isReady) {
        const nextQuery = { ...router.query };
        if (val.trim()) {
          nextQuery.q = val.trim();
        } else {
          delete nextQuery.q;
        }
        router.replace({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true });
      }
    }, 300);
  };

  const handleRepeatPayment = (tx: PaymentRecord) => {
    const targetAddress = tx.type === "sent" ? tx.to : tx.from;
    const shortAddr = shortenAddress(targetAddress, 4);
    showToast(`Repeating payment to ${shortAddr}`);
    if (onRepeatPayment) {
      onRepeatPayment(tx);
    }
    if (onSendAgain) {
      onSendAgain(targetAddress, tx.amount);
    }
    const query: Record<string, string> = {
      to: targetAddress,
      amount: tx.amount,
    };
    if (tx.memo) {
      query.memo = tx.memo;
    }
    router.push({
      pathname: "/dashboard",
      query,
    });
  };

  // Private off-chain payment notes — Issue #1189
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [editingNoteHash, setEditingNoteHash] = useState<string | null>(null);
  const [noteInputValue, setNoteInputValue] = useState("");

  const updatePayments = useCallback(
    (next: PaymentRecord[]) => {
      setPayments(next);
      onPaymentsChange?.(next);
    },
    [onPaymentsChange]
  );

  // Load all saved notes on mount
  useEffect(() => {
    setNotes(loadAllPaymentNotes());
  }, []);

  const handleStartEditNote = (hash: string) => {
    setEditingNoteHash(hash);
    setNoteInputValue(notes[hash] ?? "");
  };

  const handleSaveNote = (hash: string) => {
    savePaymentNote(hash, noteInputValue);
    setNotes((prev) => {
      const next = { ...prev };
      if (noteInputValue.trim() === "") {
        delete next[hash];
      } else {
        next[hash] = noteInputValue.trim();
      }
      return next;
    });
    setEditingNoteHash(null);
    setNoteInputValue("");
  };

  const handleCancelEditNote = () => {
    setEditingNoteHash(null);
    setNoteInputValue("");
  };

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
    fetchPayments();
  }, [fetchPayments]);

  const handleLoadMore = useCallback(() => fetchPayments(true), [fetchPayments]);

  // Track the mobile breakpoint (<= 768px) so infinite scroll can replace
  // the pagination button on small screens while desktop keeps the button.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia("(max-width: 768px)");
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener?.("change", update);
    return () => mql.removeEventListener?.("change", update);
  }, []);

  // Infinite scroll: observe a sentinel at the bottom of the list and load the
  // next page as soon as it scrolls into view. Mobile only — desktop uses the
  // pagination button fallback below.
  useEffect(() => {
    if (!isMobile || !hasMore || loading || loadingMore) return;

    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          handleLoadMore();
        }
      },
      { rootMargin: "0px 0px 120px 0px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [isMobile, hasMore, loading, loadingMore, handleLoadMore]);

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

  const effectiveFilters: TransactionFilters = {
    ...filters,
    searchQuery: debouncedSearchQuery || filters.searchQuery || "",
  };

  const visiblePayments = filterPayments(payments, effectiveFilters);
  const hasActiveFilters =
    (filters.direction && filters.direction !== "all") ||
    (filters.minAmount && filters.minAmount.trim() !== "") ||
    (filters.memoSearch && filters.memoSearch.trim() !== "") ||
    debouncedSearchQuery.trim() !== "";

  // Issue #1046 — export exactly what is on screen: the currently filtered,
  // loaded rows (not all pages). Filename embeds a short key + today's date.
  const handleExportCsv = () => {
    if (visiblePayments.length === 0) return;
    exportFilteredTransactionsToCSV(visiblePayments, publicKey);
  };

  if (loading) {
    return (
      <div className={compact ? "" : "card"} aria-busy="true">
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
      <div className={compact ? "" : "card"}>
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
    return (
      <div className={compact ? "" : "card"}>
        <div className="text-center py-12">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-white/5 flex items-center justify-center">
            <HistoryIcon className="w-6 h-6 text-slate-500" />
          </div>
          <p className="text-slate-400 text-sm">No transactions yet</p>
          <p className="text-slate-600 text-xs mt-1">
            Send your first payment to get started
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={compact ? "" : "card"}>
      {!compact && (
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-display text-lg font-semibold text-white flex items-center gap-2">
            <HistoryIcon className="w-5 h-5 text-stellar-400" />
            Recent Payments
          </h2>
          <div className="flex items-center gap-4">
            {/* Export CSV — exports the currently filtered and loaded rows
                only (Issue #1046). Disabled while history is loading or
                when there is nothing to export. */}
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={loading || loadingMore || visiblePayments.length === 0}
              title="Export the currently filtered transactions as CSV"
              data-testid="export-csv-button"
              className={clsx(
                "text-xs transition-colors flex items-center gap-1 cursor-pointer",
                loading || loadingMore || visiblePayments.length === 0
                  ? "text-slate-600 cursor-not-allowed"
                  : "text-slate-500 hover:text-stellar-400"
              )}
            >
              <DownloadIcon className="w-3.5 h-3.5" />
              Export CSV
            </button>
            <button
              onClick={() => fetchPayments()}
              className="text-xs text-slate-500 hover:text-stellar-400 transition-colors flex items-center gap-1 cursor-pointer"
            >
              <RefreshIcon className="w-3.5 h-3.5" />
              Refresh
            </button>
          </div>
        </div>
      )}

      {/* Search Input with 300ms Debounce (#1186) */}
      {!hideSearchBar && (
        <div className="relative mb-4">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
            <SearchIcon className="w-4 h-4" />
          </div>
          <input
            type="text"
            value={searchInputValue}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search by address, memo, or amount (e.g. >10 XLM)..."
            className="input-field pl-9 pr-8 py-2 text-sm w-full bg-white/[0.04] border-white/10 rounded-xl focus:border-stellar-400"
            aria-label="Search transactions"
          />
          {searchInputValue && (
            <button
              type="button"
              onClick={() => handleSearchChange("")}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-200 cursor-pointer"
              aria-label="Clear search"
            >
              <CloseIcon className="w-3.5 h-3.5" />
            </button>
          )}
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

      <div className="space-y-2">
        {visiblePayments.length === 0 ? (
          <div className="text-center py-10 rounded-xl bg-white/[0.02] border border-white/5 my-2">
            <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-white/5 flex items-center justify-center text-slate-500">
              <SearchIcon className="w-5 h-5" />
            </div>
            <p className="text-slate-300 text-sm font-medium">No matching transactions found</p>
            <p className="text-slate-500 text-xs mt-1">Try adjusting your search query or filters</p>
            {searchInputValue && (
              <button
                type="button"
                onClick={() => handleSearchChange("")}
                className="mt-3 text-xs text-stellar-400 hover:text-stellar-300 font-medium cursor-pointer"
              >
                Clear search
              </button>
            )}
          </div>
        ) : (
          visiblePayments.map((tx, index) => {
            const targetAddress = tx.type === "sent" ? tx.to : tx.from;
            return (
              <div
                key={tx.id}
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
                      type="button"
                      onClick={() =>
                        handleCopy(
                          tx.type === "sent" ? tx.to : tx.from,
                          tx.id
                        )
                      }
                      aria-label={`Copy ${tx.type === "sent" ? "recipient" : "sender"} address`}
                      className="address-pill hover:border-stellar-500/40 transition-colors text-xs cursor-pointer"
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

                  {/* Private note display (Issue #1189) */}
                  {notes[tx.transactionHash] && editingNoteHash !== tx.transactionHash && (
                    <p className="text-xs italic text-slate-500 mt-0.5 truncate max-w-xs">
                      📝 {notes[tx.transactionHash]}
                    </p>
                  )}

                  {/* Inline note editor */}
                  {editingNoteHash === tx.transactionHash && (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <input
                        type="text"
                        value={noteInputValue}
                        onChange={(e) => setNoteInputValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveNote(tx.transactionHash);
                          if (e.key === "Escape") handleCancelEditNote();
                        }}
                        placeholder="Private note (local only)…"
                        maxLength={200}
                        autoFocus
                        className="flex-1 text-xs bg-white/5 border border-white/10 rounded-md px-2 py-1 text-slate-300 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-stellar-500/40"
                      />
                      <button
                        onClick={() => handleSaveNote(tx.transactionHash)}
                        className="text-xs text-emerald-400 hover:text-emerald-300 px-2 py-1 rounded cursor-pointer"
                      >
                        Save
                      </button>
                      <button
                        onClick={handleCancelEditNote}
                        className="text-xs text-slate-500 hover:text-slate-300 px-1 py-1 rounded cursor-pointer"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>

                {/* Amount + Repeat + Link */}
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

                  {/* Add / edit private note button - Issue #1189 */}
                  {editingNoteHash !== tx.transactionHash && (
                    <button
                      onClick={() => handleStartEditNote(tx.transactionHash)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-slate-400 hover:text-stellar-400 px-1 py-0.5 rounded cursor-pointer"
                      title={notes[tx.transactionHash] ? "Edit note" : "Add note (stored locally)"}
                      aria-label={notes[tx.transactionHash] ? "Edit note" : "Add note"}
                    >
                      {notes[tx.transactionHash] ? "✏️" : "📝"}
                    </button>
                  )}

                  {/* Repeat Payment Button (#1187) */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRepeatPayment(tx);
                    }}
                    className="inline-flex items-center gap-1 text-xs font-medium text-stellar-400 hover:text-stellar-300 bg-stellar-500/10 hover:bg-stellar-500/20 px-2 py-1 rounded transition-colors whitespace-nowrap cursor-pointer"
                    title="Repeat payment with same destination, amount, and memo"
                    aria-label={`Repeat payment to ${shortenAddress(targetAddress, 4)}`}
                  >
                    <RepeatIcon className="w-3 h-3" />
                    Repeat
                  </button>

                  <a
                    href={explorerUrl(tx.transactionHash)}
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
            );
          })
        )}

        {/* Infinite-scroll sentinel (mobile) */}
        {isMobile && hasMore && payments.length > 0 && (
          <div
            ref={sentinelRef}
            className="flex justify-center py-4"
            aria-live="polite"
            aria-label="Loading more transactions"
          >
            {loadingMore && (
              <div className="w-5 h-5 border-2 border-stellar-400 border-t-transparent rounded-full animate-spin" />
            )}
          </div>
        )}

        {/* Pagination fallback (desktop > 768px) */}
        {!isMobile && hasMore && visiblePayments.length > 0 && (
          <div className="hidden md:flex justify-center mt-4">
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="btn-secondary text-sm py-2 px-6 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
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

        {/* Privacy disclaimer for local notes — Issue #1189 */}
        {Object.keys(notes).length > 0 && (
          <p className="text-xs text-slate-600 text-center mt-4">
            📝 Notes are stored locally and only visible to you.
          </p>
        )}
      </div>

      {toastVisible && (
        <Toast
          message={toastMessage}
          type="info"
          onClose={() => {}}
        />
      )}
    </div>
  );
}

// ─── Icons ─────────────────────────────────────────────────────────────────────

function HistoryIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function ArrowUpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
    </svg>
  );
}

function ArrowDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
    </svg>
  );
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  );
}

function RepeatIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function PrinterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 9V3.75A1.75 1.75 0 018.5 2h7a1.75 1.75 0 011.75 1.75V9M7.5 18.75h9M5.25 9H18.75A2.25 2.25 0 0121 11.25v5.25a1.5 1.5 0 01-1.5 1.5h-2.25V15H6.75v3H4.5A1.5 1.5 0 013 16.5v-5.25A2.25 2.25 0 015.25 9z" />
    </svg>
  );
}
