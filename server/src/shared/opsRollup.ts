import prisma from "./prisma";

// Five-minute rollups of OpsHeartbeat. Raw beats keep a 24h retention; these
// keep 7 days, which is what lets the dashboard chart a week for ~2000 rows.
//
// THE RULE THAT MAKES THIS SAFE: a rollup is a pure recompute of the raw rows
// in its bucket, written with upsert — never an increment. Two maintenance
// passes racing, or one running three times, converge on the same row. Nothing
// here may use `increment:`.

// `changed` is not read from ChangeLog: poll.ts writes exactly one ChangeLog
// row per poll that detected a change, which is the same event the work
// counter and the cron payload already count. One source, no extra scan.
export const BUCKET_MS = 5 * 60_000;
/** Re-cover this much recent time on every pass, to absorb late rows and skew. */
export const RECOMPUTE_LOOKBACK_MS = 30 * 60_000;
/** Cap so a long outage can't produce an unbounded query. */
export const MAX_BUCKETS_PER_PASS = 24;

export function bucketStart(ms: number, bucketMs = BUCKET_MS): number {
  return Math.floor(ms / bucketMs) * bucketMs;
}

// Which buckets to recompute: everything from the older of (newest stored
// bucket, now - lookback) up to but NOT including the open one. Writing a
// half-full bucket that is never revisited would leave a permanent phantom dip
// in every chart — the live tail comes from raw beats instead.
export function bucketsToRecompute(
  latestStoredMs: number | null,
  nowMs: number,
  opts: { bucketMs?: number; lookbackMs?: number; max?: number } = {}
): number[] {
  const bucketMs = opts.bucketMs ?? BUCKET_MS;
  const lookback = opts.lookbackMs ?? RECOMPUTE_LOOKBACK_MS;
  const max = opts.max ?? MAX_BUCKETS_PER_PASS;

  const openBucket = bucketStart(nowMs, bucketMs);
  const fromLookback = bucketStart(nowMs - lookback, bucketMs);
  const fromStored = latestStoredMs === null ? fromLookback : bucketStart(latestStoredMs, bucketMs);
  let start = Math.min(fromLookback, fromStored);

  const count = Math.max(0, Math.round((openBucket - start) / bucketMs));
  if (count > max) start = openBucket - max * bucketMs;

  const out: number[] = [];
  for (let t = start; t < openBucket; t += bucketMs) out.push(t);
  return out;
}

export interface BeatRow {
  status: string;
  createdAt: Date;
  version: string | null;
  data: unknown;
}

export interface RollupValues {
  beats: number;
  degraded: number;
  redisOk: number;
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
  version: string | null;
  queues: Record<string, unknown> | null;
}

const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function maxOf(values: (number | null)[]): number | null {
  const real = values.filter((v): v is number => v !== null);
  return real.length ? Math.max(...real) : null;
}

// Cumulative counters differenced across consecutive beats. A decrease means
// the process restarted, so the new value IS the delta (counters start at 0) —
// never a negative.
export function deltaWork(prev: number | null, next: number | null): number | null {
  if (next === null) return null;
  if (prev === null) return null; // first beat in the window: no baseline to difference
  return next >= prev ? next - prev : next;
}

/**
 * Pure: same rows in, same row out. `priorBeat` is the last beat *before* the
 * bucket, used as the baseline for the cumulative work counters.
 */
export interface CronRow {
  status: string;
  data?: unknown;
}

