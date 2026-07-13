interface Props {
  daily: { date: string; count: number }[];
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// 7-day change volume as inline SVG bars — no chart lib.
export default function ActivityChart({ daily }: Props) {
  const max = Math.max(1, ...daily.map((d) => d.count));
  const barW = 28;
  const gap = 18;
  const height = 72;
  const width = daily.length * (barW + gap) - gap;

  return (
    <div className="rounded-2xl border border-line bg-surface px-5 py-4 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-bold text-ink-900">Last 7 days</h2>
        <span className="font-mono text-[11px] text-ink-400">
          {daily.reduce((n, d) => n + d.count, 0)} changes
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height + 18}`}
        className="mt-3 w-full max-w-sm"
        role="img"
        aria-label="Changes per day over the last 7 days"
      >
        {daily.map((d, i) => {
          const h = d.count === 0 ? 2 : Math.max(4, (d.count / max) * height);
          const x = i * (barW + gap);
          const isToday = i === daily.length - 1;
          return (
            <g key={d.date}>
              <rect
                x={x}
                y={height - h}
                width={barW}
                height={h}
                rx={3}
                fill={d.count === 0 ? "var(--border)" : "var(--primary)"}
                opacity={d.count === 0 ? 1 : isToday ? 1 : 0.55}
              >
                <title>{`${d.date}: ${d.count} change${d.count !== 1 ? "s" : ""}`}</title>
              </rect>
              <text
                x={x + barW / 2}
                y={height + 13}
                textAnchor="middle"
                className="fill-ink-400"
                fontSize={9}
                fontFamily="JetBrains Mono, monospace"
              >
                {DAY[new Date(`${d.date}T00:00:00`).getDay()]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
