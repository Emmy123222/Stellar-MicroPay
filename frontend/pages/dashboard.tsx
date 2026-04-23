/**
 * pages/dashboard.tsx
 * Dashboard with wallet summary, payment stats, payment actions, and recent activity.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import PaymentRequestGenerator from "@/components/PaymentRequestGenerator";
import WalletConnect from "@/components/WalletConnect";
import SendPaymentForm from "@/components/SendPaymentForm";
import TransactionList from "@/components/TransactionList";
import Toast from "@/components/Toast";
import QRCodeModal from "@/components/QRCodeModal";
import {
  getXLMBalance,
  getUSDCBalance,
  fundWithFriendbot,
  ACCOUNT_NOT_FOUND_ERROR,
  streamPayments,
  PaymentRecord,
} from "@/lib/stellar";
import { formatUSD, copyToClipboard } from "@/utils/format";
import { useToast } from "@/lib/useToast";

interface DashboardProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

interface PaymentStats {
  publicKey: string;
  totalSentXLM: string;
  totalReceivedXLM: string;
  sentCount: number;
  receivedCount: number;
  totalTransactions: number;
}

export default function Dashboard({ publicKey, onConnect }: DashboardProps) {
  const [xlmBalance, setXlmBalance]   = useState<string | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [xlmPrice, setXlmPrice] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const { visible: toastVisible, message: toastMessage, showToast } = useToast();
  const [showQRModal, setShowQRModal] = useState(false);

  const isTestnet = process.env.NEXT_PUBLIC_STELLAR_NETWORK !== "mainnet";
  const [accountNotFound, setAccountNotFound] = useState(false);
  const [friendbotLoading, setFriendbotLoading] = useState(false);
  const [paymentStats, setPaymentStats] = useState<PaymentStats | null>(null);
  const [paymentStatsLoading, setPaymentStatsLoading] = useState(false);
  const [paymentStatsError, setPaymentStatsError] = useState<string | null>(null);
  const [incomingPayment, setIncomingPayment] = useState<PaymentRecord | null>(null);

  const fetchBalance = useCallback(async () => {
    if (!publicKey) return;

    setBalanceLoading(true);
    setAccountNotFound(false);

    try {
      const [bal, usdc] = await Promise.all([
        getXLMBalance(publicKey),
        getUSDCBalance(publicKey),
      ]);
      setXlmBalance(bal);
      setUsdcBalance(usdc);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (
        msg === ACCOUNT_NOT_FOUND_ERROR ||
        msg.includes("404") ||
        msg.toLowerCase().includes("not found")
      ) {
        setAccountNotFound(true);
      }
      setXlmBalance(null);
    } finally {
      setBalanceLoading(false);
    }
  }, [publicKey]);

  const fetchPaymentStats = useCallback(async () => {
    if (!publicKey) return;

    const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";

    setPaymentStatsLoading(true);
    setPaymentStatsError(null);

    try {
      const response = await fetch(
        `${apiBase}/api/payments/${encodeURIComponent(publicKey)}/stats`
      );

      if (!response.ok) {
        throw new Error("Unable to load payment stats right now.");
      }

      const payload = await response.json();
      const data = payload?.data;

      if (
        !payload?.success ||
        !data ||
        typeof data.totalSentXLM !== "string" ||
        typeof data.totalReceivedXLM !== "string" ||
        typeof data.totalTransactions !== "number"
      ) {
        throw new Error("Payment stats response was invalid.");
      }

      setPaymentStats({
        publicKey: data.publicKey,
        totalSentXLM: data.totalSentXLM,
        totalReceivedXLM: data.totalReceivedXLM,
        sentCount: Number(data.sentCount ?? 0),
        receivedCount: Number(data.receivedCount ?? 0),
        totalTransactions: data.totalTransactions,
      });
    } catch {
      setPaymentStats(null);
      setPaymentStatsError("Could not load your payment stats.");
    } finally {
      setPaymentStatsLoading(false);
    }
  }, [publicKey]);

  const handleFriendbot = async () => {
    if (!publicKey) return;

    setFriendbotLoading(true);
    try {
      await fundWithFriendbot(publicKey);
      showToast("Account funded! Refreshing balance...");
      setTimeout(() => setRefreshKey((k) => k + 1), 2000);
    } catch {
      showToast("Friendbot funding failed. Please try again.");
    } finally {
      setFriendbotLoading(false);
    }
  };

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance, refreshKey]);

  useEffect(() => {
    fetchPaymentStats();
  }, [fetchPaymentStats, refreshKey]);

  useEffect(() => {
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd")
      .then((res) => res.json())
      .then((data) => setXlmPrice(data?.stellar?.usd ?? null))
      .catch(() => setXlmPrice(null));
  }, [refreshKey]);

  const handleCopyAddress = async () => {
    if (!publicKey) return;

    const ok = await copyToClipboard(publicKey);
    if (ok) showToast("Address copied!");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePaymentSuccess = () => {
    setTimeout(() => {
      setRefreshKey((k) => k + 1);
    }, 2000);
  };

  // Start real-time payment streaming for the connected wallet
  useEffect(() => {
    if (!publicKey) return;

    const unsubscribe = streamPayments(
      publicKey,
      async (payment) => {
        // Only show toast / refresh balance for incoming payments
        if (payment.type === "received") {
          showToast(`Received ${payment.amount} ${payment.asset}`);

          // Refresh XLM balance after an incoming payment
          try {
            const bal = await getXLMBalance(publicKey);
            setXlmBalance(bal);
          } catch {
            // keep previous balance on failure
          }
        }

        setIncomingPayment(payment);
      },
      (error) => {
        console.error("Dashboard payment stream error:", error);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [publicKey, showToast]);

  if (!publicKey) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 cursor-default select-none">
        <div className="text-center mb-10">
          <h1 className="font-display text-3xl font-bold text-white mb-3">Dashboard</h1>
          <p className="text-slate-400">Connect your wallet to get started</p>
        </div>
        <WalletConnect onConnect={onConnect} />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 animate-fade-in cursor-default select-none">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-white mb-1">Dashboard</h1>
        <p className="text-slate-400 text-sm">Send and receive XLM globally</p>
      </div>

      <PaymentStatsWidget
        stats={paymentStats}
        loading={paymentStatsLoading}
        error={paymentStatsError}
        onRetry={fetchPaymentStats}
      />

      <div className="card mb-8 bg-gradient-to-br from-cosmos-800 to-cosmos-900 border-stellar-500/20 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 bg-stellar-500/5 rounded-full blur-2xl pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="label mb-1">Wallet Address</p>
            <span className="font-mono text-sm text-slate-300 break-all select-text cursor-text">
              {publicKey}
            </span>
            <button
              onClick={handleCopyAddress}
              className="mt-2 text-xs text-stellar-400 hover:text-stellar-300 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              {copied ? (
                <>
                  <CheckIcon className="w-3.5 h-3.5" /> Copied!
                </>
              ) : (
                <>
                  <CopyIcon className="w-3.5 h-3.5" /> Copy address
                </>
              )}
            </button>
          </div>

          <div className="sm:text-right flex-shrink-0">
            <p className="label mb-1">XLM Balance</p>
            {balanceLoading ? (
              <div className="h-8 w-36 bg-white/10 rounded-lg animate-pulse" />
            ) : xlmBalance !== null ? (
              <div>
                <div className="font-display text-3xl font-bold text-white">
                  {parseFloat(xlmBalance).toLocaleString("en-US", {
                    maximumFractionDigits: 4,
                  })}
                  <span className="text-stellar-400 text-xl ml-2">XLM</span>
                </div>
                {xlmPrice !== null && (
                  <p className="text-sm text-slate-400 mt-0.5">
                    {formatUSD(parseFloat(xlmBalance) * xlmPrice)}
                  </p>
                )}
                <button
                  onClick={fetchBalance}
                  className="mt-1 text-xs text-slate-500 hover:text-stellar-400 transition-colors flex items-center gap-1 sm:justify-end cursor-pointer"
                >
                  <RefreshIcon className="w-3 h-3" /> Refresh
                </button>
              </div>
            ) : accountNotFound && isTestnet ? (
              <div className="sm:text-right">
                <p className="text-amber-400 text-sm mb-2">Account not funded yet</p>
                <button
                  onClick={handleFriendbot}
                  disabled={friendbotLoading}
                  className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 disabled:cursor-not-allowed text-black font-semibold text-sm py-2 px-4 rounded-lg transition-colors cursor-pointer"
                >
                  {friendbotLoading ? (
                    <>
                      <SpinnerIcon className="w-4 h-4 animate-spin" /> Funding...
                    </>
                  ) : (
                    <>
                      <DropIcon className="w-4 h-4" /> Fund Testnet Account
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div>
                <p className="text-slate-500 text-sm">Failed to load</p>
                <button
                  onClick={fetchBalance}
                  className="text-xs text-stellar-400 hover:underline cursor-pointer"
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        </div>

        {process.env.NEXT_PUBLIC_STELLAR_NETWORK !== "mainnet" && (
          <div className="mt-4 pt-4 border-t border-white/5 flex items-center gap-2 text-xs text-amber-400/80">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
            You&apos;re on <strong>Testnet</strong> � funds are not real.{" "}
            <a
              href="https://friendbot.stellar.org"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-amber-300"
            >
              Get test XLM ?
            </a>
          </div>
        )}
      </div>

      {/* USDC balance card — shown only when account has USDC trustline */}
      {usdcBalance !== null && (
        <div className="card mb-6 bg-gradient-to-br from-cosmos-800 to-cosmos-900 border-blue-500/20 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-40 h-40 bg-blue-500/5 rounded-full blur-2xl pointer-events-none" />
          <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="label mb-1">USDC Balance</p>
              <div className="font-display text-3xl font-bold text-white">
                {parseFloat(usdcBalance).toLocaleString("en-US", { maximumFractionDigits: 4 })}
                <span className="text-blue-400 text-xl ml-2">USDC</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <SendPaymentForm
            key={refreshKey}
            publicKey={publicKey}
            xlmBalance={xlmBalance || "0"}
            usdcBalance={usdcBalance}
            onSuccess={handlePaymentSuccess}
          />
        </div>

        <div className="lg:col-span-1">
          <PaymentRequestGenerator />
        </div>

        <div className="lg:col-span-1">
          <div className="card h-full">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-lg font-semibold text-white flex items-center gap-2">
                <HistoryIcon className="w-5 h-5 text-stellar-400" />
                Recent Activity
              </h2>
              <Link
                href="/transactions"
                className="text-xs text-stellar-400 hover:text-stellar-300 transition-colors cursor-pointer"
              >
                View all ?
              </Link>
            </div>
            <TransactionList key={refreshKey} publicKey={publicKey} limit={5} compact />
          </div>
        </div>
      </div>

      <Toast message={toastMessage} visible={toastVisible} />
      <QRCodeModal
        isOpen={showQRModal}
        onClose={() => setShowQRModal(false)}
        publicKey={publicKey}
      />
    </div>
  );
}

