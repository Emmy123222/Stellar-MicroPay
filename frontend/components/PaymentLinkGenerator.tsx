import React, { useState, useEffect } from "react";
import clsx from "clsx";
import { QRCodeSVG } from "qrcode.react"; // Ensure this is installed
import {
  buildPaymentLinkUrl,
  rememberPaymentLink,
  listPaymentLinks,
  PaymentLinkRecord,
} from "@/lib/paymentLinks";

/**
 * Live "time remaining" badge for a link's expiry (#614). Returns null when
 * the link never expires — callers should render nothing in that case.
 */
function formatExpiryCountdown(
  validUntil: number | null | undefined,
  now: number
): { label: string; expired: boolean; urgent: boolean } | null {
  if (validUntil == null) return null;

  const diffMs = validUntil - now;
  if (diffMs <= 0) {
    return { label: "Expired", expired: true, urgent: false };
  }

  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  let label: string;
  if (days > 0) {
    label = `Expires in ${days}d ${hours}h`;
  } else if (hours > 0) {
    label = `Expires in ${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    label = `Expires in ${minutes}m ${seconds}s`;
  } else {
    label = `Expires in ${seconds}s`;
  }

  return { label, expired: false, urgent: totalSeconds < 3600 };
}

function ExpiryBadge({ validUntil, now }: { validUntil: number | null | undefined; now: number }) {
  const countdown = formatExpiryCountdown(validUntil, now);
  if (!countdown) return null;

  const tone = countdown.expired
    ? "bg-red-500/10 text-red-400 border-red-500/20"
    : countdown.urgent
      ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
      : "bg-slate-500/10 text-slate-300 border-slate-500/20";

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide border",
        tone
      )}
    >
      {countdown.label}
    </span>
  );
}

export default function PaymentLinkGenerator() {
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [expiry, setExpiry] = useState("never"); // New: Expiry state
  const [generatedLink, setGeneratedLink] = useState("");
  const [generatedValidUntil, setGeneratedValidUntil] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false); // New: QR Toggle

  // Link history state
  const [linkHistory, setLinkHistory] = useState<PaymentLinkRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "expired">("all");
  const [sortBy, setSortBy] = useState<"date" | "amount">("date");

  // Ticks once a second so expiry badges (#614) count down live.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const handleGenerate = () => {
    if (!destination || !amount) return;

    // Calculate expiry timestamp
    let validUntil: number | null = null;
    const generatedAt = Date.now();
    if (expiry === "24h") validUntil = generatedAt + 24 * 60 * 60 * 1000;
    if (expiry === "7d") validUntil = generatedAt + 7 * 24 * 60 * 60 * 1000;

    const paymentData = {
      destination: destination.trim(),
      amount: amount.toString(),
      memo: memo.trim() || undefined,
      validUntil, // Requirement: Expiry encoding
      // Bind the link to the active Stellar network so it can never be paid
      // on a different network (#749).
      network: NETWORK,
    };

    const url = buildPaymentLinkUrl(window.location.origin, paymentData);
    // Track the link locally so the issuer can see pending/redeemed/expired
    // status and the pay page can block reuse after redemption (#157).
    rememberPaymentLink(paymentData, url);
    setGeneratedLink(url);
    setGeneratedValidUntil(validUntil);
    setCopied(false);
    // Refresh link history
    setLinkHistory(listPaymentLinks());
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(generatedLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy!", err);
    }
  };

  // Load link history when shown, and keep statuses fresh as the countdown
  // ticks so links flip from pending to expired live (#614).
  useEffect(() => {
    if (showHistory) {
      setLinkHistory(listPaymentLinks());
    }
  }, [showHistory, now]);

  // Filter and sort link history
  const filteredHistory = linkHistory
    .filter((link) => {
      if (filterStatus === "all") return true;
      if (filterStatus === "active") return link.status === "pending" || link.status === "redeemed";
      if (filterStatus === "expired") return link.status === "expired";
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "date") {
        return b.createdAt - a.createdAt; // Newest first
      }
      if (sortBy === "amount") {
        const amountA = parseFloat(a.payload.amount);
        const amountB = parseFloat(b.payload.amount);
        return amountB - amountA; // Highest amount first
      }
      return 0;
    });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "text-amber-400";
      case "redeemed":
        return "text-green-400";
      case "expired":
        return "text-red-400";
      default:
        return "text-slate-400";
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="card animate-fade-in border-stellar-400/20">
      <h2 className="font-display text-lg font-semibold text-white mb-6 flex items-center gap-2">
        <LinkIcon className="w-5 h-5 text-stellar-400" />
        Create Payment Link
      </h2>

      <div className="space-y-4">
        <div>
          <label className="label">Recipient Address</label>
          <input
            type="text"
            className="input-field"
            placeholder="G..."
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Amount (XLM)</label>
            <input
              type="number"
              className="input-field"
              placeholder="1.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Memo (Optional)</label>
            <input
              type="text"
              className="input-field"
              placeholder="ID: 123"
              maxLength={28}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </div>
        </div>

        {/* New: Expiry Dropdown */}
        <div>
          <label className="label">Link Expiry</label>
          <select
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            className="input-field bg-cosmos-950 border-stellar-400/20 text-slate-300"
          >
            <option value="never">Never Expire</option>
            <option value="24h">24 Hours</option>
            <option value="7d">7 Days</option>
          </select>
        </div>

        <button
          onClick={handleGenerate}
          disabled={!destination || !amount}
          className="btn-primary w-full py-2.5"
        >
          Create payment link
        </button>

        {generatedLink && (
          <div className="mt-4 p-4 rounded-xl bg-stellar-400/5 border border-stellar-400/20 animate-slide-up">
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-2">
                <p className="text-[10px] uppercase tracking-wider text-stellar-400 font-bold">
                  Generated URL
                </p>
                <ExpiryBadge validUntil={generatedValidUntil} now={now} />
              </div>
              <button
                onClick={() => setShowQR(!showQR)}
                className="text-[10px] text-slate-400 hover:text-white underline"
              >
                {showQR ? "Hide QR" : "Show QR"}
              </button>
            </div>

            <div className="flex gap-2">
              <input
                readOnly
                value={generatedLink}
                className="bg-black/40 border-none text-xs text-slate-300 w-full rounded p-2 focus:ring-0"
              />
              <button
                onClick={copyToClipboard}
                className={clsx(
                  "px-3 rounded font-medium text-xs transition-all shrink-0",
                  copied
                    ? "bg-emerald-500 text-white"
                    : "bg-stellar-400 text-black hover:bg-stellar-300"
                )}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>

            {/* New: Inline QR Code Display */}
            {showQR && (
              <div className="mt-4 flex flex-col items-center bg-white p-3 rounded-lg mx-auto w-fit">
                <QRCodeSVG value={generatedLink} size={140} />
                <p className="text-[10px] text-black font-bold mt-2">Scan to Pay</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Link History Section */}
      <div className="mt-6 pt-6 border-t border-white/10">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="text-sm text-stellar-400 hover:text-stellar-300 transition-colors flex items-center gap-2"
        >
          <HistoryIcon className="w-4 h-4" />
          {showHistory ? "Hide" : "Show"} Link History ({linkHistory.length})
        </button>

        {showHistory && (
          <div className="mt-4 space-y-3">
            {/* Filter and Sort Controls */}
            <div className="flex flex-wrap gap-3 items-center">
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-400">Filter:</label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as "all" | "active" | "expired")}
                  className="input-field text-xs py-1.5 px-2"
                >
                  <option value="all">All</option>
                  <option value="active">Active</option>
                  <option value="expired">Expired</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-400">Sort by:</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as "date" | "amount")}
                  className="input-field text-xs py-1.5 px-2"
                >
                  <option value="date">Date</option>
                  <option value="amount">Amount</option>
                </select>
              </div>
            </div>

            {/* Link List */}
            {filteredHistory.length === 0 ? (
              <p className="text-sm text-slate-500">No links found.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {filteredHistory.map((link) => (
                  <div
                    key={link.id}
                    className={clsx(
                      "rounded-lg border p-3 text-sm transition-opacity",
                      link.status === "expired"
                        ? "bg-white/[0.02] border-red-500/10 opacity-60"
                        : "bg-white/5 border-white/10"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span
                            className={clsx(
                              "text-xs font-semibold uppercase",
                              getStatusColor(link.status)
                            )}
                          >
                            {link.status}
                          </span>
                          <span className="text-xs text-slate-500">
                            {formatDate(link.createdAt)}
                          </span>
                          <ExpiryBadge validUntil={link.payload.validUntil} now={now} />
                        </div>
                        <p
                          className={clsx(
                            "text-slate-300 font-semibold",
                            link.status === "expired" && "line-through decoration-slate-500"
                          )}
                        >
                          {link.payload.amount} XLM
                        </p>
                        <p className="text-xs text-slate-400 font-mono truncate">
                          {link.payload.destination.slice(0, 8)}…
                          {link.payload.destination.slice(-6)}
                        </p>
                        {link.payload.memo && (
                          <p className="text-xs text-slate-500 mt-0.5">Memo: {link.payload.memo}</p>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(link.url);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                        className="text-xs text-stellar-400 hover:text-stellar-300 transition-colors flex-shrink-0"
                      >
                        {copied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    {link.redeemedTxHash && (
                      <p className="text-xs text-green-400 mt-1">
                        Redeemed: {link.redeemedTxHash.slice(0, 8)}…
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function LinkIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
      />
    </svg>
  );
}

function HistoryIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}
