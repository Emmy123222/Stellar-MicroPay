/**
 * pages/multi-sig-sign.tsx
 * Page for co-signers to view and sign multi-signature transactions.
 */

import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { Transaction, TransactionBuilder, FeeBumpTransaction, Networks } from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE } from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";
import { formatXLM } from "@/utils/format";

export default function MultiSigSignPage() {
  const router = useRouter();
  const { xdr } = router.query;
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [signedXDR, setSignedXDR] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "signing" | "signed">("loading");

  useEffect(() => {
    if (!xdr || typeof xdr !== "string") return;

    try {
      const tx = TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE);
      if (tx instanceof Transaction) {
        setTransaction(tx);
      } else {
        setError("FeeBump transactions are not supported.");
      }
      setStatus("ready");
    } catch (err) {
      setError("Invalid transaction XDR");
      setStatus("ready");
    }
  }, [xdr]);

  const handleSign = async () => {
    if (!transaction) return;
    setStatus("signing");
    setError(null);
    try {
      const { signedXDR, error: signError } = await signTransactionWithWallet(transaction.toXDR());
      if (signError || !signedXDR) {
        setError(signError || "Failed to sign transaction");
        setStatus("ready");
        return;
      }
      setSignedXDR(signedXDR);
      setStatus("signed");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to sign transaction");
      setStatus("ready");
    }
  };

  if (status === "loading") {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16">
        <div className="text-center">
          <p className="text-slate-400">Loading transaction...</p>
        </div>
      </div>
    );
  }

  if (error && !transaction) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16">
        <div className="text-center">
          <p className="text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-16">
      <h1 className="font-display text-2xl font-bold text-white mb-6">Sign Multi-Signature Transaction</h1>

      {transaction && (
        <div className="card mb-6">
          <h2 className="font-display text-lg font-semibold text-white mb-4">Transaction Details</h2>
          <div className="space-y-2">
            <p><span className="text-slate-400">From:</span> {transaction.source}</p>
            {transaction.operations.map((op, i) => {
              if (op.type === "payment") {
                const payment = op as any;
                return (
                  <div key={i}>
                    <p><span className="text-slate-400">To:</span> {payment.destination}</p>
                    <p><span className="text-slate-400">Amount:</span> {formatXLM(payment.amount)} XLM</p>
                  </div>
                );
              }
              return <p key={i}>Operation {i + 1}: {op.type}</p>;
            })}
            {transaction.memo && transaction.memo.type !== "none" && (
              <p><span className="text-slate-400">Memo:</span> {transaction.memo.value?.toString()}</p>
            )}
          </div>
        </div>
      )}

      {status === "ready" && (
        <button onClick={handleSign} className="btn-primary w-full">
          Sign with Freighter
        </button>
      )}

      {status === "signing" && (
        <p className="text-center text-slate-400">Signing...</p>
      )}

      {status === "signed" && signedXDR && (
        <div className="card">
          <h2 className="font-display text-lg font-semibold text-white mb-4">Signed Transaction XDR</h2>
          <p className="text-slate-300 mb-4">
            Copy this signed XDR and send it back to the transaction initiator.
          </p>
          <textarea
            value={signedXDR}
            readOnly
            className="input h-32 font-mono text-xs"
          />
          <button
            onClick={() => navigator.clipboard.writeText(signedXDR)}
            className="btn-secondary w-full mt-4"
          >
            Copy Signed XDR
          </button>
        </div>
      )}

      {error && (
        <p className="text-red-400 text-sm mt-4">{error}</p>
      )}
    </div>
  );
}