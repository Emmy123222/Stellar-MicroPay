import React from "react";

export function BalanceSparkline({ data }: { data: number[] }) {
  const W = 160;
  const H = 40;
  const PAD = 4;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = PAD + (i / Math.max(data.length - 1, 1)) * (W - PAD * 2);
    const y = PAD + (1 - (v - min) / range) * (H - PAD * 2);
    return { x, y, value: v };
  });

  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");

  const trend = data[data.length - 1] >= data[0];
  const change = data[data.length - 1] - data[0];
  const color = trend ? "#22c55e" : "#ef4444";
  const fillColor = trend ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)";

  const fillPath =
    `M ${points[0].x},${H - PAD} ` +
    points.map((p) => `L ${p.x},${p.y}`).join(" ") +
    ` L ${points[points.length - 1].x},${H - PAD} Z`;

  return (
    <div className="relative inline-block">
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Balance trend: ${trend ? "upward" : "downward"}`}
      >
        <path d={fillPath} fill={fillColor} aria-hidden="true" />
        <polyline
          points={polyline}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          aria-hidden="true"
        />
        {points.map((p, i) => (
          <g key={i} className="group" aria-hidden="true">
            <circle
              cx={p.x}
              cy={p.y}
              r={5}
              fill="transparent"
              className="cursor-pointer"
            />
            <circle
              cx={p.x}
              cy={p.y}
              r={2.5}
              fill={color}
              className="opacity-0 group-hover:opacity-100 transition-opacity"
            />
            <foreignObject
              x={Math.min(p.x - 36, W - 76)}
              y={p.y < H / 2 ? p.y + 6 : p.y - 30}
              width={72}
              height={24}
              className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity overflow-visible"
            >
              <div
                className="bg-cosmos-900 border border-white/10 rounded px-1.5 py-0.5 text-xs text-white whitespace-nowrap text-center"
                style={{ fontSize: "10px" }}
              >
                {p.value >= 0 ? "+" : ""}
                {p.value.toFixed(4)} XLM
              </div>
            </foreignObject>
          </g>
        ))}
      </svg>
      <p className="text-xs mt-0.5" style={{ color, fontSize: "10px" }}>
        {trend ? "▲ Upward trend" : "▼ Downward trend"}: {change >= 0 ? "+" : ""}
        {change.toFixed(4)} XLM across {data.length} recent payments
      </p>
      <details className="mt-1 text-[10px] text-slate-300">
        <summary className="cursor-pointer text-stellar-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-stellar-400">
          View balance trend data
        </summary>
        <table className="mt-2 min-w-[160px] text-left">
          <thead>
            <tr>
              <th scope="col" className="pe-3">Payment</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {data.map((value, index) => (
              <tr key={index}>
                <th scope="row" className="pe-3 font-normal">{index + 1}</th>
                <td>{value >= 0 ? "+" : ""}{value.toFixed(4)} XLM</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
