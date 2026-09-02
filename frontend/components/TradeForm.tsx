/**
 * components/TradeForm.tsx
 * Trading form component for placing market and limit orders on Stellar DEX.
 */

import { useEffect, useState } from "react";
import { Asset } from "@stellar/stellar-sdk";
import {
  buildSellOfferTransaction,
  buildBuyOfferTransaction,
  buildPathPaymentStrictSendTransaction,
  fetchStrictSendQuote,
  submitTransaction,
  NETWORK_PASSPHRASE,
  USDC,
  walletBalanceToAsset,
  type StrictSendQuote,
} from "@/lib/stellar";
import { formatAsset } from "@/utils/format";
import { SwapIcon } from "@/components/icons";

interface TradeFormProps {
  publicKey: string;
  onTradeComplete: () => void;
  onError: (error: string) => void;
  onSuccess: (message: string) => void;
}

const getAsset = (assetType: "XLM" | "USDC"): Asset =>
  assetType === "XLM"
    ? walletBalanceToAsset({ asset: "native", balance: "0", assetCode: "XLM" })
    : USDC;

const SLIPPAGE_PRESETS = ["0.1", "0.5", "1"];
const DEFAULT_SLIPPAGE = "0.5";
const MAX_SLIPPAGE_PERCENT = 50;
const QUOTE_DEBOUNCE_MS = 400;

/**
 * The least the trade may return before it is rejected on-chain: the quoted
 * destination amount reduced by the tolerance the user accepted.
 */
function applySlippage(destinationAmount: string, slippagePercent: number): string {
  const quoted = parseFloat(destinationAmount);
  if (!Number.isFinite(quoted)) return "0";
  return Math.max(0, quoted * (1 - slippagePercent / 100)).toFixed(7);
}

