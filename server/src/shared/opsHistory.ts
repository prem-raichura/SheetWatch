import prisma from "./prisma";
import { dbNow, getStats } from "./adminStats";
import { BUCKET_MS, bucketStart, rollupBucket, type BeatRow, type CronRow } from "./opsRollup";

// Time series for the ops dashboard. One endpoint, one window, so every chart
// on the page is guaranteed to be talking about the same minutes.

export type HistoryRange = "1h" | "24h" | "7d";

export interface RangeSpec {
  range: HistoryRange;
  bucketMs: number;
  spanMs: number;
  /** Raw beats for the live tail; rollups (folded) for anything longer. */
  source: "beat" | "rollup";
  fold: number;
}

// Bucket size is derived from the range, never accepted from the client —
// otherwise "7d at 1m" is a 10,080-point request anyone can send.
export function rangeSpec(range: string | undefined): RangeSpec {
  switch (range) {
    case "1h":
      return { range: "1h", bucketMs: 60_000, spanMs: 3600_000, source: "beat", fold: 1 };
    case "7d":
      return {
        range: "7d",
        bucketMs: 30 * 60_000,
        spanMs: 7 * 86_400_000,
        source: "rollup",
        fold: 6,
      };
    default:
      // Unknown ranges fall back rather than throwing: a stale bookmark should
      // show a dashboard, not an error.
      return { range: "24h", bucketMs: BUCKET_MS, spanMs: 86_400_000, source: "rollup", fold: 1 };
  }
}

export type SeriesMap = Record<string, (number | null)[]>;

export interface HistoryReport {
  now: string;
  range: HistoryRange;
  bucketMs: number;
  t: string[];
  coverage: number[];
  series: SeriesMap;
  stacks: { notifications: { key: string; values: (number | null)[] }[] };
  distributions: {
    pollInterval: { label: string; value: number }[];
    freshness: { label: string; value: number }[];
    integrity: { label: string; value: number }[];
  };
  sources: Record<string, "beat" | "rollup" | "unavailable">;
}

/** Dense bucket starts covering [now - span, now), oldest first. */
export function bucketAxis(nowMs: number, spec: RangeSpec): number[] {
  const end = bucketStart(nowMs, spec.bucketMs) + spec.bucketMs;
  const count = Math.round(spec.spanMs / spec.bucketMs);
  return Array.from({ length: count }, (_, i) => end - (count - i) * spec.bucketMs);
}

/**
 * Place rows on the axis. Absent buckets are `null`, never 0 — an unobserved
 * queue and an empty queue must not look the same.
 */
export function denseFill<T>(
  axis: number[],
  rows: { at: number; value: T }[],
  bucketMs: number
): (T | null)[] {
  const byBucket = new Map<number, T>();
  for (const row of rows) byBucket.set(bucketStart(row.at, bucketMs), row.value);
  return axis.map((t) => {
    const hit = byBucket.get(t);
    return hit === undefined ? null : hit;
  });
}

export interface FoldableRow {
  beats: number;
  redisAvgMs: number | null;
  redisMaxMs: number | null;
  rssMaxMb: number | null;
  queueMaxWaiting: number | null;
  queueMaxFailed: number | null;
  checked: number | null;
  changed: number | null;
  failed: number | null;
  cronRuns: number;
  cronErrors: number;
  notifSent: number | null;
  notifFailed: number | null;
  notifQueued: number | null;
}

const sum = (values: (number | null)[]): number | null => {
  const real = values.filter((v): v is number => v !== null);
  return real.length ? real.reduce((a, b) => a + b, 0) : null;
};
const max = (values: (number | null)[]): number | null => {
  const real = values.filter((v): v is number => v !== null);
  return real.length ? Math.max(...real) : null;
};

