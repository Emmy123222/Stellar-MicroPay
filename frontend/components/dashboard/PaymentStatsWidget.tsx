import React from "react";
import { StatsCard, formatStatsXLM } from "./StatsCard";

export interface PaymentStats {
  publicKey: string;
  totalSentXLM: string;
  totalReceivedXLM: string;
  sentCount: number;
  receivedCount: number;
  totalTransactions: number;
  comparison?: {
    thisWeekCount: number;
    lastWeekCount: number;
    countChangePercent: number;
    thisWeekVolume: string;
    lastWeekVolume: string;
    volumeChangePercent: number;
  };
}

export function PaymentStatsWidget({
  stats,
  loading,
  error,
  onRetry,
}: {
  stats: PaymentStats | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <section
        className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6"
        aria-label="Payment stats loading"
      >
        <span className="sr-only">Loading payment stats</span>
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="card border-white/10 bg-white/[0.03] animate-pulse"
          >
            <div className="h-3 w-24 rounded bg-white/10 mb-3" />
            <div className="h-8 w-32 rounded bg-white/10 mb-2" />
            <div className="h-3 w-20 rounded bg-white/10" />
          </div>
        ))}
      </section>
    );
  }

  if (error) {
    return (
      <section className="card mb-6 border-red-500/20 bg-red-500/5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-white">Payment summary</p>
            <p className="text-sm text-red-300">{error}</p>
          </div>
          <button onClick={onRetry} className="btn-secondary text-sm px-4 py-2">
            Retry
          </button>
        </div>
      </section>
    );
  }

  if (!stats) return null;

  const countDelta = stats.comparison?.countChangePercent;
  const volumeDelta = stats.comparison?.volumeChangePercent;

  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
      <StatsCard
        label="Total Sent"
        value={formatStatsXLM(stats.totalSentXLM)}
        helper={`${stats.sentCount} outgoing payment${stats.sentCount === 1 ? "" : "s"}`}
        delta={volumeDelta}
        deltaType={typeof volumeDelta === "number" ? (volumeDelta > 0 ? "positive" : volumeDelta < 0 ? "negative" : "neutral") : undefined}
      />
      <StatsCard
        label="Total Received"
        value={formatStatsXLM(stats.totalReceivedXLM, "received")}
        helper={`${stats.receivedCount} incoming payment${stats.receivedCount === 1 ? "" : "s"}`}
      />
      <StatsCard
        label="Transactions"
        value={stats.totalTransactions.toLocaleString("en-US")}
        helper="Across sent and received activity"
        delta={countDelta}
        deltaType={typeof countDelta === "number" ? (countDelta > 0 ? "positive" : countDelta < 0 ? "negative" : "neutral") : undefined}
      />
    </section>
  );
}
