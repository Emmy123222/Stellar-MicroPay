/**
 * pages/dashboard.tsx
 * Updated with Issue #31 UX fixes and integrated Icons to resolve build errors.
 */
import PaymentLinkGenerator from "@/components/PaymentLinkGenerator";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import WalletConnect from "@/components/WalletConnect";
import SendPaymentForm from "@/components/SendPaymentForm";
import TransactionList from "@/components/TransactionList";
import Toast from "@/components/Toast";
import QRCodeModal from "@/components/QRCodeModal";
import { getXLMBalance, fundWithFriendbot } from "@/lib/stellar";
import { formatUSD, copyToClipboard } from "@/utils/format";
import { useToast } from "@/lib/useToast";

// Fixed: Define the missing error constant locally
const ACCOUNT_NOT_FOUND_ERROR = "Account not found";

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
  const [showQRModal, setShowQRModal] = useState(false);

  const isTestnet = process.env.NEXT_PUBLIC_STELLAR_NETWORK !== "mainnet";
  const [accountNotFound, setAccountNotFound] = useState(false);
  const [friendbotLoading, setFriendbotLoading] = useState(false);

  const fetchBalance = useCallback(async () => {
    if (!publicKey) return;
    setBalanceLoading(true);
    setAccountNotFound(false);
    try {
      const bal = await getXLMBalance(publicKey);
      setXlmBalance(bal);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("404") || msg.includes("not found")) {
        setAccountNotFound(true);
      }
      setXlmBalance(null);
    } finally {
      setBalanceLoading(false);
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

      <div className="card mb-8 bg-gradient-to-br from-cosmos-800 to-cosmos-900 border-stellar-500/20 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 bg-stellar-500/5 rounded-full blur-2xl pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="label mb-1">Wallet Address</p>
            <span className="font-mono text-sm text-slate-300 break-all select-text cursor-text">
              {publicKey}
            </span>
            <button onClick={handleCopyAddress} className="mt-2 text-xs text-stellar-400 hover:text-stellar-300 transition-colors flex items-center gap-1.5 cursor-pointer">
              {copied ? <><CheckIcon className="w-3.5 h-3.5" /> Copied!</> : <><CopyIcon className="w-3.5 h-3.5" /> Copy address</>}
            </button>
          </div>
          <div className="sm:text-right flex-shrink-0">
            <p className="label mb-1">XLM Balance</p>
            {balanceLoading ? (
              <div className="h-8 w-36 bg-white/10 rounded-lg animate-pulse" />
            ) : xlmBalance !== null ? (
              <div>
                <div className="font-display text-3xl font-bold text-white">
                  {parseFloat(xlmBalance).toLocaleString("en-US", { maximumFractionDigits: 4 })}
                  <span className="text-stellar-400 text-xl ml-2">XLM</span>
                </div>
                {xlmPrice !== null && <p className="text-sm text-slate-400 mt-0.5">{formatUSD(parseFloat(xlmBalance) * xlmPrice)}</p>}
                <button onClick={fetchBalance} className="mt-1 text-xs text-slate-500 hover:text-stellar-400 transition-colors flex items-center gap-1 sm:justify-end cursor-pointer">
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
                      <SpinnerIcon className="w-4 h-4 animate-spin" />
                      Funding...
                    </>
                  ) : (
                    <>
                      <DropIcon className="w-4 h-4" />
                      Fund Testnet Account
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div>
                <p className="text-slate-500 text-sm">Failed to load</p>
                <button onClick={fetchBalance} className="text-xs text-stellar-400 hover:underline cursor-pointer">Retry</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <SendPaymentForm
            key={refreshKey}
            publicKey={publicKey}
            xlmBalance={xlmBalance || "0"}
            onSuccess={handlePaymentSuccess}
          />
        </div>

        <div className="lg:col-span-1">
          <PaymentLinkGenerator />
        </div>

        <div className="lg:col-span-1">
          <div className="card h-full">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-lg font-semibold text-white flex items-center gap-2">
                <HistoryIcon className="w-5 h-5 text-stellar-400" />
                Recent Activity
              </h2>
              <Link href="/transactions" className="text-xs text-stellar-400 hover:text-stellar-300 transition-colors cursor-pointer">
                View all →
              </Link>
            </div>
            <TransactionList key={refreshKey} publicKey={publicKey} limit={5} compact />
          </div>
        </div>
      </div>

      <Toast message={toastMessage} visible={toastVisible} />
      <QRCodeModal isOpen={showQRModal} onClose={() => setShowQRModal(false)} publicKey={publicKey} />
    </div>
  );
}

// ─── ICON COMPONENTS ─────────────────────────────────────────────────────────

function CheckIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>;
}

function CopyIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>;
}

function RefreshIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>;
}

function SpinnerIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>;
}

function DropIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.183.394l-1.154.908a2.4 2.4 0 00-.33 3.58 2.4 2.4 0 003.58-.33l.908-1.154a2 2 0 01.394-1.183L9.12 16.5a2 2 0 00.517-3.86l-.158-.318a6 6 0 01.517-3.86l.477-2.387a2 2 0 01.547-1.022l1.09-1.09a2.4 2.4 0 013.394 0 2.4 2.4 0 010 3.394l-1.09 1.09z" /></svg>;
}

function HistoryIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
}