/** Fold N adjacent rollup rows into one coarser bucket for the 7-day view. */
export function foldRows(rows: FoldableRow[]): FoldableRow {
  const beats = rows.reduce((a, r) => a + r.beats, 0);
  // Beats-weighted, so a bucket with two beats doesn't outvote one with ten.
  const weighted = (pick: (r: FoldableRow) => number | null): number | null => {
    let total = 0;
    let weight = 0;
    for (const r of rows) {
      const v = pick(r);
      if (v === null || r.beats === 0) continue;
      total += v * r.beats;
      weight += r.beats;
    }
    return weight ? Math.round(total / weight) : null;
  };

  return {
    beats,
    redisAvgMs: weighted((r) => r.redisAvgMs),
    redisMaxMs: max(rows.map((r) => r.redisMaxMs)),
    rssMaxMb: max(rows.map((r) => r.rssMaxMb)),
    queueMaxWaiting: max(rows.map((r) => r.queueMaxWaiting)),
    queueMaxFailed: max(rows.map((r) => r.queueMaxFailed)),
    checked: sum(rows.map((r) => r.checked)),
    changed: sum(rows.map((r) => r.changed)),
    failed: sum(rows.map((r) => r.failed)),
    cronRuns: rows.reduce((a, r) => a + r.cronRuns, 0),
    cronErrors: rows.reduce((a, r) => a + r.cronErrors, 0),
    notifSent: sum(rows.map((r) => r.notifSent)),
    notifFailed: sum(rows.map((r) => r.notifFailed)),
    notifQueued: sum(rows.map((r) => r.notifQueued)),
  };
}

const EMPTY_FOLD: FoldableRow = {
  beats: 0,
  redisAvgMs: null,
  redisMaxMs: null,
  rssMaxMb: null,
  queueMaxWaiting: null,
  queueMaxFailed: null,
  checked: null,
  changed: null,
  failed: null,
  cronRuns: 0,
  cronErrors: 0,
  notifSent: null,
  notifFailed: null,
  notifQueued: null,
};

// Per-lambda, best-effort, keyed by range. The underlying rollup only moves
// every five minutes, so a two-minute memo on the long ranges is free. (On
// Vercel each warm container keeps its own, so numbers can differ slightly
// between refreshes — same trade-off statsMemo already makes.)
const memo = new Map<string, { at: number; value: HistoryReport }>();
const TTL: Record<HistoryRange, number> = { "1h": 30_000, "24h": 120_000, "7d": 120_000 };

