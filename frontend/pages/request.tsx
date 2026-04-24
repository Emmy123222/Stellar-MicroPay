import { useRouter } from "next/router";
import { useState, useEffect } from "react";
import SendPaymentForm from "@/components/SendPaymentForm";
import WalletConnect from "@/components/WalletConnect";
import { getXLMBalance } from "@/lib/stellar";

interface RequestPageProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

interface PrefillData {
  destination: string;
  amount: string;
  memo?: string;
  validUntil?: number;
}

export default function RequestPage({ publicKey, onConnect }: RequestPageProps) {
  const router = useRouter();
  const { r } = router.query;
  
  const [prefill, setPrefill] = useState<PrefillData | null>(null);
  const [xlmBalance, setXlmBalance] = useState<string>("0");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (r && typeof r === "string") {
      try {
        const decodedString = atob(r); 
        const parsedData = JSON.parse(decodedString);

        if (parsedData.validUntil && Date.now() > parsedData.validUntil) {
          setError("This payment request link has expired.");
          return;
        }

        if (!parsedData.destination || !parsedData.amount) {
          setError("The request link data is incomplete or malformed.");
          return;
        }

        setPrefill(parsedData);
        setError(null);
      } catch (err) {
        console.error("Invalid request link data", err);
        setError("Invalid request link. Please check the URL.");
      }
    }
  }, [r]);

  useEffect(() => {
    if (publicKey) {
      getXLMBalance(publicKey)
        .then(setXlmBalance)
        .catch(() => setXlmBalance("0"));
    }
  }, [publicKey]);

  if (error) {
    return (
      <div className="max-w-md mx-auto mt-20 p-8 card border-red-500/30 text-center animate-fade-in bg-cosmos-900/50">
        <div className="bg-red-500/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl text-red-500">⚠️</span>
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Request Unavailable</h2>
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
        <h1 className="font-display text-3xl font-bold text-white mb-3">Complete Request</h1>
        <p className="text-slate-400">Review the requested details and connect your wallet to pay.</p>
      </div>

      {!publicKey ? (
        <div className="card border-stellar-500/20 bg-cosmos-900/50">
          <WalletConnect onConnect={onConnect} />
        </div>
      ) : (
        <div className="animate-slide-up">
          <SendPaymentForm publicKey={publicKey} xlmBalance={xlmBalance} prefill={prefill} onSuccess={() => setTimeout(() => router.push('/transactions'), 3000)} />
        </div>
      )}
    </div>
  );
}