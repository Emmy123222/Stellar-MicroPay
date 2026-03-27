/**
 * pages/pay.tsx
 * The landing page for shareable payment links.
 * Validates expiration, handles errors, and pre-fills the payment form.
 */
import { useRouter } from "next/router";
import { useState, useEffect } from "react";
import SendPaymentForm from "@/components/SendPaymentForm";
import WalletConnect from "@/components/WalletConnect";
import { getXLMBalance, getContractTipTotal, CONTRACT_ID } from "@/lib/stellar";
import { formatStroopsToXLM } from "@/utils/format";

interface PayPageProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

interface PrefillData {
  destination: string;
  amount: string;
  memo?: string;
  validUntil?: number;
}

export default function PayPage({ publicKey, onConnect }: PayPageProps) {
  const router = useRouter();
  const { data } = router.query;
  
  const [prefill, setPrefill] = useState<PrefillData | null>(null);
  const [xlmBalance, setXlmBalance] = useState<string>("0");
  const [tipTotal, setTipTotal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null); // New: Error state

  // Step 1: Decode and Validate URL data
  useEffect(() => {
    if (data && typeof data === "string") {
      try {
        const decodedString = atob(data); 
        const parsedData = JSON.parse(decodedString);

        // Validation: Check for Expiration
        if (parsedData.validUntil && Date.now() > parsedData.validUntil) {
          setError("This payment link has expired.");
          return;
        }

        // Validation: Check for Required Fields
        if (!parsedData.destination || !parsedData.amount) {
          setError("The payment link data is incomplete or malformed.");
          return;
        }

        setPrefill(parsedData);
        setError(null); // Clear errors if valid
      } catch (err) {
        console.error("Invalid payment link data", err);
        setError("Invalid payment link. Please check the URL.");
      }
    }
  }, [data]);

  // Step 2: Fetch balance if wallet is connected
  useEffect(() => {
    if (publicKey) {
      getXLMBalance(publicKey)
        .then(setXlmBalance)
        .catch(() => setXlmBalance("0"));
    }
  }, [publicKey]);

  // Step 3: Fetch recipient's tip total
  useEffect(() => {
    if (prefill?.destination && CONTRACT_ID) {
      getContractTipTotal(prefill.destination)
        .then(setTipTotal)
        .catch(() => setTipTotal("0"));
    }
  }, [prefill?.destination]);

  // UI: Error State (Graceful Degradation)
  if (error) {
    return (
      <div className="max-w-md mx-auto mt-20 p-8 card border-red-500/30 text-center animate-fade-in bg-cosmos-900/50">
        <div className="bg-red-500/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl text-red-500">⚠️</span>
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Payment Unavailable</h2>
        <p className="text-slate-400 mb-6">{error}</p>
        <button 
          onClick={() => router.push('/dashboard')} 
          className="btn-secondary w-full py-2"
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-16 animate-fade-in">
      <div className="text-center mb-10">
        <h1 className="font-display text-3xl font-bold text-white mb-3">
          Complete Payment
        </h1>
        <p className="text-slate-400">
          {publicKey 
            ? "Review the details below to authorize the transaction." 
            : "You’ve received a payment request. Connect your wallet to proceed."}
        </p>
        
        {tipTotal !== null && CONTRACT_ID && (
          <div className="mt-4 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-stellar-500/10 border border-stellar-500/20">
            <span className="text-xs font-medium text-stellar-400">
              {`Recipient's Total Tips Recorded:`}
            </span>
            <span className="text-xs font-bold text-white">
              {formatStroopsToXLM(tipTotal)}
            </span>
          </div>
        )}
      </div>

      {!publicKey ? (
        <div className="card border-stellar-500/20 bg-cosmos-900/50">
          <WalletConnect onConnect={onConnect} />
        </div>
      ) : (
        <div className="animate-slide-up">
          <SendPaymentForm 
            publicKey={publicKey}
            xlmBalance={xlmBalance}
            prefill={prefill}
            onSuccess={() => {
              // Redirect to transactions after success
              setTimeout(() => router.push('/transactions'), 3000);
            }}
          />
        </div>
      )}
    </div>
  );
}