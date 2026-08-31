import React from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

export interface MonthlyVolumePoint {
  month: string;
  label?: string;
  sent: number;
  received: number;
}

export interface DailyVolumePoint {
  day: string;
  sent: number;
  received: number;
}

function formatXlm(value: number) {
  return `${value.toFixed(2)} XLM`;
}

function DataDisclosure({
  label,
  headings,
  rows,
}: {
  label: string;
  headings: string[];
  rows: Array<Array<string>>;
}) {
  return (
    <details className="mt-4 text-sm text-slate-300">
      <summary className="w-fit cursor-pointer rounded text-stellar-400 hover:text-stellar-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-stellar-400">
        {label}
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              {headings.map((heading) => (
                <th key={heading} scope="col" className="border-b border-white/10 px-3 py-2 font-medium text-slate-200">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`${row[0]}-${rowIndex}`}>
                {row.map((cell, cellIndex) =>
                  cellIndex === 0 ? (
                    <th key={cellIndex} scope="row" className="border-b border-white/5 px-3 py-2 font-normal">
                      {cell}
                    </th>
                  ) : (
                    <td key={cellIndex} className="border-b border-white/5 px-3 py-2">
                      {cell}
                    </td>
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function MonthlySpendingChart({
  data,
  loading,
  onBarClick,
}: {
  data: MonthlyVolumePoint[];
  loading: boolean;
  onBarClick: (data: any) => void;
}) {
  if (loading && data.length === 0) {
    return (
      <div className="card mb-6 h-[350px] animate-pulse bg-white/[0.03] border-white/10" />
    );
  }

  const totalSent = data.reduce((total, point) => total + point.sent, 0);
  const peak = data.reduce<MonthlyVolumePoint | null>(
    (highest, point) => (!highest || point.sent > highest.sent ? point : highest),
    null
  );
  const summary = data.length === 0
    ? "No monthly spending recorded for this period."
    : `${formatXlm(totalSent)} sent across ${data.length} months. Highest spending was ${formatXlm(peak?.sent ?? 0)} in ${peak?.label ?? peak?.month}.`;

  return (
    <div className="card mb-6 overflow-hidden">
      <h2 className="font-display text-lg font-semibold text-white mb-6">
        Monthly Spending (XLM)
      </h2>
      <p className="mb-4 text-sm text-slate-300">{summary}</p>
      <div className="h-[250px] w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            onClick={(state: any) =>
              state &&
              state.activePayload &&
              onBarClick(state.activePayload[0].payload)
            }
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
            <XAxis
              dataKey="month"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#94a3b8", fontSize: 12 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#94a3b8", fontSize: 12 }}
              tickFormatter={(value: any) => `${value}`}
            />
            <Tooltip
              cursor={{ fill: "rgba(255, 255, 255, 0.05)" }}
              contentStyle={{
                backgroundColor: "#0f172a",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "8px",
              }}
              itemStyle={{ color: "#38bdf8" }}
            />
            <Bar dataKey="sent" fill="#38bdf8" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataDisclosure
        label="View monthly spending data"
        headings={["Month", "Sent", "Received"]}
        rows={data.map((point) => [
          point.label ?? point.month,
          formatXlm(point.sent),
          formatXlm(point.received),
        ])}
      />
    </div>
  );
}

export function ThirtyDayVolumeChart({ data, loading }: { data: DailyVolumePoint[]; loading: boolean }) {
  if (loading && data.length === 0) {
    return <div className="card mb-6 h-[280px] animate-pulse bg-white/[0.03] border-white/10" />;
  }
  const visibleData = data.filter((_, i: number) => i % 5 === 0 || i === data.length - 1);
  const totalSent = data.reduce((total, point) => total + point.sent, 0);
  const totalReceived = data.reduce((total, point) => total + point.received, 0);
  const net = totalReceived - totalSent;
  const summary = data.length === 0
    ? "No payment volume recorded in the last 30 days."
    : `${formatXlm(totalSent)} sent and ${formatXlm(totalReceived)} received. Net flow was ${net >= 0 ? "in" : "out"} ${formatXlm(Math.abs(net))}.`;
  return (
    <div className="card mb-6 overflow-hidden">
      <h2 className="font-display text-lg font-semibold text-white mb-6">30-Day Volume (XLM)</h2>
      <p className="mb-4 text-sm text-slate-300">{summary}</p>
      <div className="h-[220px] w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
            <XAxis
              dataKey="day"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#94a3b8", fontSize: 11 }}
              ticks={visibleData.map((d: any) => d.day)}
              interval="preserveStartEnd"
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#94a3b8", fontSize: 11 }}
            />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.05)" }}
              contentStyle={{ backgroundColor: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }}
              itemStyle={{ color: "#38bdf8" }}
            />
            <Bar dataKey="sent" fill="#38bdf8" name="Sent" radius={[3, 3, 0, 0]} />
            <Bar dataKey="received" fill="#34d399" name="Received" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataDisclosure
        label="View 30-day volume data"
        headings={["Day", "Sent", "Received"]}
        rows={data.map((point) => [
          point.day,
          formatXlm(point.sent),
          formatXlm(point.received),
        ])}
      />
    </div>
  );
}
