/**
 * components/FeeHistorySparkline.tsx
 * Sparkline chart showing network fee trends over 24 hours.
 */

import { useState, useEffect } from "react";
import { LineChart, Line, Tooltip, ResponsiveContainer } from "recharts";

interface FeeDataPoint {
  timestamp: string;
  fee: number;
}

interface FeeHistorySparklineProps {
  className?: string;
}

export default function FeeHistorySparkline({ className = "" }: FeeHistorySparklineProps) {
  const [feeHistory, setFeeHistory] = useState<FeeDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchFeeHistory = async () => {
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
        const response = await fetch(`${apiBase}/api/network/fee-history`);
        
        if (!response.ok) {
          throw new Error("Failed to fetch fee history");
        }

        const payload = await response.json();
        if (payload?.success && Array.isArray(payload?.data)) {
          setFeeHistory(payload.data);
        }
      } catch (err) {
        console.error("Error fetching fee history:", err);
        setError(err instanceof Error ? err.message : "Failed to load fee history");
      } finally {
        setLoading(false);
      }
    };

    fetchFeeHistory();
  }, []);

  // Convert stroops to XLM for display
  const chartData = feeHistory.map((point) => ({
    time: new Date(point.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    fee: point.fee / 10_000_000, // Convert stroops to XLM
    timestamp: point.timestamp,
  }));

  if (loading) {
    return (
      <div className={`h-16 flex items-center justify-center ${className}`}>
        <div className="w-4 h-4 border-2 border-stellar-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || chartData.length === 0) {
    return (
      <div className={`h-16 flex items-center justify-center text-slate-400 text-sm ${className}`}>
        {error || "No fee data available"}
      </div>
    );
  }

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={64}>
        <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <Line
            type="monotone"
            dataKey="fee"
            stroke="#7c3aed"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: "#7c3aed" }}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const data = payload[0].payload as FeeDataPoint & { time: string };
                return (
                  <div className="bg-slate-800 border border-slate-600 rounded-lg px-2 py-1 text-xs text-white shadow-lg">
                    <div className="font-semibold">{data.time}</div>
                    <div>{data.fee.toFixed(7)} XLM</div>
                  </div>
                );
              }
              return null;
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