export function rollupBucket(
  beats: BeatRow[],
  cronRows: CronRow[] = [],
  priorBeat: BeatRow | null = null
): RollupValues {
  const workerBeats = beats.filter((b) => b.status !== "stopped");

  const redisLatencies: number[] = [];
  let redisOk = 0;
  const rss: (number | null)[] = [];
  const waiting: (number | null)[] = [];
  const failedQ: (number | null)[] = [];
  let lastQueues: Record<string, unknown> | null = null;
  let version: string | null = null;

  for (const beat of workerBeats) {
    const d = (beat.data ?? {}) as Record<string, any>;

    const latency = numOrNull(d.redis?.latencyMs);
    if (d.redis?.ok === true) redisOk++;
    if (latency !== null) redisLatencies.push(latency);

    rss.push(numOrNull(d.process?.rssMb));

    if (d.queues && typeof d.queues === "object") {
      lastQueues = d.queues as Record<string, unknown>;
      for (const counts of Object.values(d.queues as Record<string, any>)) {
        if (!counts) continue;
        waiting.push(numOrNull(counts.waiting));
        failedQ.push(numOrNull(counts.failed));
      }
    }
    if (beat.version) version = beat.version;
  }

  // Work throughput: last cumulative value in the bucket minus the baseline.
  const workOf = (b: BeatRow | null, key: string): number | null =>
    b ? numOrNull(((b.data ?? {}) as Record<string, any>).work?.[key]) : null;
  const lastBeat = workerBeats.length ? workerBeats[workerBeats.length - 1] : null;
  const baseline = priorBeat ?? null;

  // Cron rows carry their own per-run counts; on the serverless deployment they
  // are the only source of throughput.
  let cronChecked = 0;
  let cronChanged = 0;
  let cronFailed = 0;
  let sawCronPoll = false;
  for (const row of cronRows) {
    const d = (row.data ?? {}) as Record<string, unknown>;
    if (typeof d.checked === "number") {
      sawCronPoll = true;
      cronChecked += d.checked;
      cronChanged += typeof d.changed === "number" ? d.changed : 0;
      cronFailed += typeof d.failed === "number" ? d.failed : 0;
    }
  }

  const workerChecked = deltaWork(workOf(baseline, "checked"), workOf(lastBeat, "checked"));
  const workerChanged = deltaWork(workOf(baseline, "changed"), workOf(lastBeat, "changed"));
  const workerFailed = deltaWork(workOf(baseline, "failed"), workOf(lastBeat, "failed"));

  return {
    beats: beats.length,
    degraded: beats.filter((b) => b.status === "degraded").length,
    redisOk,
    redisAvgMs: redisLatencies.length
      ? Math.round(redisLatencies.reduce((a, b) => a + b, 0) / redisLatencies.length)
      : null,
    redisMaxMs: redisLatencies.length ? Math.max(...redisLatencies) : null,
    rssMaxMb: maxOf(rss),
    // max, not avg: a backlog that spiked and drained still happened.
    queueMaxWaiting: maxOf(waiting),
    queueMaxFailed: maxOf(failedQ),
    checked: sawCronPoll ? cronChecked : workerChecked,
    changed: sawCronPoll ? cronChanged : workerChanged,
    failed: sawCronPoll ? cronFailed : workerFailed,
    cronRuns: cronRows.length,
    cronErrors: cronRows.filter((r) => r.status === "error").length,
    version,
    queues: lastQueues,
  };
}

/**
 * Recompute and upsert every closed bucket that needs it. Returns how many
 * rows were written. Never throws — telemetry must not fail maintenance.
 */
export async function rollupOps(nowMs = Date.now()): Promise<number> {
  try {
    const latest = await prisma.opsRollup.findFirst({
      orderBy: { bucketStart: "desc" },
      select: { bucketStart: true },
    });
    const buckets = bucketsToRecompute(latest?.bucketStart.getTime() ?? null, nowMs);
    if (buckets.length === 0) return 0;

    const from = new Date(buckets[0]);
    const to = new Date(buckets[buckets.length - 1] + BUCKET_MS);

    const [rows, prior, notifications] = await prisma.$transaction([
      prisma.opsHeartbeat.findMany({
        where: { createdAt: { gte: from, lt: to } },
        orderBy: { createdAt: "asc" },
        select: { source: true, status: true, createdAt: true, version: true, data: true },
      }),
      // Baseline for the cumulative work counters: the last worker beat before
      // the window. Without it the first bucket of every pass reads as null.
      prisma.opsHeartbeat.findFirst({
        where: { source: "worker", createdAt: { lt: from } },
        orderBy: { createdAt: "desc" },
        select: { status: true, createdAt: true, version: true, data: true },
      }),
      prisma.notificationLog.findMany({
        where: { createdAt: { gte: from, lt: to } },
        select: { createdAt: true, status: true },
      }),
    ]);

    let written = 0;
    let carried = prior as BeatRow | null;

    for (const start of buckets) {
      const end = start + BUCKET_MS;
      const inBucket = <T extends { createdAt: Date }>(list: T[]) =>
        list.filter((r) => r.createdAt.getTime() >= start && r.createdAt.getTime() < end);

      const beats = inBucket(rows.filter((r) => r.source === "worker")) as BeatRow[];
      const cronPoll = inBucket(rows.filter((r) => r.source === "cron:poll"));
      const values = rollupBucket(beats, cronPoll, carried);

      const notif = inBucket(notifications);
      const byStatus = (status: string) => notif.filter((n) => n.status === status).length;

      await prisma.opsRollup.upsert({
        where: { bucketStart: new Date(start) },
        create: {
          bucketStart: new Date(start),
          ...values,
          queues: (values.queues ?? undefined) as object | undefined,
          notifSent: notif.length ? byStatus("sent") : null,
          notifFailed: notif.length ? byStatus("failed") : null,
          notifQueued: notif.length ? byStatus("queued") : null,
        },
        update: {
          ...values,
          queues: (values.queues ?? undefined) as object | undefined,
          notifSent: notif.length ? byStatus("sent") : null,
          notifFailed: notif.length ? byStatus("failed") : null,
          notifQueued: notif.length ? byStatus("queued") : null,
        },
      });

      const last = beats.length ? beats[beats.length - 1] : null;
      if (last) carried = last;
      written++;
    }

    return written;
  } catch (err) {
    console.error("Ops rollup failed:", (err as Error)?.message ?? err);
    return 0;
  }
}

export async function pruneRollups(retentionDays = 7): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  const { count } = await prisma.opsRollup.deleteMany({
    where: { bucketStart: { lt: cutoff } },
  });
  return count;
}
