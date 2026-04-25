/**
 * pages/trade.tsx
 * Stellar DEX trading interface with market/limit orders, orderbook, and trade history.
 */

import { useState, useEffect } from "react";
import { Asset } from "@stellar/stellar-sdk";
import {
  fetchOrderbook,
  fetchTradeAggregations,
  fetchOpenOffers,
  buildCancelOfferTransaction,
  submitTransaction,
  NETWORK_PASSPHRASE,
  USDC,
  Orderbook,
  TradeAggregation,
  OpenOffer,
} from "@/lib/stellar";
import TradeForm from "@/components/TradeForm";
import Toast from "@/components/Toast";
import { format } from "date-fns";

interface TradePageProps {
  publicKey: string;
}

export default function Trade({ publicKey }: TradePageProps) {
  const [orderbook, setOrderbook] = useState<Orderbook | null>(null);
  const [tradeHistory, setTradeHistory] = useState<TradeAggregation[]>([]);
  const [openOffers, setOpenOffers] = useState<OpenOffer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [activeTab, setActiveTab] = useState<"trade" | "orders" | "history">("trade");

  // Load orderbook data
  const loadOrderbook = async () => {
    try {
      const data = await fetchOrderbook(USDC, Asset.native(), 10);
      setOrderbook(data);
    } catch (error) {
      console.error("Failed to load orderbook:", error);
    }
  };

  // Load trade history for last 24 hours
  const loadTradeHistory = async () => {
    try {
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago
      
      const data = await fetchTradeAggregations(
        USDC,
        Asset.native(),
        "1hour",
        startTime,
        endTime,
        24
      );
      setTradeHistory(data);
    } catch (error) {
      console.error("Failed to load trade history:", error);
    }
  };

  // Load open offers
  const loadOpenOffers = async () => {
    try {
      const offers = await fetchOpenOffers(publicKey);
      setOpenOffers(offers);
    } catch (error) {
      console.error("Failed to load open offers:", error);
    }
  };

  // Cancel an offer
  const handleCancelOffer = async (offer: OpenOffer) => {
    setIsLoading(true);
    try {
      const transaction = await buildCancelOfferTransaction({
        fromPublicKey: publicKey,
        offerId: offer.id,
        selling: offer.selling,
        buying: offer.buying,
      });

      // Sign with Freighter
      const { signTransaction } = await import("@stellar/freighter-api");
      const signedXDR = await signTransaction(transaction.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
      });

      // Submit transaction
      await submitTransaction(signedXDR);
      
      showToast("Offer cancelled successfully!", "success");
      loadOpenOffers(); // Reload offers
    } catch (error) {
      console.error("Failed to cancel offer:", error);
      showToast(error instanceof Error ? error.message : "Failed to cancel offer", "error");
    } finally {
      setIsLoading(false);
    }
  };

  // Show toast notification
  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Load data on component mount and tab changes
  useEffect(() => {
    if (activeTab === "trade") {
      loadOrderbook();
      loadTradeHistory();
    } else if (activeTab === "orders") {
      loadOpenOffers();
    }
  }, [activeTab, publicKey]);

  // Format asset display
  const formatAsset = (asset: Asset): string => {
    if (asset.isNative()) return "XLM";
    return `${asset.code}:${asset.issuer}`;
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-white mb-2">
          Stellar DEX Trading
        </h1>
        <p className="text-slate-400">
          Trade XLM and USDC on the Stellar decentralised exchange
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 mb-8 border-b border-stellar-500/20">
        <button
          onClick={() => setActiveTab("trade")}
          className={`pb-3 px-4 font-medium transition-all ${
            activeTab === "trade"
              ? "text-stellar-400 border-b-2 border-stellar-400"
              : "text-slate-400 hover:text-white"
          }`}
        >
          Trade
        </button>
        <button
          onClick={() => setActiveTab("orders")}
          className={`pb-3 px-4 font-medium transition-all ${
            activeTab === "orders"
              ? "text-stellar-400 border-b-2 border-stellar-400"
              : "text-slate-400 hover:text-white"
          }`}
        >
          Open Orders
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`pb-3 px-4 font-medium transition-all ${
            activeTab === "history"
              ? "text-stellar-400 border-b-2 border-stellar-400"
              : "text-slate-400 hover:text-white"
          }`}
        >
          Trade History
        </button>
      </div>

      {/* Trade Tab */}
      {activeTab === "trade" && (
        <div className="grid lg:grid-cols-2 gap-8">
          {/* Trading Form */}
          <div>
            <TradeForm
              publicKey={publicKey}
              onTradeComplete={() => {
                loadOrderbook();
                loadOpenOffers();
              }}
              onError={(error) => showToast(error, "error")}
              onSuccess={(message) => showToast(message, "success")}
            />
          </div>

          {/* Orderbook */}
          <div>
            <div className="card">
              <h2 className="text-xl font-semibold text-white mb-4">Orderbook (USDC/XLM)</h2>
              
              {orderbook ? (
                <div className="space-y-4">
                  {/* Asks (Sell Orders) */}
                  <div>
                    <h3 className="text-sm font-medium text-slate-400 mb-2">Sell Orders</h3>
                    <div className="space-y-1">
                      {orderbook.asks.slice(0, 5).map((ask, index) => (
                        <div key={index} className="flex justify-between text-sm">
                          <span className="text-red-400">{ask.price}</span>
                          <span className="text-slate-300">{ask.amount}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Spread */}
                  <div className="py-2 border-t border-stellar-500/20">
                    <div className="flex justify-between text-sm font-medium">
                      <span className="text-slate-400">Spread</span>
                      <span className="text-stellar-400">
                        {orderbook.asks[0] && orderbook.bids[0]
                          ? (parseFloat(orderbook.asks[0].price) - parseFloat(orderbook.bids[0].price)).toFixed(7)
                          : "N/A"}
                      </span>
                    </div>
                  </div>

                  {/* Bids (Buy Orders) */}
                  <div>
                    <h3 className="text-sm font-medium text-slate-400 mb-2">Buy Orders</h3>
                    <div className="space-y-1">
                      {orderbook.bids.slice(0, 5).map((bid, index) => (
                        <div key={index} className="flex justify-between text-sm">
                          <span className="text-emerald-400">{bid.price}</span>
                          <span className="text-slate-300">{bid.amount}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-slate-500">
                  Loading orderbook...
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Open Orders Tab */}
      {activeTab === "orders" && (
        <div className="card">
          <h2 className="text-xl font-semibold text-white mb-4">Your Open Orders</h2>
          
          {openOffers.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-stellar-500/20">
                    <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Pair</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Type</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Amount</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Price</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {openOffers.map((offer) => (
                    <tr key={offer.id} className="border-b border-stellar-500/10">
                      <td className="py-3 px-4 text-sm text-white">
                        {formatAsset(offer.selling)}/{formatAsset(offer.buying)}
                      </td>
                      <td className="py-3 px-4 text-sm">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          offer.selling.isNative() 
                            ? "bg-red-500/20 text-red-400" 
                            : "bg-emerald-500/20 text-emerald-400"
                        }`}>
                          {offer.selling.isNative() ? "Sell" : "Buy"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm text-white text-right">{offer.amount}</td>
                      <td className="py-3 px-4 text-sm text-white text-right">{offer.price}</td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => handleCancelOffer(offer)}
                          disabled={isLoading}
                          className="px-3 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded text-sm font-medium transition-colors disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-slate-500">
              No open orders
            </div>
          )}
        </div>
      )}

      {/* Trade History Tab */}
      {activeTab === "history" && (
        <div className="card">
          <h2 className="text-xl font-semibold text-white mb-4">Trade History (24h)</h2>
          
          {tradeHistory.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-stellar-500/20">
                    <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Time</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Price</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Volume (USDC)</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Volume (XLM)</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Trades</th>
                  </tr>
                </thead>
                <tbody>
                  {tradeHistory.map((trade, index) => (
                    <tr key={index} className="border-b border-stellar-500/10">
                      <td className="py-3 px-4 text-sm text-slate-400">
                        {format(new Date(trade.timestamp), "HH:mm")}
                      </td>
                      <td className="py-3 px-4 text-sm text-white text-right">{trade.price}</td>
                      <td className="py-3 px-4 text-sm text-white text-right">{trade.base_volume}</td>
                      <td className="py-3 px-4 text-sm text-white text-right">{trade.counter_volume}</td>
                      <td className="py-3 px-4 text-sm text-white text-right">{trade.trade_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-slate-500">
              No trades in the last 24 hours
            </div>
          )}
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
