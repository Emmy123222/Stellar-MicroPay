/**
 * components/CreatorTipsDashboard.tsx
 * Dashboard component for creators to view tips received.
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { formatXLM, shortenAddress, formatUSD } from "@/utils/format";

interface TipRecord {
  id: number;
  senderPublicKey: string;
  creatorPublicKey: string;
  amount: string;
  asset: string;
  memo: string;
  txHash: string;
  timestamp: string;
}

interface TipsStats {
  totalTips: number;
  totalByAsset: Record<string, { count: number; amount: string }>;
  averageTip: string | null;
  largestTip: string | null;
  smallestTip: string | null;
}

interface CreatorTipsDashboardProps {
  publicKey: string;
  username?: string | null;
  xlmPrice?: number | null;
}

export default function CreatorTipsDashboard({
  publicKey,
  username,
  xlmPrice,
}: CreatorTipsDashboardProps) {
  const [tips, setTips] = useState<TipRecord[]>([]);
  const [stats, setStats] = useState<TipsStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 10;

  useEffect(() => {
    fetchTips();
  }, [fetchTips, page]);


  const fetchTips = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
      
      // Fetch tips received
      const tipsResponse = await fetch(
        `${apiBase}/api/tips/received/${encodeURIComponent(publicKey)}?limit=${pageSize}&offset=${page * pageSize}`
      );
      
      if (!tipsResponse.ok) {
        throw new Error("Failed to load tips");
      }
      
      const tipsPayload = await tipsResponse.json();
      
      if (tipsPayload?.success) {
        setTips(tipsPayload.data.tips || []);
        setStats(tipsPayload.data.stats || null);
      } else {
        setTips([]);
      }
    } catch (err) {
      console.error("Error fetching tips:", err);
      setError("Unable to load tips. Make sure you have a registered username.");
      setTips([]);
    } finally {
      setLoading(false);
    }
  }, [publicKey, page]);


  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getTotalXLMReceived = () => {
    if (!stats?.totalByAsset?.XLM) return "0";
    return stats.totalByAsset.XLM.amount;
  };

  if (!username) {
    return (
      <div className="card border-amber-500/20 bg-amber-500/5">
        <div className="text-center py-6">
          <div className="mx-auto w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4">
            <UserIcon className="w-6 h-6 text-amber-400" />
          </div>
          <h3 className="font-display text-lg font-semibold text-white mb-2">
            Set Up Your Creator Profile
          </h3>
          <p className="text-sm text-slate-400 mb-4">
            Register a username to enable public tip pages and track tips received.
          </p>
          <Link
            href="/settings"
            className="inline-flex items-center gap-2 bg-stellar-500 hover:bg-stellar-600 text-white font-medium text-sm py-2 px-4 rounded-lg transition-colors"
          >
            <UserIcon className="w-4 h-4" />
            Register Username
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card bg-gradient-to-br from-stellar-500/10 to-transparent border-stellar-500/20">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500 mb-1">
            Total Tips Received
          </p>
          <p className="font-display text-2xl font-bold text-white">
            {stats?.totalTips ?? 0}
          </p>
        </div>

        <div className="card bg-gradient-to-br from-emerald-500/10 to-transparent border-emerald-500/20">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500 mb-1">
            Total XLM Received
          </p>
          <p className="font-display text-2xl font-bold text-white">
            {getTotalXLMReceived()}
            <span className="text-stellar-400 text-lg ml-1">XLM</span>
          </p>
          {xlmPrice && parseFloat(getTotalXLMReceived()) > 0 && (
            <p className="text-xs text-emerald-400 mt-1">
              ≈ {formatUSD(parseFloat(getTotalXLMReceived()) * xlmPrice)}
            </p>
          )}
        </div>

        <div className="card bg-gradient-to-br from-violet-500/10 to-transparent border-violet-500/20">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500 mb-1">
            Average Tip
          </p>
          <p className="font-display text-2xl font-bold text-white">
            {stats?.averageTip ? parseFloat(stats.averageTip).toFixed(2) : "0"}
            <span className="text-stellar-400 text-lg ml-1">XLM</span>
          </p>
        </div>
      </div>

      {/* Share Tip Page Link */}
      <div className="card border-stellar-500/20 bg-stellar-500/5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h3 className="font-display text-lg font-semibold text-white">
              Your Public Tip Page
            </h3>
            <p className="text-sm text-slate-400">
              Share this link with your fans to receive tips
            </p>
          </div>
          <div className="flex items-center gap-2">
            <code className="text-sm text-stellar-300 bg-cosmos-950 px-3 py-2 rounded-lg border border-white/10">
              {typeof window !== "undefined" ? window.location.origin : ""}/tip/{username}
            </code>
            <button
              onClick={() => {
                const url = `${window.location.origin}/tip/${username}`;
                navigator.clipboard.writeText(url);
              }}
              className="p-2 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-white/5"
              title="Copy link"
            >
              <CopyIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Tips History */}
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-display text-lg font-semibold text-white">
            Tips Received
          </h3>
          <button
            onClick={fetchTips}
            className="text-xs text-stellar-400 hover:text-stellar-300 transition-colors flex items-center gap-1"
          >
            <RefreshIcon className="w-3 h-3" />
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-white/5 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <p className="text-amber-400 text-sm">{error}</p>
          </div>
        ) : tips.length === 0 ? (
          <div className="text-center py-8">
            <div className="mx-auto w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mb-3">
              <GiftIcon className="w-6 h-6 text-slate-500" />
            </div>
            <p className="text-slate-400 text-sm">No tips received yet</p>
            <p className="text-xs text-slate-500 mt-1">
              Share your tip page to start receiving tips!
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {tips.map((tip) => (
                <div
                  key={tip.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/5 hover:border-stellar-500/20 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-stellar-500/10 border border-stellar-500/20 flex items-center justify-center">
                      <GiftIcon className="w-5 h-5 text-stellar-400" />
                    </div>
                    <div>
                      <p className="text-sm text-white font-medium">
                        {tip.amount} {tip.asset}
                      </p>
                      <p className="text-xs text-slate-500">
                        From: {shortenAddress(tip.senderPublicKey)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-500">
                      {formatTimestamp(tip.timestamp)}
                    </p>
                    {tip.memo && (
                      <p className="text-xs text-slate-400 mt-1 max-w-[200px] truncate">
                        &quot;{tip.memo}&quot;
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {stats && stats.totalTips > pageSize && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="text-sm text-stellar-400 hover:text-stellar-300 disabled:text-slate-600 disabled:cursor-not-allowed transition-colors"
                >
                  ← Previous
                </button>
                <span className="text-xs text-slate-500">
                  Page {page + 1} of {Math.ceil(stats.totalTips / pageSize)}
                </span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={(page + 1) * pageSize >= stats.totalTips}
                  className="text-sm text-stellar-400 hover:text-stellar-300 disabled:text-slate-600 disabled:cursor-not-allowed transition-colors"
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Icons
function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
    </svg>
  );
}

function GiftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.25v8.25a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 109.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1114.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
    </svg>
  );
}