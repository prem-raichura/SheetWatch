import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { gapRanges, linearScale, type Scale } from "../../lib/scale";

// Chart frame for the ops dashboard. Imports React and local files only —
// anything from components/ would drag motion (and with it ~85 KB) into a page
// whose whole point is loading instantly when something is already broken.

// Pixel geometry, not viewBox units: the SVG is drawn at its measured width so
// every chart is the SAME height whatever column it sits in. Aspect-ratio
// scaling made a two-thirds card twice as tall as a one-third card, which is
// what left those slabs of empty space beside the shorter ones.
export const PLOT = { h: 190, padL: 38, padR: 10, padT: 12, padB: 20 };

/** Container width, measured. Falls back to a sane default before first paint. */
function useMeasuredWidth<T extends HTMLElement>(fallback = 720) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => setWidth(Math.max(240, Math.round(el.getBoundingClientRect().width)));
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

export interface SeriesSpec {
  key: string;
  label: string;
  color: string; // a CSS var string — SVG paint, not a Tailwind class
  values: (number | null)[];
}

export interface ChartProps {
  series: SeriesSpec[];
  /** ISO bucket starts, aligned to every series. */
  t: string[];
  /** Beats per bucket; 0 marks an unobserved stretch. */
  coverage?: number[];
  height?: number;
  unit?: string;
  zero?: boolean;
  format?: (value: number) => string;
  children?: (ctx: ChartContext) => ReactNode;
}

export interface ChartContext {
  scale: Scale;
  x: (index: number) => number;
  band: number;
  inner: { w: number; h: number };
  hover: number | null;
}

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function Chart({
  series,
  t,
  coverage,
  height = PLOT.h,
  unit = "",
  zero = true,
  format = (v) => v.toLocaleString(),
  children,
}: ChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const [wrapRef, plotW] = useMeasuredWidth<HTMLDivElement>();

  const innerW = plotW - PLOT.padL - PLOT.padR;
  const innerH = height - PLOT.padT - PLOT.padB;
  const n = t.length;

  // Every series shares one axis — no stacking, no second scale.
  const scale = linearScale(
    series.flatMap((s) => s.values),
    innerH,
    { zero }
  );
  const band = n > 0 ? innerW / n : innerW;
  const x = (i: number) => PLOT.padL + (n > 1 ? (i / (n - 1)) * innerW : innerW / 2);

  const gaps = coverage ? gapRanges(coverage) : [];
  const drawn = series.filter((s) => s.values.some((v) => v !== null));

  if (n === 0) {
    return (
      <div className="flex h-32 items-center justify-center font-mono text-xs text-ink-300">
        — no data in this window
      </div>
    );
  }

  const fallbackTable = useMemo(
    () => (
      <table>
        <caption>{drawn.map((s) => s.label).join(", ")} by time</caption>
        <thead>
          <tr>
            <th>time</th>
            {drawn.map((s) => (
              <th key={s.key}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.map((time, i) => (
            <tr key={time}>
              <td>{time}</td>
              {drawn.map((s) => (
                <td key={s.key}>{s.values[i] === null ? "no data" : s.values[i]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    ),
    [t, drawn]
  );

  const move = (event: React.PointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    setHover(Math.min(n - 1, Math.max(0, Math.round(ratio * (n - 1)))));
  };

  const key = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setHover((prev) => {
      const next = (prev ?? n - 1) + (event.key === "ArrowRight" ? 1 : -1);
      return Math.min(n - 1, Math.max(0, next));
    });
  };

  return (
    <div ref={wrapRef} className="relative">
      <svg
        width={plotW}
        height={height}
        viewBox={`0 0 ${plotW} ${height}`}
        className="block outline-hidden focus-visible:ring-2 focus-visible:ring-teal/40"
        role="img"
        aria-label={`${drawn.map((s) => s.label).join(", ")} over time`}
        tabIndex={0}
        onKeyDown={key}
        onBlur={() => setHover(null)}
      >
        {/* Gridlines + y labels */}
        {scale.ticks.map((tick, i) => {
          const y = PLOT.padT + scale.y(tick);
          return (
            <g key={i}>
              <line
                x1={PLOT.padL}
                x2={plotW - PLOT.padR}
                y1={y}
                y2={y}
                stroke="var(--border)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <text x={4} y={y + 3} className="fill-ink-400" fontSize={9} fontFamily="JetBrains Mono, monospace">
                {format(tick)}
              </text>
            </g>
          );
        })}

        {/* Unobserved stretches: hatched, never drawn as zero. */}
        <defs>
          <pattern id="ops-gap" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--border)" strokeWidth="2" />
          </pattern>
        </defs>
        {gaps.map(([from, to]) => (
          <rect
            key={`${from}-${to}`}
            x={x(from)}
            y={PLOT.padT}
            width={Math.max(2, x(to) - x(from) + band)}
            height={innerH}
            fill="url(#ops-gap)"
            opacity={0.5}
          >
            <title>no worker beats in this window</title>
          </rect>
        ))}

        {children?.({ scale, x, band, inner: { w: innerW, h: innerH }, hover })}

        {/* Time axis: first, middle, last only — more collides. */}
        {[0, Math.floor(n / 2), n - 1].map((i) => (
          <text
            key={i}
            x={x(i)}
            y={height - 4}
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
            className="fill-ink-400"
            fontSize={9}
            fontFamily="JetBrains Mono, monospace"
          >
            {timeLabel(t[i])}
          </text>
        ))}

        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={PLOT.padT}
            y2={PLOT.padT + innerH}
            stroke="var(--text-faint)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}

        <rect
          x={PLOT.padL}
          y={PLOT.padT}
          width={innerW}
          height={innerH}
          fill="transparent"
          onPointerMove={move}
          onPointerLeave={() => setHover(null)}
        />
      </svg>

      {/* Legend: identity is never colour alone. */}
      {series.length > 1 && (
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {series.map((s) => {
            const empty = !s.values.some((v) => v !== null);
            return (
              <li
                key={s.key}
                className={`flex items-center gap-1.5 font-mono text-[11px] ${
                  empty ? "text-ink-300" : "text-ink-500"
                }`}
              >
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-[2px]"
                  style={{ background: empty ? "var(--border)" : s.color }}
                  aria-hidden
                />
                {s.label}
                {hover !== null && (
                  <span className="text-ink-700">
                    {s.values[hover] === null ? "—" : format(s.values[hover] as number)}
                    {unit}
                  </span>
                )}
                {empty && <span>—</span>}
              </li>
            );
          })}
        </ul>
      )}

      {series.length === 1 && hover !== null && (
        <p className="mt-1 font-mono text-[11px] text-ink-500">
          {timeLabel(t[hover])} ·{" "}
          <span className="text-ink-900">
            {series[0].values[hover] === null ? "—" : format(series[0].values[hover] as number)}
            {unit}
          </span>
        </p>
      )}

      {/* The real accessible fallback: the numbers, not a description of them.
          The wrapper carries sr-only, not the table — `height: 1px` does not
          constrain a display:table element, so an sr-only <table> stays its
          full height and adds thousands of pixels of empty page scroll.
          Memoised because the page re-renders every 5s for the live vitals and
          this is hundreds of rows per chart. */}
      <div className="sr-only">{fallbackTable}</div>

    </div>
  );
}