function PaymentStatsWidget({
  stats,
  loading,
  error,
  onRetry,
}: {
  stats: PaymentStats | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <section
        className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6"
        aria-label="Payment stats loading"
      >
        <span className="sr-only">Loading payment stats</span>
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="card border-white/10 bg-white/[0.03] animate-pulse"
          >
            <div className="h-3 w-24 rounded bg-white/10 mb-3" />
            <div className="h-8 w-32 rounded bg-white/10 mb-2" />
            <div className="h-3 w-20 rounded bg-white/10" />
          </div>
        ))}
      </section>
    );
  }

  if (error) {
    return (
      <section className="card mb-6 border-red-500/20 bg-red-500/5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-white">Payment summary</p>
            <p className="text-sm text-red-300">{error}</p>
          </div>
          <button onClick={onRetry} className="btn-secondary text-sm px-4 py-2">
            Retry
          </button>
        </div>
      </section>
    );
  }

  if (!stats) return null;

  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
      <StatsCard
        label="Total Sent"
        value={formatStatsXLM(stats.totalSentXLM)}
        helper={`${stats.sentCount} outgoing payment${stats.sentCount === 1 ? "" : "s"}`}
      />
      <StatsCard
        label="Total Received"
        value={formatStatsXLM(stats.totalReceivedXLM, "received")}
        helper={`${stats.receivedCount} incoming payment${stats.receivedCount === 1 ? "" : "s"}`}
      />
      <StatsCard
        label="Transactions"
        value={stats.totalTransactions.toLocaleString("en-US")}
        helper="Across sent and received activity"
      />
    </section>
  );
}

function StatsCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="card border-white/10 bg-white/[0.03]">
      <p className="label mb-2">{label}</p>
      <p className="font-display text-2xl font-bold text-white">{value}</p>
      <p className="text-xs text-slate-400 mt-2">{helper}</p>
    </div>
  );
}

function formatStatsXLM(amount: string, suffix = "sent") {
  const value = parseFloat(amount);

  if (Number.isNaN(value)) return `0.00 XLM ${suffix}`;

  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
  })} XLM ${suffix}`;
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 6v6m0 0v6m0-6h6m-6 0H6"
      />
    </svg>
  );
}

function DropIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.183.394l-1.154.908a2.4 2.4 0 00-.33 3.58 2.4 2.4 0 003.58-.33l.908-1.154a2 2 0 01.394-1.183L9.12 16.5a2 2 0 00.517-3.86l-.158-.318a6 6 0 01.517-3.86l.477-2.387a2 2 0 01.547-1.022l1.09-1.09a2.4 2.4 0 013.394 0 2.4 2.4 0 010 3.394l-1.09 1.09z"
      />
    </svg>
  );
}

function HistoryIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}