export default function TradeForm({ publicKey, onTradeComplete, onError, onSuccess }: TradeFormProps) {
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [sellingAsset, setSellingAsset] = useState<"XLM" | "USDC">("XLM");
  const [buyingAsset, setBuyingAsset] = useState<"XLM" | "USDC">("USDC");
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState("");
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE);
  const [quote, setQuote] = useState<StrictSendQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const slippagePercent = parseFloat(slippage);
  const isSlippageValid =
    Number.isFinite(slippagePercent) &&
    slippagePercent >= 0 &&
    slippagePercent <= MAX_SLIPPAGE_PERCENT;

  const isTradeablePair = sellingAsset !== buyingAsset;
  const hasAmount = Boolean(amount) && parseFloat(amount) > 0;

  // Keep a live market quote so the user can see what the tolerance protects
  // them from before signing. Limit orders carry their own price instead.
  useEffect(() => {
    if (orderType !== "market" || !hasAmount || !isTradeablePair) {
      setQuote(null);
      setQuoteError(null);
      setIsQuoting(false);
      return;
    }

    let cancelled = false;
    setIsQuoting(true);

    const timer = setTimeout(async () => {
      try {
        const result = await fetchStrictSendQuote(
          getAsset(sellingAsset),
          amount,
          getAsset(buyingAsset)
        );
        if (cancelled) return;
        setQuote(result);
        setQuoteError(result ? null : "No trade path found for this pair right now.");
      } catch {
        if (cancelled) return;
        setQuote(null);
        setQuoteError("Could not fetch a price quote.");
      } finally {
        if (!cancelled) setIsQuoting(false);
      }
    }, QUOTE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [orderType, amount, hasAmount, isTradeablePair, sellingAsset, buyingAsset]);

  const minimumReceived =
    quote && isSlippageValid ? applySlippage(quote.destinationAmount, slippagePercent) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!amount || (orderType === "limit" && !price)) {
      onError("Please fill in all required fields");
      return;
    }

    if (sellingAsset === buyingAsset) {
      onError("Cannot trade the same asset");
      return;
    }

    if (orderType === "market" && !isSlippageValid) {
      onError(`Slippage tolerance must be between 0 and ${MAX_SLIPPAGE_PERCENT}%`);
      return;
    }

    setIsLoading(true);

    try {
      let transaction;
      const sellAsset = getAsset(sellingAsset);
      const buyAsset = getAsset(buyingAsset);

      if (orderType === "market") {
        // Market order: strict-send path payment, re-quoted at submit time so
        // the destination minimum reflects the current book.
        const liveQuote = await fetchStrictSendQuote(sellAsset, amount, buyAsset);
        if (!liveQuote) {
          throw new Error("No trade path available for this asset pair.");
        }

        setQuote(liveQuote);
        setQuoteError(null);

        transaction = await buildPathPaymentStrictSendTransaction({
          fromPublicKey: publicKey,
          toPublicKey: publicKey, // Self-transfer for path payment
          sendAsset: sellAsset,
          sendAmount: amount,
          destAsset: buyAsset,
          destMin: applySlippage(liveQuote.destinationAmount, slippagePercent),
          path: liveQuote.path,
        });

      } else {
        // Limit order
        if (side === "sell") {
          transaction = await buildSellOfferTransaction({
            fromPublicKey: publicKey,
            selling: sellAsset,
            buying: buyAsset,
            amount,
            price,
          });
        } else {
          transaction = await buildBuyOfferTransaction({
            fromPublicKey: publicKey,
            selling: sellAsset,
            buying: buyAsset,
            amount,
            price,
          });
        }
      }

      // Sign with Freighter
      const { signTransaction } = await import("@stellar/freighter-api");
      const signed = await signTransaction(transaction.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
      });
      if (signed.error) {
        throw new Error(signed.error.message || "Transaction signing failed");
      }

      // Submit transaction
      const result = await submitTransaction(signed.signedTxXdr);
      
      onSuccess(
        orderType === "market" 
          ? "Market order executed successfully!" 
          : `${side === "sell" ? "Sell" : "Buy"} order placed successfully!`
      );
      
      onTradeComplete();
      
      // Reset form
      setAmount("");
      setPrice("");
      setQuote(null);

    } catch (error) {
      console.error("Trade failed:", error);
      onError(error instanceof Error ? error.message : "Trade failed");
    } finally {
      setIsLoading(false);
    }
  };

  const swapAssets = () => {
    setSellingAsset(buyingAsset);
    setBuyingAsset(sellingAsset);
    setSide(side === "buy" ? "sell" : "buy");
  };

  return (
    <div className="card">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Order Type Selection */}
        <div className="flex gap-2 p-1 bg-stellar-500/10 rounded-lg">
          <button
            type="button"
            onClick={() => setOrderType("market")}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
              orderType === "market"
                ? "bg-stellar-500 text-white"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Market Order
          </button>
          <button
            type="button"
            onClick={() => setOrderType("limit")}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
              orderType === "limit"
                ? "bg-stellar-500 text-white"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Limit Order
          </button>
        </div>

        {/* Asset Selection */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              You Pay
            </label>
            <div className="flex gap-2">
              <select
                value={sellingAsset}
                onChange={(e) => setSellingAsset(e.target.value as "XLM" | "USDC")}
                className="flex-1 px-3 py-2 bg-cosmos-800 border border-stellar-500/20 rounded-lg text-white focus:outline-none focus:border-stellar-400"
              >
                <option value="XLM">XLM</option>
                <option value="USDC">USDC</option>
              </select>
              <input
                type="number"
                step="any"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="flex-1 px-3 py-2 bg-cosmos-800 border border-stellar-500/20 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-stellar-400"
              />
            </div>
          </div>

          {/* Swap Button */}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={swapAssets}
              className="p-2 rounded-lg bg-stellar-500/20 hover:bg-stellar-500/30 transition-colors"
            >
              <SwapIcon className="w-5 h-5 text-stellar-400" />
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              You Receive
            </label>
            <div className="flex gap-2">
              <select
                value={buyingAsset}
                onChange={(e) => setBuyingAsset(e.target.value as "XLM" | "USDC")}
                className="flex-1 px-3 py-2 bg-cosmos-800 border border-stellar-500/20 rounded-lg text-white focus:outline-none focus:border-stellar-400"
              >
                <option value="XLM">XLM</option>
                <option value="USDC">USDC</option>
              </select>
              {orderType === "limit" ? (
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="Price"
                  className="flex-1 px-3 py-2 bg-cosmos-800 border border-stellar-500/20 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-stellar-400"
                />
              ) : (
                <div className="flex-1 px-3 py-2 bg-cosmos-800 border border-stellar-500/20 rounded-lg text-slate-400">
                  Market Price
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Slippage tolerance — market orders only (#619) */}
        {orderType === "market" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="slippage-tolerance"
                className="block text-sm font-medium text-slate-300"
              >
                Slippage tolerance
              </label>
              <span className="text-xs text-slate-500">
                Max price move you accept before the trade fails
              </span>
            </div>

            <div className="flex gap-2">
              {SLIPPAGE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setSlippage(preset)}
                  aria-pressed={slippage === preset}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    slippage === preset
                      ? "bg-stellar-500 text-white"
                      : "bg-cosmos-800 text-slate-400 hover:text-white"
                  }`}
                >
                  {preset}%
                </button>
              ))}
              <div className="relative flex-1">
                <input
                  id="slippage-tolerance"
                  type="number"
                  step="0.1"
                  min="0"
                  max={MAX_SLIPPAGE_PERCENT}
                  value={slippage}
                  onChange={(e) => setSlippage(e.target.value)}
                  placeholder="0.5"
                  className="w-full px-3 py-2 pr-7 bg-cosmos-800 border border-stellar-500/20 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-stellar-400"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
                  %
                </span>
              </div>
            </div>

            {!isSlippageValid && (
              <p className="text-xs text-red-400">
                Enter a slippage tolerance between 0 and {MAX_SLIPPAGE_PERCENT}%.
              </p>
            )}

            {isQuoting && <p className="text-xs text-slate-500">Fetching best price…</p>}

            {!isQuoting && quoteError && (
              <p className="text-xs text-amber-400">{quoteError}</p>
            )}

            {!isQuoting && quote && (
              <div className="rounded-lg bg-cosmos-800/60 border border-stellar-500/10 px-3 py-2 text-xs space-y-1">
                <div className="flex justify-between text-slate-400">
                  <span>Expected to receive</span>
                  <span className="text-slate-200">
                    {formatAsset(quote.destinationAmount, buyingAsset)}
                  </span>
                </div>
                {minimumReceived && (
                  <div className="flex justify-between text-slate-400">
                    <span>Minimum received</span>
                    <span className="text-white font-medium">
                      {formatAsset(minimumReceived, buyingAsset)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Limit Order Specific Options */}
        {orderType === "limit" && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSide("buy")}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                  side === "buy"
                    ? "bg-emerald-500 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Buy Order
              </button>
              <button
                type="button"
                onClick={() => setSide("sell")}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                  side === "sell"
                    ? "bg-red-500 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Sell Order
              </button>
            </div>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={
            isLoading ||
            !amount ||
            (orderType === "limit" && !price) ||
            (orderType === "market" && !isSlippageValid)
          }
          className="w-full btn-primary"
        >
          {isLoading ? "Processing..." : orderType === "market" ? "Execute Market Order" : `${side === "buy" ? "Place Buy" : "Place Sell"} Order`}
        </button>
      </form>
    </div>
  );
}
