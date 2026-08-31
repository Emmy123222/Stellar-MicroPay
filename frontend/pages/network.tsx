/**
 * pages/network.tsx
 * Stellar network statistics page with live data from Horizon API.
 * Includes a latency / uptime history chart built from timed poll samples.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { fetchNetworkStats, NetworkStats } from "@/lib/stellar";
import { getNetworkConfig } from "@/lib/stellarConfig";

// ─── Latency sample ───────────────────────────────────────────────────────────

interface LatencySample {
  /** Unix ms timestamp when the poll completed */
  time: number;
  /** Round-trip latency in milliseconds, or null if the request failed */
  latencyMs: number | null;
}

/** Maximum number of samples to keep (30 × 10 s ≈ 5 min window) */
const MAX_SAMPLES = 30;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(isoString: string) {
  return new Date(isoString).toLocaleString();
}

function formatFee(stroops: number) {
  return (stroops / 10_000_000).toFixed(7);
}

function formatMs(ms: number) {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Colour bucket for a latency value */
function latencyColour(ms: number): "green" | "amber" | "red" {
  if (ms < 500) return "green";
  if (ms < 1500) return "amber";
  return "red";
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Network() {
  const [stats, setStats] = useState<NetworkStats | null>(null);
  const networkConfig = getNetworkConfig();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previousLedgerSequence, setPreviousLedgerSequence] = useState<number | null>(null);
  const [ledgerAnimation, setLedgerAnimation] = useState(false);
  const [samples, setSamples] = useState<LatencySample[]>([]);

  // Keep a ref so the loadStats callback always sees the latest samples
  const samplesRef = useRef<LatencySample[]>([]);
  samplesRef.current = samples;

  const loadStats = useCallback(async () => {
    const t0 = performance.now();
    try {
      setError(null);
      const newStats = await fetchNetworkStats();
      const latencyMs = Math.round(performance.now() - t0);

      // Ledger change animation
      if (
        previousLedgerSequence !== null &&
        newStats.latestLedgerSequence !== previousLedgerSequence
      ) {
        setLedgerAnimation(true);
        setTimeout(() => setLedgerAnimation(false), 1000);
      }

      setStats(newStats);
      setPreviousLedgerSequence(newStats.latestLedgerSequence);

      // Append success sample
      setSamples((prev) => {
        const next = [...prev, { time: Date.now(), latencyMs }];
        return next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next;
      });
    } catch (err) {
      console.error("Failed to load network stats:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load network statistics"
      );

      // Append failure sample (downtime marker)
      setSamples((prev) => {
        const next = [...prev, { time: Date.now(), latencyMs: null }];
        return next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next;
      });
    } finally {
      setLoading(false);
    }
  }, [previousLedgerSequence]);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 10_000);
    return () => clearInterval(interval);
  }, [loadStats]);

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

  if (error && !stats) {
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
          <button onClick={loadStats} className="btn-primary">
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
          Live data from the Horizon API · Auto-refreshes every 10 seconds
        </p>
      </div>

      {/* ── Latency / Uptime Chart ─────────────────────────────────────────── */}
      <LatencyChart samples={samples} />

      <section
        aria-labelledby="network-health-heading"
        className="sr-only"
        role="region"
      >
        <h2 id="network-health-heading">Network health</h2>
        <dl>
          <div>
            <dt>Network</dt>
            <dd>{networkConfig.network === "mainnet" ? "Mainnet" : "Testnet"}</dd>
          </div>
          <div>
            <dt>Account</dt>
            <dd>Network-wide statistics</dd>
          </div>
          <div>
            <dt>Node</dt>
            <dd>Horizon API</dd>
          </div>
          <div>
            <dt>Ledger</dt>
            <dd>{stats!.latestLedgerSequence.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Average latency</dt>
            <dd>{getAverageLatency(samples)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{getHealthStatus(samples, error)}</dd>
          </div>
        </dl>
      </section>

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
          <div
            className={`text-2xl font-bold text-white transition-all duration-300 ${
              ledgerAnimation ? "text-emerald-400 scale-110" : ""
            }`}
          >
            #{stats!.latestLedgerSequence.toLocaleString()}
          </div>
          <p className="text-xs text-slate-400 mt-1">Sequence number</p>
        </div>

        {/* Last Ledger Close Time */}
        <div className="bg-cosmos-800/50 border border-stellar-500/20 rounded-xl p-6">
          <h3 className="text-sm font-medium text-slate-400 mb-2">Last Close Time</h3>
          <div className="text-lg font-bold text-white">
            {formatTime(stats!.lastLedgerCloseTime)}
          </div>
          <p className="text-xs text-slate-400 mt-1">When the ledger closed</p>
        </div>

        {/* Average Transaction Count */}
        <div className="bg-cosmos-800/50 border border-stellar-500/20 rounded-xl p-6">
          <h3 className="text-sm font-medium text-slate-400 mb-2">Avg Transactions</h3>
          <div className="text-2xl font-bold text-white">
            {stats!.avgTransactionCount.toLocaleString()}
          </div>
          <p className="text-xs text-slate-400 mt-1">Per ledger (last 10)</p>
        </div>

        {/* Current Base Fee */}
        <div className="bg-cosmos-800/50 border border-stellar-500/20 rounded-xl p-6">
          <h3 className="text-sm font-medium text-slate-400 mb-2">Base Fee</h3>
          <div className="text-2xl font-bold text-white">
            {formatFee(stats!.currentBaseFee)} XLM
          </div>
          <p className="text-xs text-slate-400 mt-1">Minimum transaction fee</p>
        </div>

        {/* P50 Fee */}
        <div className="bg-cosmos-800/50 border border-stellar-500/20 rounded-xl p-6">
          <h3 className="text-sm font-medium text-slate-400 mb-2">P50 Fee</h3>
          <div className="text-2xl font-bold text-white">
            {formatFee(stats!.p50Fee)} XLM
          </div>
          <p className="text-xs text-slate-400 mt-1">50th percentile fee</p>
        </div>

        {/* P95 Fee */}
        <div className="bg-cosmos-800/50 border border-stellar-500/20 rounded-xl p-6">
          <h3 className="text-sm font-medium text-slate-400 mb-2">P95 Fee</h3>
          <div className="text-2xl font-bold text-white">
            {formatFee(stats!.p95Fee)} XLM
          </div>
          <p className="text-xs text-slate-400 mt-1">95th percentile fee</p>
        </div>

        {/* P99 Fee */}
        <div className="bg-cosmos-800/50 border border-stellar-500/20 rounded-xl p-6 md:col-span-2 lg:col-span-1">
          <h3 className="text-sm font-medium text-slate-400 mb-2">P99 Fee</h3>
          <div className="text-2xl font-bold text-white">
            {formatFee(stats!.p99Fee)} XLM
          </div>
          <p className="text-xs text-slate-400 mt-1">99th percentile fee</p>
        </div>
      </div>

      {/* Real-time Ledger Close Ticker */}
      <div className="bg-cosmos-800/50 border border-stellar-500/20 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Live Ledger Ticker</h3>
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                ledgerAnimation ? "bg-emerald-400 animate-pulse" : "bg-slate-500"
              }`}
            />
            <span className="text-sm text-slate-400">
              {ledgerAnimation ? "New ledger closed!" : "Waiting for next ledger..."}
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
            <div className="text-lg font-semibold text-stellar-400">~5 seconds</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── LatencyChart ─────────────────────────────────────────────────────────────

const CHART_HEIGHT = 80; // px, the bar drawing area
const BAR_GAP = 2; // px between bars

interface LatencyChartProps {
  samples: LatencySample[];
}

function LatencyChart({ samples }: LatencyChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(600);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // Observe container width for responsive bars
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setContainerWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const downtimeCount = samples.filter((s) => s.latencyMs === null).length;
  const successSamples = samples.filter((s) => s.latencyMs !== null);
  const avgLatency =
    successSamples.length > 0
      ? Math.round(
          successSamples.reduce((a, s) => a + (s.latencyMs ?? 0), 0) /
            successSamples.length
        )
      : null;
  const maxLatency =
    successSamples.length > 0
      ? Math.max(...successSamples.map((s) => s.latencyMs ?? 0))
      : null;

  // Scale: use 2000 ms as the chart ceiling (bars clamp at top)
  const CEIL_MS = Math.max(2000, maxLatency ?? 2000);

  // Bar width based on available space and MAX_SAMPLES slots
  const totalGap = (MAX_SAMPLES - 1) * BAR_GAP;
  const barW = Math.max(4, Math.floor((containerWidth - totalGap) / MAX_SAMPLES));

  // Pad samples array to MAX_SAMPLES with empty slots on the left
  const padded: (LatencySample | null)[] = [
    ...Array(Math.max(0, MAX_SAMPLES - samples.length)).fill(null),
    ...samples,
  ];

  const svgWidth = MAX_SAMPLES * barW + (MAX_SAMPLES - 1) * BAR_GAP;
  const svgHeight = CHART_HEIGHT;

  function barHeight(ms: number) {
    return Math.max(3, Math.round((ms / CEIL_MS) * svgHeight));
  }

  const hovered = hoveredIdx !== null ? padded[hoveredIdx] : null;

  return (
    <div className="bg-cosmos-800/50 border border-stellar-500/20 rounded-xl p-6 mb-8">
      {/* Header row */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h3 className="text-lg font-semibold text-white">Horizon Latency</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Last {samples.length} poll{samples.length !== 1 ? "s" : ""} · sampled every 10 s
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {avgLatency !== null && (
            <span className="text-slate-300">
              Avg{" "}
              <span className="font-semibold text-white">{formatMs(avgLatency)}</span>
            </span>
          )}
          {downtimeCount > 0 ? (
            <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-500/15 border border-red-500/25 text-red-400 text-xs font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              {downtimeCount} outage{downtimeCount !== 1 ? "s" : ""} detected
            </span>
          ) : samples.length > 0 ? (
            <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 text-xs font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              All checks passing
            </span>
          ) : null}
        </div>
      </div>

      {/* Chart area */}
      <div ref={containerRef} className="relative">
        {samples.length === 0 ? (
          <div
            className="flex items-center justify-center text-slate-500 text-sm"
            style={{ height: svgHeight + 20 }}
          >
            Collecting samples…
          </div>
        ) : (
          <>
            {/* Tooltip */}
            {hovered && (
              <div
                className="absolute top-0 pointer-events-none z-10 bg-slate-800 border border-slate-600 rounded-lg px-2.5 py-1.5 text-xs text-white shadow-lg whitespace-nowrap"
                style={{
                  left: Math.min(
                    hoveredIdx! * (barW + BAR_GAP),
                    svgWidth - 120
                  ),
                  transform: "translateY(-110%)",
                }}
              >
                {hovered.latencyMs !== null ? (
                  <>
                    <span className="font-semibold">{formatMs(hovered.latencyMs)}</span>
                    <span className="text-slate-400 ml-1.5">
                      {new Date(hovered.time).toLocaleTimeString()}
                    </span>
                  </>
                ) : (
                  <span className="text-red-400">
                    Outage · {new Date(hovered.time).toLocaleTimeString()}
                  </span>
                )}
              </div>
            )}

            <svg
              width="100%"
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              preserveAspectRatio="none"
              aria-label="Latency history chart"
              role="img"
              aria-hidden="true"
              style={{ display: "block" }}
            >
              {padded.map((sample, i) => {
                const x = i * (barW + BAR_GAP);

                if (sample === null) {
                  // Empty slot — draw faint placeholder
                  return (
                    <rect
                      key={i}
                      x={x}
                      y={svgHeight - 3}
                      width={barW}
                      height={3}
                      rx={1}
                      fill="rgba(100,116,139,0.15)"
                    />
                  );
                }

                if (sample.latencyMs === null) {
                  // Downtime — full-height red bar with hatching
                  return (
                    <g key={i} onMouseEnter={() => setHoveredIdx(i)} onMouseLeave={() => setHoveredIdx(null)}>
                      <rect
                        x={x}
                        y={0}
                        width={barW}
                        height={svgHeight}
                        rx={1}
                        fill="rgba(239,68,68,0.25)"
                        stroke="rgba(239,68,68,0.5)"
                        strokeWidth={0.5}
                      />
                      {/* Diagonal stripes for downtime */}
                      <line x1={x} y1={svgHeight} x2={x + barW} y2={0} stroke="rgba(239,68,68,0.4)" strokeWidth={0.8} />
                    </g>
                  );
                }

                const h = barHeight(sample.latencyMs);
                const colour = latencyColour(sample.latencyMs);
                const fill =
                  colour === "green"
                    ? "rgba(52,211,153,0.75)"
                    : colour === "amber"
                    ? "rgba(251,191,36,0.75)"
                    : "rgba(239,68,68,0.75)";
                const fillHover =
                  colour === "green"
                    ? "rgba(52,211,153,1)"
                    : colour === "amber"
                    ? "rgba(251,191,36,1)"
                    : "rgba(239,68,68,1)";

                return (
                  <rect
                    key={i}
                    x={x}
                    y={svgHeight - h}
                    width={barW}
                    height={h}
                    rx={1}
                    fill={hoveredIdx === i ? fillHover : fill}
                    onMouseEnter={() => setHoveredIdx(i)}
                    onMouseLeave={() => setHoveredIdx(null)}
                    style={{ cursor: "default" }}
                  />
                );
              })}
            </svg>

            <div className="sr-only" aria-label="Selectable latency samples">
              {samples.map((sample, i) => (
                <button
                  key={`${sample.time}-${i}`}
                  type="button"
                  onFocus={() => setHoveredIdx(i + padded.length - samples.length)}
                  onBlur={() => setHoveredIdx(null)}
                  onClick={() => setHoveredIdx(i + padded.length - samples.length)}
                >
                  {describeSample(sample)}
                </button>
              ))}
            </div>

            {/* Y-axis labels */}
            <div className="flex justify-between mt-1 text-xs text-slate-500 select-none">
              <span>{new Date(samples[0]!.time).toLocaleTimeString()}</span>
              <span>{new Date(samples[samples.length - 1]!.time).toLocaleTimeString()}</span>
            </div>
          </>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-5 mt-3 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-emerald-400/75" />
          &lt; 500 ms
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-amber-400/75" />
          500–1500 ms
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-red-400/75" />
          &gt; 1500 ms
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm border border-red-500/50 bg-red-500/25" />
          Outage
        </span>
      </div>
    </div>
  );
}
