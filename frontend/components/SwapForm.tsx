/**
 * components/SwapForm.tsx
 * XLM ↔ USDC swap form using Stellar DEX pathPaymentStrictSend.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Asset } from "@stellar/stellar-sdk";
import {
  buildPathPaymentStrictSendTransaction,
  fetchStrictSendPaths,
  getPathPaymentReceivedAmount,
  submitTransaction,
  USDC,
  type StrictSendPathQuote,
} from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";

const DEFAULT_SLIPPAGE_BPS = 50; // 0.50%
const SLIPPAGE_OPTIONS = [25, 50, 100, 200]; // basis points

interface SwapFormProps {
  publicKey: string;
  onSwapComplete: () => void;
  onError: (error: string) => void;
  onSuccess: (message: string) => void;
}

function getAsset(code: "XLM" | "USDC"): Asset {
  return code === "XLM" ? Asset.native() : USDC;
}

function applySlippage(destinationAmount: string, slippageBps: number): string {
  const amount = parseFloat(destinationAmount);
  if (!Number.isFinite(amount) || amount <= 0) return "0";
  const min = amount * (1 - slippageBps / 10_000);
  return Math.max(0, min).toFixed(7);
}

export default function SwapForm({
  publicKey,
  onSwapComplete,
  onError,
  onSuccess,
}: SwapFormProps) {
  const [sellAsset, setSellAsset] = useState<"XLM" | "USDC">("XLM");
  const [buyAsset, setBuyAsset] = useState<"XLM" | "USDC">("USDC");
  const [sellAmount, setSellAmount] = useState("");
  const [quote, setQuote] = useState<StrictSendPathQuote | null>(null);
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const quoteRequestId = useRef(0);

  const flipAssets = () => {
    setSellAsset(buyAsset);
    setBuyAsset(sellAsset);
    setQuote(null);
  };

  const loadQuote = useCallback(async () => {
    const amountNum = parseFloat(sellAmount);
    if (!sellAmount || !Number.isFinite(amountNum) || amountNum <= 0 || sellAsset === buyAsset) {
      setQuote(null);
      setQuoteError(null);
      return;
    }

    const requestId = ++quoteRequestId.current;
    setIsQuoting(true);
    setQuoteError(null);

    try {
      const nextQuote = await fetchStrictSendPaths({
        sendAsset: getAsset(sellAsset),
        sendAmount: amountNum.toFixed(7),
        destAsset: getAsset(buyAsset),
      });

      if (requestId !== quoteRequestId.current) return;

      if (!nextQuote) {
        setQuote(null);
        setQuoteError("No DEX path found for this swap");
        return;
      }

      setQuote(nextQuote);
    } catch (err) {
      if (requestId !== quoteRequestId.current) return;
      setQuote(null);
      setQuoteError(err instanceof Error ? err.message : "Failed to fetch swap quote");
    } finally {
      if (requestId === quoteRequestId.current) {
        setIsQuoting(false);
      }
    }
  }, [buyAsset, sellAmount, sellAsset]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadQuote();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [loadQuote]);

  const destMin = quote ? applySlippage(quote.destinationAmount, slippageBps) : null;
  const canSubmit =
    Boolean(quote) &&
    Boolean(destMin) &&
    parseFloat(sellAmount) > 0 &&
    sellAsset !== buyAsset &&
    !isQuoting &&
    !isSubmitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !quote || !destMin) return;

    setIsSubmitting(true);
    try {
      const transaction = await buildPathPaymentStrictSendTransaction({
        fromPublicKey: publicKey,
        toPublicKey: publicKey,
        sendAsset: getAsset(sellAsset),
        sendAmount: parseFloat(sellAmount).toFixed(7),
        destAsset: getAsset(buyAsset),
        minDestAmount: destMin,
        path: quote.path,
      });

      const { signedXDR, error: signError } = await signTransactionWithWallet(transaction.toXDR());
      if (signError || !signedXDR) {
        throw new Error(signError || "Signing cancelled");
      }

      const result = await submitTransaction(signedXDR);
      const received = await getPathPaymentReceivedAmount(result.hash).catch(() => null);
      const receivedDisplay = received ?? quote.destinationAmount;

      onSuccess(
        `Swap successful! Received ${receivedDisplay} ${buyAsset}`
      );
      onSwapComplete();
      setSellAmount("");
      setQuote(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Swap failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="card">
      <h2 className="mb-4 font-display text-xl font-semibold text-white">Swap XLM ↔ USDC</h2>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="label" htmlFor="sell-amount">
            Sell
          </label>
          <div className="flex gap-2">
            <select
              value={sellAsset}
              onChange={(e) => {
                const next = e.target.value as "XLM" | "USDC";
                setSellAsset(next);
                if (next === buyAsset) setBuyAsset(next === "XLM" ? "USDC" : "XLM");
              }}
              className="input-field w-28"
              aria-label="Sell asset"
            >
              <option value="XLM">XLM</option>
              <option value="USDC">USDC</option>
            </select>
            <input
              id="sell-amount"
              type="number"
              step="any"
              min="0"
              value={sellAmount}
              onChange={(e) => setSellAmount(e.target.value)}
              placeholder="0.00"
              className="input-field flex-1"
            />
          </div>
        </div>

        <div className="flex justify-center">
          <button
            type="button"
            onClick={flipAssets}
            className="rounded-lg bg-stellar-500/20 p-2 transition-colors hover:bg-stellar-500/30"
            aria-label="Flip assets"
          >
            <svg className="h-5 w-5 text-stellar-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
              />
            </svg>
          </button>
        </div>

        <div>
          <label className="label" htmlFor="buy-estimate">
            Estimated buy
          </label>
          <div className="flex gap-2">
            <select
              value={buyAsset}
              onChange={(e) => {
                const next = e.target.value as "XLM" | "USDC";
                setBuyAsset(next);
                if (next === sellAsset) setSellAsset(next === "XLM" ? "USDC" : "XLM");
              }}
              className="input-field w-28"
              aria-label="Buy asset"
            >
              <option value="XLM">XLM</option>
              <option value="USDC">USDC</option>
            </select>
            <input
              id="buy-estimate"
              type="text"
              readOnly
              value={
                isQuoting
                  ? "Fetching path…"
                  : quote
                    ? quote.destinationAmount
                    : ""
              }
              placeholder="—"
              className="input-field flex-1 text-slate-300"
            />
          </div>
        </div>

        <div>
          <label className="label">Slippage tolerance</label>
          <div className="flex flex-wrap gap-2">
            {SLIPPAGE_OPTIONS.map((bps) => (
              <button
                key={bps}
                type="button"
                onClick={() => setSlippageBps(bps)}
                className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                  slippageBps === bps
                    ? "border-stellar-500/40 bg-stellar-500/20 text-stellar-300"
                    : "border-white/10 text-slate-400 hover:border-white/20"
                }`}
              >
                {(bps / 100).toFixed(2)}%
              </button>
            ))}
          </div>
        </div>

        {quote && (
          <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">Exchange rate</span>
              <span className="text-white">
                1 {sellAsset} ≈ {quote.exchangeRate.toFixed(7)} {buyAsset}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Min received ({(slippageBps / 100).toFixed(2)}% slip)</span>
              <span className="text-white">
                {destMin} {buyAsset}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Path hops</span>
              <span className="text-white">{quote.path.length}</span>
            </div>
          </div>
        )}

        {quoteError && <p className="text-sm text-red-400">{quoteError}</p>}

        <button type="submit" disabled={!canSubmit} className="btn-primary w-full">
          {isSubmitting ? "Swapping…" : `Swap ${sellAsset} → ${buyAsset}`}
        </button>
      </form>
    </div>
  );
}
