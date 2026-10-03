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

import { useCallback, useEffect, useRef, useState } from "react";
import Head from "next/head";
import { fetchNetworkMetrics, type NetworkMetrics } from "@/lib/stellar";

/** How often the page re-reads Horizon. */
const AUTO_REFRESH_MS = 10_000;

type LoadState = "connecting" | "ready" | "error";

/** A single metric row. `value` is `null` when Horizon could not supply it. */
interface MetricRow {
  key: string;
  metric: string;
  value: string;
  unit: string;
  detail?: string;
}

function formatLedgerSequence(sequence: number): string {
  return `#${sequence.toLocaleString("en-US")}`;
}

/** Deterministic UTC rendering, e.g. `2026-09-24 10:35:22 UTC`. */
function formatUtc(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return `${parsed.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

function formatXlm(amount: number): string {
  return amount.toFixed(7);
}

function formatCount(value: number | null): string {
  return value === null ? "Unavailable" : value.toLocaleString("en-US");
}

function buildMetricRows(metrics: NetworkMetrics): MetricRow[] {
  return [
    {
      key: "ledger",
      metric: "Latest ledger",
      value: formatLedgerSequence(metrics.latestLedgerSequence),
      unit: "sequence number",
      detail: "Newest ledger Horizon has ingested",
    },
    {
      key: "close-time",
      metric: "Last ledger close time",
      value: formatUtc(metrics.lastLedgerCloseTime),
      unit: "UTC",
      detail: "When the newest ledger closed",
    },
    {
      key: "close-lag",
      metric: "Time since last close",
      value: metrics.ledgerCloseLagSeconds.toLocaleString("en-US"),
      unit: "seconds",
      detail: "Ledgers close roughly every 5 seconds",
    },
    {
      key: "base-fee",
      metric: "Base fee",
      value: formatXlm(metrics.baseFeeXlm),
      unit: "XLM",
      detail: "Protocol minimum fee per operation",
    },
    {
      key: "recommended-fee",
      metric: "Recommended fee",
      value: formatXlm(metrics.recommendedFeeXlm),
      unit: "XLM",
      detail: "Median fee charged by recent transactions",
    },
    {
      key: "p95-fee",
      metric: "P95 fee",
      value: formatXlm(metrics.feeP95Xlm),
      unit: "XLM",
      detail: "95th percentile fee charged",
    },
    {
      key: "p99-fee",
      metric: "P99 fee",
      value: formatXlm(metrics.feeP99Xlm),
      unit: "XLM",
      detail: "99th percentile fee charged",
    },
    {
      key: "active-accounts",
      metric: "Active accounts",
      value: formatCount(metrics.activeAccounts),
      unit: "accounts",
      detail: `Distinct accounts in ledger ${formatLedgerSequence(
        metrics.activeAccountsLedger
      )}`,
    },
    {
      key: "ops-per-second",
      metric: "Operations per second",
      value:
        metrics.operationsPerSecond === null
          ? "Unavailable"
          : metrics.operationsPerSecond.toFixed(2),
      unit: "ops/s",
      detail: `Average over the last ${metrics.sampledLedgerCount} ledgers`,
    },
    {
      key: "horizon-latency",
      metric: "Horizon root latency",
      value: metrics.horizonLatencyMs.toFixed(0),
      unit: "milliseconds",
      detail: "Measured client-side on this device",
    },
    {
      key: "fee-stats-latency",
      metric: "Horizon fee stats latency",
      value: metrics.feeStatsLatencyMs.toFixed(0),
      unit: "milliseconds",
      detail: "Measured client-side on this device",
    },
    {
      key: "fee-level",
      metric: "Fee level",
      value: metrics.feeLevel,
      unit: "band",
      detail: "normal · elevated · high",
    },
    {
      key: "protocol",
      metric: "Protocol version",
      value: metrics.protocolVersion === null ? "Unknown" : String(metrics.protocolVersion),
      unit: "version",
    },
    {
      key: "passphrase",
      metric: "Network passphrase",
      value: metrics.networkPassphrase ?? "Unknown",
      unit: "identifier",
    },
    {
      key: "horizon-version",
      metric: "Horizon version",
      value: metrics.horizonVersion ?? "Unknown",
      unit: "build",
    },
    {
      key: "core-version",
      metric: "Stellar Core version",
      value: metrics.coreVersion ?? "Unknown",
      unit: "build",
    },
  ];
}

function ConnectingSkeleton() {
  return (
    <div
      className="bg-cosmos-800/50 border border-stellar-500/20 rounded-xl p-6"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-center gap-3 mb-6">
        <div className="w-5 h-5 border-2 border-stellar-400 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-300 font-medium">Connecting…</p>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        Contacting the Horizon API for the latest ledger, fee and account data.
      </p>
      <div className="space-y-3" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div key={row} className="flex items-center gap-4">
            <div className="h-4 w-1/3 rounded bg-white/5 animate-pulse" />
            <div className="h-4 w-1/4 rounded bg-white/5 animate-pulse" />
            <div className="h-4 w-1/6 rounded bg-white/5 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
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

      {/* Live ledger ticker */}
      <div className="bg-cosmos-800/50 border border-stellar-500/20 rounded-xl p-6 mb-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                ledgerPulse ? "bg-emerald-400 animate-ping" : "bg-emerald-500/60"
              }`}
              aria-hidden="true"
            />
            <span className="text-sm text-slate-400" aria-live="polite">
              {ledgerPulse ? "New ledger closed!" : "Waiting for the next ledger…"}
            </span>
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
