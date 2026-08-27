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
  const color = trend ? "#22c55e" : "#ef4444";
  const fillColor = trend ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)";

  const fillPath =
    `M ${points[0].x},${H - PAD} ` +
    points.map((p) => `L ${p.x},${p.y}`).join(" ") +
    ` L ${points[points.length - 1].x},${H - PAD} Z`;

  return (
    <div className="relative inline-block" aria-label="Balance sparkline chart">
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Balance trend: ${trend ? "upward" : "downward"}`}
      >
        <path d={fillPath} fill={fillColor} />
        <polyline
          points={polyline}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((p, i) => (
          <g key={i} className="group">
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
        {trend ? "▲ Upward trend" : "▼ Downward trend"}
      </p>
    </div>
  );
}
