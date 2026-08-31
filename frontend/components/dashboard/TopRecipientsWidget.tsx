import React from "react";
import { shortenAddress } from "@/utils/format";

export function TopRecipientsWidget({
  recipients,
  loading,
}: {
  recipients: Array<{ address: string; totalXLMSent: string }>;
  loading: boolean;
}) {
  return (
    <div className="card">
      <h2 className="font-display text-lg font-semibold text-white mb-4">Top Recipients</h2>
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-10 bg-white/5 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : recipients.length === 0 ? (
        <p className="text-sm text-slate-400">No sent payments yet.</p>
      ) : (
        <ol className="space-y-2">
          {recipients.map((r, idx) => (
            <li key={r.address} className="flex items-center justify-between gap-3 p-2 rounded-lg bg-white/[0.02] border border-white/5">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-stellar-400 w-5 text-center">{idx + 1}</span>
                <span className="font-mono text-sm text-slate-200">{shortenAddress(r.address)}</span>
              </div>
              <span className="text-sm font-semibold text-white">{parseFloat(r.totalXLMSent).toFixed(2)} XLM</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
