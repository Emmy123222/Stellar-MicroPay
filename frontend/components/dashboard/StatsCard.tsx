import React from "react";

export function StatsCard({
  label,
  value,
  helper,
  delta,
  deltaType = "neutral",
}: {
  label: string;
  value: string;
  helper: string;
  delta?: number;
  deltaType?: "positive" | "negative" | "neutral";
}) {
  const isPos = deltaType === "positive";
  const isNeg = deltaType === "negative";
  const deltaColor = isPos ? "text-emerald-400 bg-emerald-500/10" : isNeg ? "text-rose-400 bg-rose-500/10" : "text-slate-400 bg-slate-500/10";

  return (
    <div className="card border-white/10 bg-white/[0.03] relative overflow-hidden flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="label">{label}</p>
          {typeof delta === "number" && (
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${deltaColor}`}>
              {delta >= 0 ? "+" : ""}{delta}%
            </span>
          )}
        </div>
        <p className="font-display text-2xl font-bold text-white">{value}</p>
      </div>
      <p className="text-xs text-slate-400 mt-2">{helper}</p>
    </div>
  );
}

export function formatStatsXLM(amount: string, suffix = "sent") {
  const value = parseFloat(amount);

  if (Number.isNaN(value)) return `0.00 XLM ${suffix}`;

  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
  })} XLM ${suffix}`;
}