export async function getHistory(rangeParam?: string): Promise<HistoryReport> {
  const spec = rangeSpec(rangeParam);
  const hit = memo.get(spec.range);
  if (hit && Date.now() - hit.at < TTL[spec.range]) return hit.value;

  // The axis is anchored to the database clock, never Date.now() in a lambda —
  // three different machines write the timestamps being placed on it.
  const now = await dbNow();
  const axis = bucketAxis(now.getTime(), spec);
  const from = new Date(axis[0]);

  let rows: FoldableRow[] = [];
  let coverage: number[] = [];

  if (spec.source === "beat") {
    // Live tail: bucket the raw beats directly, so the last hour is current to
    // the second rather than to the last completed five-minute rollup.
    const [beats, cron] = await prisma.$transaction([
      prisma.opsHeartbeat.findMany({
        where: { source: "worker", createdAt: { gte: from } },
        orderBy: { createdAt: "asc" },
        select: { status: true, createdAt: true, version: true, data: true },
      }),
      prisma.opsHeartbeat.findMany({
        where: { source: { startsWith: "cron:" }, createdAt: { gte: from } },
        orderBy: { createdAt: "asc" },
        select: { source: true, status: true, createdAt: true, data: true },
      }),
    ]);

    let carried: BeatRow | null = null;
    const built = axis.map((start) => {
      const end = start + spec.bucketMs;
      const inBucket = beats.filter(
        (b) => b.createdAt.getTime() >= start && b.createdAt.getTime() < end
      ) as BeatRow[];
      const cronIn = cron.filter(
        (c) => c.createdAt.getTime() >= start && c.createdAt.getTime() < end
      );
      const values = rollupBucket(inBucket, cronIn as CronRow[], carried);
      const last = inBucket.filter((b) => b.status !== "stopped").pop();
      if (last) carried = last;
      return { ...EMPTY_FOLD, ...values };
    });
    rows = built;
    coverage = built.map((r) => r.beats);
  } else {
    const stored = await prisma.opsRollup.findMany({
      where: { bucketStart: { gte: from } },
      orderBy: { bucketStart: "asc" },
    });

    if (spec.fold === 1) {
      const placed = denseFill(
        axis,
        stored.map((r) => ({ at: r.bucketStart.getTime(), value: r as FoldableRow })),
        spec.bucketMs
      );
      rows = placed.map((r) => r ?? EMPTY_FOLD);
      coverage = placed.map((r) => r?.beats ?? 0);
    } else {
      // Fold the 5-minute rows into the coarser axis.
      rows = axis.map((start) => {
        const end = start + spec.bucketMs;
        const inBucket = stored.filter(
          (r) => r.bucketStart.getTime() >= start && r.bucketStart.getTime() < end
        ) as FoldableRow[];
        return inBucket.length ? foldRows(inBucket) : EMPTY_FOLD;
      });
      coverage = rows.map((r) => r.beats);
    }
  }

  // A bucket nobody observed reports nothing at all. Without this the charts
  // would draw a worker outage as a queue that emptied itself.
  const observed = <T>(values: (T | null)[]): (T | null)[] =>
    values.map((v, i) => (coverage[i] === 0 ? null : v));

  const stats = await getStats().catch(() => null);

  const report: HistoryReport = {
    now: now.toISOString(),
    range: spec.range,
    bucketMs: spec.bucketMs,
    t: axis.map((t) => new Date(t).toISOString()),
    coverage,
    series: {
      queueWaiting: observed(rows.map((r) => r.queueMaxWaiting)),
      queueFailed: observed(rows.map((r) => r.queueMaxFailed)),
      redisMs: observed(rows.map((r) => r.redisAvgMs)),
      rssMb: observed(rows.map((r) => r.rssMaxMb)),
      checked: rows.map((r) => r.checked),
      changed: rows.map((r) => r.changed),
      failed: rows.map((r) => r.failed),
      cronRuns: rows.map((r) => (r.cronRuns === 0 ? null : r.cronRuns)),
      cronErrors: rows.map((r) => (r.cronRuns === 0 ? null : r.cronErrors)),
    },
    stacks: {
      notifications: [
        { key: "sent", values: rows.map((r) => r.notifSent) },
        { key: "queued", values: rows.map((r) => r.notifQueued) },
        { key: "failed", values: rows.map((r) => r.notifFailed) },
      ],
    },
    // Point-in-time shape, from the memoized stats — so a histogram can never
    // disagree with the Polling card beside it.
    distributions: {
      pollInterval: (stats?.polling.byInterval ?? []).map((i) => ({
        label: i.pollInterval < 3600 ? `${i.pollInterval / 60}m` : `${i.pollInterval / 3600}h`,
        value: i.count,
      })),
      freshness: Object.entries(stats?.polling.buckets ?? {}).map(([label, value]) => ({
        label,
        value,
      })),
      integrity: stats
        ? [
            { label: "on time", value: Math.max(0, stats.integrity.enabled - stats.integrity.due - stats.integrity.overdue - stats.integrity.never) },
            { label: "due", value: stats.integrity.due },
            { label: "overdue", value: stats.integrity.overdue },
            { label: "never", value: stats.integrity.never },
          ]
        : [],
    },
    sources: {
      queues: coverage.some((c) => c > 0) ? spec.source : "unavailable",
      throughput: rows.some((r) => r.checked !== null) ? spec.source : "unavailable",
      notifications: rows.some((r) => r.notifSent !== null) ? spec.source : "unavailable",
    },
  };

  memo.set(spec.range, { at: Date.now(), value: report });
  return report;
}
