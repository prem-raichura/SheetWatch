// Chart scaling maths. Pure, no React, no DOM — so every edge case here is a
// unit test rather than something you notice in a screenshot.

export interface Scale {
  min: number;
  max: number;
  ticks: number[];
  /** Data value → y in plot coordinates (0 at the top). */
  y(value: number): number;
}

/** Round up to a 1 / 2 / 5 × 10ⁿ step, so axis labels read as round numbers. */
export function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * A zero-based scale. Every series on this dashboard is count-like — queue
 * depth, throughput, milliseconds — so a min-max stretch would exaggerate
 * noise and, for a flat series, collapse the line onto the floor. (That is
 * exactly the bug in the original KpiStrip sparkline.)
 */
export function linearScale(
  values: (number | null)[],
  height: number,
  opts: { zero?: boolean } = {}
): Scale {
  const real = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const zero = opts.zero ?? true;

  const dataMin = real.length ? Math.min(...real) : 0;
  const dataMax = real.length ? Math.max(...real) : 0;

  const min = zero ? Math.min(0, dataMin) : dataMin;

  // A flat series is stable, not empty. Nice-ceiling it normally would put the
  // line exactly on the top edge, where it reads as clipped, so a flat series
  // gets deliberate headroom and sits mid-plot. A varying series doesn't need
  // it — touching the top is what a maximum is supposed to look like.
  const flat = dataMax === dataMin;
  const max = flat
    ? dataMax <= min
      ? min + 1
      : min + niceCeil((dataMax - min) * 2)
    : min + niceCeil(dataMax - min);

  const span = max - min || 1;
  const ticks = [min, min + span / 2, max];

  return {
    min,
    max,
    ticks,
    y(value: number) {
      if (!Number.isFinite(value)) return height;
      const clamped = Math.min(max, Math.max(min, value));
      return height - ((clamped - min) / span) * height;
    },
  };
}

/**
 * SVG path segments for a series, one per gap-free run. A `null` bucket is a
 * hole in the data, so the line must break rather than bridge it — a bridge
 * would draw a worker outage as a smooth trend.
 */
export function pathFor(
  values: (number | null)[],
  x: (index: number) => number,
  y: (value: number) => number
): string[] {
  const runs: string[] = [];
  let current: string[] = [];

  values.forEach((value, i) => {
    if (value === null || !Number.isFinite(value)) {
      if (current.length > 1) runs.push(current.join(" "));
      current = [];
      return;
    }
    const px = x(i);
    const py = y(value);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return; // one NaN blanks a path
    current.push(`${current.length === 0 ? "M" : "L"}${px.toFixed(2)},${py.toFixed(2)}`);
  });

  if (current.length > 1) runs.push(current.join(" "));
  return runs;
}

/** Contiguous [start, end] index ranges where the series has no data. */
export function gapRanges(coverage: number[]): [number, number][] {
  const out: [number, number][] = [];
  let start: number | null = null;

  coverage.forEach((c, i) => {
    if (c === 0 && start === null) start = i;
    if (c !== 0 && start !== null) {
      out.push([start, i - 1]);
      start = null;
    }
  });
  if (start !== null) out.push([start, coverage.length - 1]);
  return out;
}
