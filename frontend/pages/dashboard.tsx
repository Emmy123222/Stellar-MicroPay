/**
 * pages/dashboard.tsx
 * Main app dashboard: wallet info, balance, send payment form.
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import WalletConnect from "@/components/WalletConnect";
import SendPaymentForm from "@/components/SendPaymentForm";
import TransactionList from "@/components/TransactionList";
import Toast from "@/components/Toast";
import { getXLMBalance, shortenAddress } from "@/lib/stellar";
import { formatXLM, formatUSD, copyToClipboard } from "@/utils/format";
import { useToast } from "@/lib/useToast";

interface DashboardProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

export default function Dashboard({ publicKey, onConnect }: DashboardProps) {
  const router = useRouter();
  const [xlmBalance, setXlmBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [xlmPrice, setXlmPrice] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const { visible: toastVisible, message: toastMessage, showToast } = useToast();

  const fetchBalance = useCallback(async () => {
    if (!publicKey) return;
    setBalanceLoading(true);
    try {
      const bal = await getXLMBalance(publicKey);
      setXlmBalance(bal);
    } catch {
      setXlmBalance(null);
    } finally {
      setBalanceLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance, refreshKey]);

  // Fetch XLM/USD price from CoinGecko — fails silently
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
    // Refresh balance and transactions after a payment
    setTimeout(() => {
      setRefreshKey((k) => k + 1);
    }, 2000);
  };

  if (!publicKey) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
        <div className="text-center mb-10">
          <h1 className="font-display text-3xl font-bold text-white mb-3">
            Dashboard
          </h1>
          <p className="text-slate-400">Connect your wallet to get started</p>
        </div>
        <WalletConnect onConnect={onConnect} />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-white mb-1">Dashboard</h1>
        <p className="text-slate-400 text-sm">Send and receive XLM globally</p>
      </div>

      {/* Wallet card */}
      <div className="card mb-6 bg-gradient-to-br from-cosmos-800 to-cosmos-900 border-stellar-500/20 relative overflow-hidden">
        {/* Decorative glow */}
        <div className="absolute top-0 right-0 w-48 h-48 bg-stellar-500/5 rounded-full blur-2xl pointer-events-none" />

        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="label mb-1">Wallet Address</p>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-slate-300 break-all">
                {publicKey}
              </span>
            </div>
            <button
              onClick={handleCopyAddress}
              className="mt-2 text-xs text-stellar-400 hover:text-stellar-300 transition-colors flex items-center gap-1.5"
            >
              {copied ? (
                <>
                  <CheckIcon className="w-3.5 h-3.5" />
                  Copied!
                </>
              ) : (
                <>
                  <CopyIcon className="w-3.5 h-3.5" />
                  Copy address
                </>
              )}
            </button>
          </div>

          {/* Balance */}
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
                  className="mt-1 text-xs text-slate-500 hover:text-stellar-400 transition-colors flex items-center gap-1 sm:justify-end"
                >
                  <RefreshIcon className="w-3 h-3" />
                  Refresh
                </button>
              </div>
            ) : (
              <div>
                <p className="text-slate-500 text-sm">Failed to load</p>
                <button
                  onClick={fetchBalance}
                  className="text-xs text-stellar-400 hover:underline"
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Testnet warning */}
        {process.env.NEXT_PUBLIC_STELLAR_NETWORK !== "mainnet" && (
          <div className="mt-4 pt-4 border-t border-white/5 flex items-center gap-2 text-xs text-amber-400/80">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
            You&apos;re on <strong>Testnet</strong> — funds are not real.{" "}
            <a
              href="https://friendbot.stellar.org"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-amber-300"
            >
              Get test XLM →
            </a>
          </div>
        )}
      </div>

      {/* Two-column layout: send form + recent txns */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Send payment */}
        <div>
          <SendPaymentForm
            key={refreshKey}
            publicKey={publicKey}
            xlmBalance={xlmBalance || "0"}
            onSuccess={handlePaymentSuccess}
          />
        </div>

        {/* Recent transactions (compact) */}
        <div>
          <div className="card">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-lg font-semibold text-white flex items-center gap-2">
                <HistoryIcon className="w-5 h-5 text-stellar-400" />
                Recent Activity
              </h2>
              <Link
                href="/transactions"
                className="text-xs text-stellar-400 hover:text-stellar-300 transition-colors"
              >
                View all →
              </Link>
            </div>
            <TransactionList
              key={refreshKey}
              publicKey={publicKey}
              limit={5}
              compact
            />
          </div>
        </div>
      </div>
      <Toast message={toastMessage} visible={toastVisible} />
    </div>
  );
}

// ─── Icons ─────────────────────────────────────────────────────────────────────

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
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

function HistoryIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
