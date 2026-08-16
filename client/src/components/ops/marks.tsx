import { linearScale, pathFor } from "../../lib/scale";
import { PLOT, type ChartContext, type SeriesSpec } from "./Chart";

// Marks that render inside a Chart frame. Every time series on this dashboard
// is a line: one shape to read, one axis, and stacking never hides a series
// behind another. Imports React and local files only.

export function Lines({
  ctx,
  series,
  area = false,
}: {
  ctx: ChartContext;
  series: SeriesSpec[];
  /** A soft fill under a single series. Never used for more than one — two
      overlapping fills read as a stack that isn't one. */
  area?: boolean;
}) {
  const { scale, x, inner } = ctx;
  const y = (v: number) => PLOT.padT + scale.y(v);
  const fill = area && series.length === 1;

  return (
    <>
      {series.map((s) => {
        const runs = pathFor(s.values, x, y);
        const last = lastIndex(s.values);
        return (
          <g key={s.key}>
            {fill &&
              runs.map((d, i) => {
                // Close each run to the baseline separately: a gap must stay a
                // gap rather than being filled across.
                const firstX = d.slice(1).split(" ")[0].split(",")[0];
                const lastX = (d.split(" ").pop() ?? "").slice(1).split(",")[0];
                const base = PLOT.padT + inner.h;
                return (
                  <path
                    key={i}
                    d={`${d} L${lastX},${base} L${firstX},${base} Z`}
                    fill={s.color}
                    opacity={0.12}
                  />
                );
              })}
            {runs.map((d, i) => (
              <path
                key={i}
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth={1.75}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {/* Direct end-of-line dot: identity without relying on colour, which
                the CVD check requires for the teal/magenta pair. */}
            {last !== null && (
              <circle cx={x(last)} cy={y(s.values[last] as number)} r={2.5} fill={s.color} />
            )}

            {ctx.hover !== null && s.values[ctx.hover] !== null && (
              <circle
                cx={x(ctx.hover)}
                cy={y(s.values[ctx.hover] as number)}
                r={3.5}
                fill={s.color}
                stroke="var(--card)"
                strokeWidth={2}
              />
            )}
          </g>
        );
      })}
    </>
  );
}

function lastIndex(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return i;
  return null;
}

/**
 * Compact sparkline for a live vital — no axis, no labels, just the shape of
 * the last minute or two beside the number it belongs to.
 */
export function Sparkline({
  values,
  color = "var(--series-1)",
  width = 120,
  height = 30,
}: {
  values: (number | null)[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const scale = linearScale(values, height - 4);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const runs = pathFor(values, (i) => i * step, (v) => 2 + scale.y(v));

  if (runs.length === 0) {
    return (
      <svg width={width} height={height} className="shrink-0" aria-hidden>
        <line
          x1={0}
          x2={width}
          y1={height / 2}
          y2={height / 2}
          stroke="var(--border)"
          strokeDasharray="3 3"
          strokeWidth={1}
        />
      </svg>
    );
  }

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0" aria-hidden>
      {runs.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

/**
 * Distributions are categorical, so they stay readouts rather than charts —
 * a line across unordered buckets would imply a trend that isn't there.
 */
export function MeterRows({
  bins,
  color = "var(--series-1)",
}: {
  bins: { label: string; value: number }[];
  color?: string;
}) {
  if (bins.length === 0) return <p className="font-mono text-xs text-ink-300">—</p>;
  const max = Math.max(1, ...bins.map((b) => b.value));

  return (
    <ul className="space-y-1.5">
      {bins.map((bin) => (
        <li key={bin.label} className="flex items-center gap-2">
          <span className="w-20 shrink-0 truncate font-mono text-[11px] text-ink-500">{bin.label}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${Math.max(bin.value === 0 ? 0 : 3, (bin.value / max) * 100)}%`,
                background: color,
              }}
            />
          </span>
          <span className="w-8 shrink-0 text-right font-mono text-[11px] text-ink-700">{bin.value}</span>
        </li>
      ))}
    </ul>
  );
}
