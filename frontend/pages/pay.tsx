/**
 * pages/pay.tsx
 * The landing page for shareable payment links.
 * Decodes Base64 data and pre-fills the SendPaymentForm.
 */
import { useRouter } from "next/router";
import { useState, useEffect } from "react";
import SendPaymentForm from "@/components/SendPaymentForm";
import WalletConnect from "@/components/WalletConnect";
import { getXLMBalance } from "@/lib/stellar";

interface PayPageProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

export default function PayPage({ publicKey, onConnect }: PayPageProps) {
  const router = useRouter();
  const { data } = router.query;
  
  const [prefill, setPrefill] = useState(null);
  const [xlmBalance, setXlmBalance] = useState<string>("0");

  // Step 1: Decode the URL data
  useEffect(() => {
    if (data && typeof data === "string") {
      try {
        const decodedString = atob(data); // Decode Base64
        const parsedData = JSON.parse(decodedString);
        setPrefill(parsedData);
      } catch (err) {
        console.error("Invalid payment link data", err);
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

  return (
    <div className="max-w-2xl mx-auto px-4 py-16 animate-fade-in">
      <div className="text-center mb-10">
        <h1 className="font-display text-3xl font-bold text-white mb-3">
          Complete Payment
        </h1>
        <p className="text-slate-400">
          You’ve received a payment request. Connect your wallet to proceed.
        </p>
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
              // Optional: Redirect to dashboard after successful payment
              setTimeout(() => router.push('/dashboard'), 3000);
            }}
          />
        </div>
      )}
    </div>
  );
}