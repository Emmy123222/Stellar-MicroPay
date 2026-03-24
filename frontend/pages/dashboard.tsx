/**
 * pages/dashboard.tsx
 * Updated to include the Payment Link Generator feature.
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
import { getXLMBalance } from "@/lib/stellar";
import { formatUSD, copyToClipboard } from "@/utils/format";
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
  const [showQRModal, setShowQRModal] = useState(false);

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
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
        <div className="text-center mb-10">
          <h1 className="font-display text-3xl font-bold text-white mb-3">Dashboard</h1>
          <p className="text-slate-400">Connect your wallet to get started</p>
        </div>
        <WalletConnect onConnect={onConnect} />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-white mb-1">Dashboard</h1>
        <p className="text-slate-400 text-sm">Send and receive XLM globally</p>
      </div>

      {/* Wallet Card */}
      <div className="card mb-8 bg-gradient-to-br from-cosmos-800 to-cosmos-900 border-stellar-500/20 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 bg-stellar-500/5 rounded-full blur-2xl pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="label mb-1">Wallet Address</p>
            <span className="font-mono text-sm text-slate-300 break-all">{publicKey}</span>
            <button onClick={handleCopyAddress} className="mt-2 text-xs text-stellar-400 hover:text-stellar-300 transition-colors flex items-center gap-1.5">
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
                <button onClick={fetchBalance} className="mt-1 text-xs text-slate-500 hover:text-stellar-400 transition-colors flex items-center gap-1 sm:justify-end">
                  <RefreshIcon className="w-3 h-3" /> Refresh
                </button>
              </div>
            ) : (
              <div>
                <p className="text-slate-500 text-sm">Failed to load</p>
                <button onClick={fetchBalance} className="text-xs text-stellar-400 hover:underline">Retry</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Three-column layout: Send, Generate Link, and History */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Column 1: Send payment */}
        <div className="lg:col-span-1">
          <SendPaymentForm
            key={refreshKey}
            publicKey={publicKey}
            xlmBalance={xlmBalance || "0"}
            onSuccess={handlePaymentSuccess}
          />
        </div>

        {/* Column 2: NEW Payment Link Generator */}
        <div className="lg:col-span-1">
          <PaymentLinkGenerator />
        </div>

        {/* Column 3: Recent transactions */}
        <div className="lg:col-span-1">
          <div className="card h-full">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-lg font-semibold text-white flex items-center gap-2">
                <HistoryIcon className="w-5 h-5 text-stellar-400" />
                Recent Activity
              </h2>
              <Link href="/transactions" className="text-xs text-stellar-400 hover:text-stellar-300 transition-colors">
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

// Icons kept as per your original file...