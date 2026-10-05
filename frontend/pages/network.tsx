/**
 * pages/network.tsx
 * Stellar network status page.
 *
 * Shows live network health sourced from Horizon:
 *   - the root endpoint (`/`) for the current ledger, close time and versions
 *   - `/fee_stats` for base, recommended and tail fees
 *   - `/ledgers` for operations per second
 *   - `/ledgers/{seq}/operations` for active accounts
 *
 * Horizon latencies are measured client-side on every refresh.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import Head from "next/head";
import { fetchNetworkMetrics, type NetworkMetrics } from "@/lib/stellar";
import FeeHistorySparkline from "@/components/FeeHistorySparkline";

type LoadState = "connecting" | "ready" | "error";
const AUTO_REFRESH_MS = 10_000;

function ConnectingSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-label="Loading network metrics">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="h-28 rounded-xl border border-white/10 bg-white/5 animate-pulse" />
      ))}
    </div>
  );
}

function formatFee(feeXlm: number): string {
  return feeXlm.toFixed(7).replace(/0+$/, "").replace(/\.$/, "");
}

function formatLedgerSequence(sequence: number): string {
  return sequence.toLocaleString("en-US");
}

function buildMetricRows(metrics: NetworkMetrics) {
  return [
    { key: "ledger", metric: "Latest ledger", value: formatLedgerSequence(metrics.latestLedgerSequence), unit: "ledger", detail: null },
    { key: "close-lag", metric: "Ledger close lag", value: metrics.ledgerCloseLagSeconds.toFixed(2), unit: "seconds", detail: metrics.lastLedgerCloseTime },
    { key: "active-accounts", metric: "Active accounts", value: metrics.activeAccounts?.toLocaleString("en-US") ?? "Unavailable", unit: "accounts", detail: `Ledger ${formatLedgerSequence(metrics.activeAccountsLedger)}` },
    { key: "operations", metric: "Operations per second", value: metrics.operationsPerSecond?.toLocaleString("en-US") ?? "Unavailable", unit: "ops/sec", detail: `${metrics.sampledLedgerCount} ledgers sampled` },
    { key: "horizon-latency", metric: "Horizon latency", value: metrics.horizonLatencyMs.toFixed(0), unit: "ms", detail: null },
    { key: "fee-latency", metric: "Fee stats latency", value: metrics.feeStatsLatencyMs.toFixed(0), unit: "ms", detail: null },
    { key: "protocol", metric: "Protocol version", value: metrics.protocolVersion?.toString() ?? "Unavailable", unit: "version", detail: null },
    { key: "horizon", metric: "Horizon version", value: metrics.horizonVersion ?? "Unavailable", unit: "version", detail: null },
    { key: "core", metric: "Stellar Core version", value: metrics.coreVersion ?? "Unavailable", unit: "version", detail: null },
  ];
}

export default function Network() {
  const [metrics, setMetrics] = useState<NetworkMetrics | null>(null);
  const [status, setStatus] = useState<LoadState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [ledgerPulse, setLedgerPulse] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Track the last ledger we rendered without re-creating the refresh callback.
  const previousLedgerRef = useRef<number | null>(null);

  const loadMetrics = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const next = await fetchNetworkMetrics();

      if (
        previousLedgerRef.current !== null &&
        next.latestLedgerSequence !== previousLedgerRef.current
      ) {
        setLedgerPulse(true);
        window.setTimeout(() => setLedgerPulse(false), 1200);
      }

      previousLedgerRef.current = next.latestLedgerSequence;
      setMetrics(next);
      setStatus("ready");
      setError(null);
      setRefreshError(null);
      setLastUpdatedAt(new Date());
    } catch (err) {
      console.error("Failed to load network metrics:", err);
      const message =
        err instanceof Error ? err.message : "Failed to load network statistics";

      // Keep the last good snapshot on screen; only blank the page if we have
      // never successfully loaded anything.
      setMetrics((current) => {
        if (current) {
          setRefreshError(message);
          return current;
        }
        setError(message);
        setStatus("error");
        return current;
      });
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadMetrics();

    const intervalId = window.setInterval(loadMetrics, AUTO_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [loadMetrics]);

  const header = (
    <div className="text-center mb-10">
      <h1 className="font-display text-3xl font-bold text-white mb-3">
        Stellar Network Status
      </h1>
      <p className="text-slate-400">
        Live metrics from the Horizon API · Auto-refreshes every 10 seconds
      </p>
    </div>
  );

  if (status === "connecting") {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 animate-fade-in cursor-default select-none">
        <Head>
          <title>Network Status | Stellar-MicroPay</title>
        </Head>
        {header}
        <ConnectingSkeleton />
      </div>
    );
  }

  if (status === "error" || !metrics) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 animate-fade-in cursor-default select-none">
        <Head>
          <title>Network Status | Stellar-MicroPay</title>
        </Head>
        {header}
        <div className="text-center" role="alert">
          <div className="w-12 h-12 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-6 h-6 text-red-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          </div>
          <h2 className="font-display text-2xl font-bold text-white mb-2">
            Network Error
          </h2>
          <p className="text-slate-400 mb-6">{error}</p>
          <button onClick={loadMetrics} className="btn-primary">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const rows = buildMetricRows(metrics);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 animate-fade-in cursor-default select-none">
      <Head>
        <title>Network Status | Stellar-MicroPay</title>
        <meta
          name="description"
          content="Live Stellar network health: ledger sequence, close time, fees, active accounts, operations per second and Horizon latency."
        />
      </Head>

      {header}

      {refreshError && (
        <div
          className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300"
          role="status"
        >
          Showing the last successful reading — refresh failed: {refreshError}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <div className="bg-cosmos-800/50 border border-stellar-500/20 rounded-xl p-6">
          <h3 className="text-sm font-medium text-slate-400 mb-2">Operations per second</h3>
          <div className="text-2xl font-bold text-white">{metrics.operationsPerSecond?.toLocaleString("en-US") ?? "Unavailable"}</div>
          <p className="text-xs text-slate-500 mt-1">{metrics.sampledLedgerCount} ledgers sampled</p>
        </div>

        <div className="bg-cosmos-800/50 border border-stellar-500/20 rounded-xl p-6">
          <h3 className="text-sm font-medium text-slate-400 mb-2">Base Fee</h3>
          <div className="text-2xl font-bold text-white">
            {formatFee(metrics.baseFeeXlm)} XLM
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Minimum transaction fee
          </p>
        </div>

        <div className="bg-cosmos-800/50 border border-stellar-500/20 rounded-xl p-6">
          <h3 className="text-sm font-medium text-slate-400 mb-2">P50 Fee</h3>
          <div className="text-2xl font-bold text-white mb-3">
            {formatFee(metrics.recommendedFeeXlm)} XLM
          </div>
          <p className="text-xs text-slate-400 mb-3">50th percentile fee</p>
          <div className="mt-4">
            <p className="text-xs text-slate-400 mb-2">Fee History (24h)</p>
            <FeeHistorySparkline className="w-full" />
          </div>
        </div>

        <div className="bg-cosmos-800/50 border border-stellar-500/20 rounded-xl p-6">
          <h3 className="text-sm font-medium text-slate-400 mb-2">P95 Fee</h3>
          <div className="text-2xl font-bold text-white">
            {formatFee(metrics.feeP95Xlm)} XLM
          </div>
          <div className="text-right">
            <span className="text-xs uppercase tracking-wider text-slate-500">
              Latest ledger
            </span>
            <p
              className={`font-display text-2xl font-bold transition-colors ${
                ledgerPulse ? "text-emerald-400" : "text-white"
              }`}
            >
              {formatLedgerSequence(metrics.latestLedgerSequence)}
            </p>
          </div>
        </div>
        <p className="mt-4 text-xs text-slate-500">
          {isRefreshing
            ? "Refreshing…"
            : lastUpdatedAt
            ? `Last updated ${lastUpdatedAt.toLocaleTimeString()}`
            : "Awaiting first reading"}
        </p>
      </div>

      {/* Accessible metric table */}
      <div className="bg-cosmos-800/50 border border-stellar-500/20 rounded-xl overflow-hidden">
        <table className="w-full text-left text-sm">
          <caption className="px-6 py-4 text-left font-display text-lg font-semibold text-white border-b border-white/5">
            Stellar network health metrics
            <span className="block text-xs font-normal text-slate-500 mt-1">
              Values refresh automatically; units are shown per row.
            </span>
          </caption>
          <thead>
            <tr className="border-b border-white/5 text-xs uppercase tracking-wider text-slate-500">
              <th scope="col" className="px-6 py-3 font-medium">
                Metric
              </th>
              <th scope="col" className="px-6 py-3 font-medium">
                Value
              </th>
              <th scope="col" className="px-6 py-3 font-medium">
                Unit
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-white/5 last:border-b-0">
                <th
                  scope="row"
                  className="px-6 py-3 align-top font-medium text-slate-300"
                >
                  {row.metric}
                  {row.detail && (
                    <span className="block text-xs font-normal text-slate-500 mt-0.5">
                      {row.detail}
                    </span>
                  )}
                </th>
                <td className="px-6 py-3 align-top font-mono text-white break-all">
                  {row.value}
                </td>
                <td className="px-6 py-3 align-top text-slate-400">{row.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
