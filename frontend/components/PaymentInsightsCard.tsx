import React from "react";
import { PaymentRecord } from "@/lib/stellar";
import { calculatePaymentInsights } from "@/utils/insights";

interface PaymentInsightsCardProps {
  payments?: PaymentRecord[];
  publicKey?: string;
  loading?: boolean;
}

export default function PaymentInsightsCard({
  payments = [],
  publicKey = "",
  loading = false,
}: PaymentInsightsCardProps) {
  if (loading) {
    return (
      <div
        className="card mb-8 bg-gradient-to-br from-cosmos-800 to-cosmos-900 border-stellar-500/20 p-6 animate-pulse"
        data-testid="payment-insights-skeleton"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="h-5 w-40 bg-white/10 rounded" />
          <div className="h-4 w-24 bg-white/10 rounded text-xs text-slate-400 flex items-center justify-center">
            Calculating…
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="h-20 bg-white/5 rounded-xl p-4 flex flex-col justify-between" />
          <div className="h-20 bg-white/5 rounded-xl p-4 flex flex-col justify-between" />
          <div className="h-20 bg-white/5 rounded-xl p-4 flex flex-col justify-between" />
        </div>
      </div>
    );
  }

  const insights = calculatePaymentInsights(payments, publicKey);

  const renderPercentageBadge = (percent: number | null) => {
    if (percent === null) return null;
    const isPositive = percent > 0;
    const isNegative = percent < 0;

    if (!isPositive && !isNegative) {
      return (
        <span className="inline-flex items-center text-xs font-medium text-slate-400 ml-2">
          0% vs last month
        </span>
      );
    }

    return (
      <span
        className={`inline-flex items-center gap-0.5 text-xs font-semibold ml-2 ${
          isPositive ? "text-emerald-400" : "text-rose-400"
        }`}
        data-testid={isPositive ? "positive-change" : "negative-change"}
      >
        {isPositive ? (
          <svg
            className="w-3.5 h-3.5 fill-current"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M12 7a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0V8.414l-4.293 4.293a1 1 0 01-1.414 0L7 9.414l-4.293 4.293a1 1 0 01-1.414-1.414l5-5a1 1 0 011.414 0L11 10.586 14.586 7H12z"
              clipRule="evenodd"
            />
          </svg>
        ) : (
          <svg
            className="w-3.5 h-3.5 fill-current"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M12 13a1 1 0 100 2h5a1 1 0 001-1V9a1 1 0 10-2 0v2.586l-4.293-4.293a1 1 0 00-1.414 0L7 10.586 2.707 6.293a1 1 0 00-1.414 1.414l5 5a1 1 0 001.414 0L11 9.414 14.586 13H12z"
              clipRule="evenodd"
            />
          </svg>
        )}
        {Math.abs(percent).toFixed(1)}% vs last month
      </span>
    );
  };

  return (
    <div
      className="card mb-8 bg-gradient-to-br from-cosmos-800 to-cosmos-900 border-stellar-500/20 p-6 relative overflow-hidden"
      data-testid="payment-insights-card"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg font-bold text-white flex items-center gap-2">
          Payment Insights
        </h2>
        <span className="text-xs text-slate-400 font-medium">This Calendar Month</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Sent XLM */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <p className="text-xs text-slate-400 font-medium mb-1">XLM Sent</p>
          <div className="flex items-baseline flex-wrap">
            <span className="text-2xl font-bold text-white">
              {insights.sentThisMonth.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <span className="text-sm font-semibold text-stellar-400 ml-1">XLM</span>
            {renderPercentageBadge(insights.sentChangePercent)}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            Last month: {insights.sentLastMonth.toFixed(2)} XLM
          </p>
        </div>

        {/* Received XLM */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <p className="text-xs text-slate-400 font-medium mb-1">XLM Received</p>
          <div className="flex items-baseline flex-wrap">
            <span className="text-2xl font-bold text-white">
              {insights.receivedThisMonth.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <span className="text-sm font-semibold text-stellar-400 ml-1">XLM</span>
            {renderPercentageBadge(insights.receivedChangePercent)}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            Last month: {insights.receivedLastMonth.toFixed(2)} XLM
          </p>
        </div>

        {/* Unique Counterparties */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <p className="text-xs text-slate-400 font-medium mb-1">
            Unique Counterparties
          </p>
          <div className="flex items-baseline">
            <span className="text-2xl font-bold text-white">
              {insights.uniqueCounterpartiesThisMonth}
            </span>
            <span className="text-xs text-slate-400 ml-2">accounts interacted</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">This calendar month</p>
        </div>
      </div>
    </div>
  );
}
