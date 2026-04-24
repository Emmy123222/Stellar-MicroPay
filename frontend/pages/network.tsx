/**
 * pages/network.tsx
 * Stellar network statistics page with live data from Horizon API.
 */

import { useState, useEffect } from "react";
import { fetchNetworkStats, NetworkStats } from "@/lib/stellar";

export default function Network() {
  const [stats, setStats] = useState<NetworkStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previousLedgerSequence, setPreviousLedgerSequence] = useState<number | null>(null);
  const [ledgerAnimation, setLedgerAnimation] = useState(false);

  const loadStats = async () => {
    try {
      setError(null);
      const newStats = await fetchNetworkStats();

      // Check if ledger sequence changed for animation
      if (previousLedgerSequence !== null && newStats.latestLedgerSequence !== previousLedgerSequence) {
        setLedgerAnimation(true);
        setTimeout(() => setLedgerAnimation(false), 1000); // Animation duration
      }

      setStats(newStats);
      setPreviousLedgerSequence(newStats.latestLedgerSequence);
    } catch (err) {
      console.error("Failed to load network stats:", err);
      setError(err instanceof Error ? err.message : "Failed to load network statistics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();

    // Auto-refresh every 10 seconds
    const interval = setInterval(loadStats, 10000);

    return () => clearInterval(interval);
  }, []);

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleString();
  };

  const formatFee = (stroops: number) => {
    return (stroops / 10000000).toFixed(7); // Convert stroops to XLM
  };

  if (loading && !stats) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 animate-fade-in cursor-default select-none">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-stellar-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400">Loading network statistics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 animate-fade-in cursor-default select-none">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h1 className="font-display text-2xl font-bold text-white mb-2">Network Error</h1>
          <p className="text-slate-400 mb-6">{error}</p>
          <button
            onClick={loadStats}
            className="btn-primary"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 animate-fade-in cursor-default select-none">
      {/* Header */}
      <div className="text-center mb-10">
        <h1 className="font-display text-3xl font-bold text-white mb-3">
          Stellar Network Statistics
        </h1>
        <p className="text-slate-400">
          Live data from the Horizon API • Auto-refreshes every 10 seconds
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {/* Latest Ledger Sequence */}
        <div className="bg-cosmos-800/50 border border-stellar-500/20 rounded-xl p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-slate-400">Latest Ledger</h3>
            {ledgerAnimation && (
              <div className="w-2 h-2 bg-emerald-400 rounded-full animate-ping" />
            )}
          </div>
          <div className={`text-2xl font-bold text-white transition-all duration-300 ${ledgerAnimation ? 'text-emerald-400 scale-110' : ''}`}>
            #{stats!.latestLedgerSequence.toLocaleString()}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Sequence number
          </p>
        </div>

        {/* Last Ledger Close Time */}
        <div className="bg-cosmos-800/50 border border-stellar-500/20 rounded-xl p-6">
          <h3 className="text-sm font-medium text-slate-400 mb-2">Last Close Time</h3>
          <div className="text-lg font-bold text-white">
            {formatTime(stats!.lastLedgerCloseTime)}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            When the ledger closed
          </p>
        </div>

        {/* Average Transaction Count */}
        <div className="bg-cosmos-800/50 border border-stellar-500/20 rounded-xl p-6">
          <h3 className="text-sm font-medium text-slate-400 mb-2">Avg Transactions</h3>
          <div className="text-2xl font-bold text-white">
            {stats!.avgTransactionCount.toLocaleString()}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Per ledger (last 10)
          </p>
        </div>

        {/* Current Base Fee */}
        <div className="bg-cosmos-800/50 border border-stellar-500/20 rounded-xl p-6">
          <h3 className="text-sm font-medium text-slate-400 mb-2">Base Fee</h3>
          <div className="text-2xl font-bold text-white">
            {formatFee(stats!.currentBaseFee)} XLM
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Minimum transaction fee
          </p>
        </div>

        {/* P50 Fee */}
        <div className="bg-cosmos-800/50 border border-stellar-500/20 rounded-xl p-6">
          <h3 className="text-sm font-medium text-slate-400 mb-2">P50 Fee</h3>
          <div className="text-2xl font-bold text-white">
            {formatFee(stats!.p50Fee)} XLM
          </div>
          <p className="text-xs text-slate-500 mt-1">
            50th percentile fee
          </p>
        </div>

        {/* P95 Fee */}
        <div className="bg-cosmos-800/50 border border-stellar-500/20 rounded-xl p-6">
          <h3 className="text-sm font-medium text-slate-400 mb-2">P95 Fee</h3>
          <div className="text-2xl font-bold text-white">
            {formatFee(stats!.p95Fee)} XLM
          </div>
          <p className="text-xs text-slate-500 mt-1">
            95th percentile fee
          </p>
        </div>

        {/* P99 Fee */}
        <div className="bg-cosmos-800/50 border border-stellar-500/20 rounded-xl p-6 md:col-span-2 lg:col-span-1">
          <h3 className="text-sm font-medium text-slate-400 mb-2">P99 Fee</h3>
          <div className="text-2xl font-bold text-white">
            {formatFee(stats!.p99Fee)} XLM
          </div>
          <p className="text-xs text-slate-500 mt-1">
            99th percentile fee
          </p>
        </div>
      </div>

      {/* Real-time Ledger Close Ticker */}
      <div className="bg-cosmos-800/50 border border-stellar-500/20 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Live Ledger Ticker</h3>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${ledgerAnimation ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
            <span className="text-sm text-slate-400">
              {ledgerAnimation ? 'New ledger closed!' : 'Waiting for next ledger...'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="text-3xl font-bold text-white mb-1">
              #{stats!.latestLedgerSequence.toLocaleString()}
            </div>
            <div className="text-sm text-slate-400">
              Closed {new Date(stats!.lastLedgerCloseTime).toLocaleTimeString()}
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm text-slate-400 mb-1">Next close in</div>
            <div className="text-lg font-semibold text-stellar-400">
              ~5 seconds
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}