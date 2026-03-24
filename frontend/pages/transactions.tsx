/**
 * pages/transactions.tsx
 * Full transaction history page.
 */

import { useRouter } from "next/router";
import Link from "next/link";
import WalletConnect from "@/components/WalletConnect";
import TransactionList from "@/components/TransactionList";
import { shortenAddress, PaymentRecord } from "@/lib/stellar";
import { exportToCSV } from "@/utils/format";
import { useCallback, useState } from "react";
 

interface TransactionsProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

export default function Transactions({ publicKey, onConnect }: TransactionsProps) {
  const router = useRouter();

  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [exporting, setExporting] = useState(false);

  // Receives the latest payments array from the list whenever it changes
  const handlePaymentsChange = useCallback((records: PaymentRecord[]) => {
    setPayments(records);
  }, []);
  const handleExport = () => {
    if (payments.length === 0) return;
    setExporting(true);
    try {
      exportToCSV(payments);
    } finally {
      // Small delay so the button flash feels intentional
      setTimeout(() => setExporting(false), 800);
    }
  };

  if (!publicKey) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
        <div className="text-center mb-10">
          <h1 className="font-display text-3xl font-bold text-white mb-3">
            {`Transaction History`}
          </h1>
          <p className="text-slate-400">{`Connect your wallet to view your payments`}</p>
        </div>
        <WalletConnect onConnect={onConnect} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-3xl font-bold text-white mb-1">
            {`Transaction History`}
          </h1>
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <span>{`Account:`}</span>
            <span className="address-pill">{shortenAddress(publicKey)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 pt-1">
          {/* Download CSV */}
          <button
            onClick={handleExport}
            disabled={payments.length === 0 || exporting}
            title={
              payments.length === 0
                ? "No transactions to export"
                : `Export ${payments.length} transaction${payments.length !== 1 ? "s" : ""} as CSV`
            }
            className={[
              "inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg",
              "border transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stellar-400/60",
              payments.length === 0 || exporting
                ? "border-white/10 text-slate-600 cursor-not-allowed"
                : "border-stellar-500/30 text-stellar-400 hover:bg-stellar-500/10 hover:border-stellar-500/50",
            ].join(" ")}
          >
            {exporting ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-stellar-400 border-t-transparent rounded-full animate-spin" />
                {`Exporting…`}
              </>
            ) : (
              <>
                {/* Download arrow icon */}
                <svg
                  className="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                  />
                </svg>
                {`Download CSV`}
              </>
            )}
          </button>

          <Link href="/dashboard" className="btn-secondary text-sm py-2 px-4">
            {`← Dashboard`}
          </Link>
        </div>
      </div>



      {/* Export hint */}
      <div className="mb-5 p-3 rounded-xl bg-stellar-500/5 border border-stellar-500/15 flex items-center justify-between">
        <p className="text-xs text-slate-400">
          {`Showing your transaction history. Click "Load more" to view older transactions.`}
        </p>
        <a
          href={`https://stellar.expert/explorer/testnet/account/${publicKey}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-stellar-400 hover:text-stellar-300 transition-colors whitespace-nowrap ml-4"
        >
          {`Full history →`}
        </a>
      </div>

      {/* Full transaction list */}
      <TransactionList
        publicKey={publicKey}
        limit={20}
        onPaymentsChange={handlePaymentsChange}
      />
    </div>
  );
}