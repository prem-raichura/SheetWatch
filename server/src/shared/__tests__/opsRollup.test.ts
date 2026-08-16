import { describe, it, expect } from "vitest";
import {
  BUCKET_MS,
  bucketStart,
  bucketsToRecompute,
  deltaWork,
  rollupBucket,
  type BeatRow,
} from "../opsRollup";

const at = (iso: string) => new Date(iso);

function beat(iso: string, data: Record<string, unknown>, status = "ok"): BeatRow {
  return { status, createdAt: at(iso), version: "a1b2c3d", data };
}

const worker = (opts: {
  redisMs?: number | null;
  rss?: number;
  waiting?: number;
  failed?: number;
  work?: { checked: number; changed: number; failed: number };
}) => ({
  redis: { ok: opts.redisMs !== null, latencyMs: opts.redisMs ?? null },
  queues: {
    poll: { waiting: opts.waiting ?? 0, failed: opts.failed ?? 0 },
  },
  process: { rssMb: opts.rss ?? 100 },
  ...(opts.work ? { work: opts.work } : {}),
});

describe("bucketStart", () => {
  it("floors to a UTC 5-minute boundary", () => {
    expect(bucketStart(at("2026-08-17T10:07:31.500Z").getTime())).toBe(
      at("2026-08-17T10:05:00.000Z").getTime()
    );
  });

  // Buckets are keyed in UTC precisely so DST is a non-event. A local-time key
  // would duplicate or skip an hour at the boundary, and the 7-day 6:1 fold
  // would then double-count it.
  it("is unaffected by a DST transition", () => {
    const before = bucketStart(at("2026-10-25T00:58:00Z").getTime());
    const after = bucketStart(at("2026-10-25T01:03:00Z").getTime());
    expect(after - before).toBe(BUCKET_MS);
  });
});

describe("bucketsToRecompute", () => {
  const now = at("2026-08-17T10:07:00Z").getTime();

  it("never returns the open bucket", () => {
    const open = bucketStart(now);
    expect(bucketsToRecompute(now - 20 * 60_000, now)).not.toContain(open);
  });

  it("always re-covers the recent window, even when up to date", () => {
    const buckets = bucketsToRecompute(now - BUCKET_MS, now);
    expect(buckets.length).toBeGreaterThanOrEqual(6); // 30 min of lookback
  });

  it("caps a long outage instead of querying unbounded history", () => {
    const buckets = bucketsToRecompute(now - 30 * 86_400_000, now);
    expect(buckets.length).toBeLessThanOrEqual(24);
  });

  it("returns buckets in ascending order and aligned", () => {
    const buckets = bucketsToRecompute(null, now);
    for (const b of buckets) expect(b % BUCKET_MS).toBe(0);
    expect([...buckets].sort((a, b) => a - b)).toEqual(buckets);
  });
});

describe("deltaWork", () => {
  it("differences monotone counters", () => {
    expect(deltaWork(10, 25)).toBe(15);
  });

  it("treats a decrease as a restart, never a negative", () => {
    expect(deltaWork(900, 4)).toBe(4);
  });

  it("has no baseline to difference on the first beat", () => {
    expect(deltaWork(null, 12)).toBeNull();
    expect(deltaWork(5, null)).toBeNull();
  });
});

describe("rollupBucket", () => {
  it("is idempotent — the same rows always produce the same row", () => {
    const rows = [
      beat("2026-08-17T10:00:05Z", worker({ redisMs: 2, rss: 120, waiting: 5 })),
      beat("2026-08-17T10:00:35Z", worker({ redisMs: 4, rss: 130, waiting: 9 })),
    ];
    expect(rollupBucket(rows)).toEqual(rollupBucket(rows));
  });

  it("takes the max for backlog and memory, the average for latency", () => {
    const out = rollupBucket([
      beat("2026-08-17T10:00:05Z", worker({ redisMs: 2, rss: 120, waiting: 5, failed: 0 })),
      beat("2026-08-17T10:00:35Z", worker({ redisMs: 6, rss: 130, waiting: 9, failed: 3 })),
    ]);
    // A backlog that spiked and drained still happened — an average would hide it.
    expect(out.queueMaxWaiting).toBe(9);
    expect(out.queueMaxFailed).toBe(3);
    expect(out.rssMaxMb).toBe(130);
    expect(out.redisAvgMs).toBe(4);
    expect(out.redisMaxMs).toBe(6);
    expect(out.redisOk).toBe(2);
  });

  // recordStopped writes data:{reason} and nothing else. A naive ?? 0 would
  // bake a bogus zero into a row that lives for seven days.
  it("tolerates a stopped beat without inventing zeros", () => {
    const out = rollupBucket([
      beat("2026-08-17T10:00:05Z", { reason: "SIGTERM" }, "stopped"),
    ]);
    expect(out.beats).toBe(1); // it still happened
    expect(out.queueMaxWaiting).toBeNull(); // but it observed nothing
    expect(out.rssMaxMb).toBeNull();
    expect(out.redisAvgMs).toBeNull();
  });

  it("reports nothing at all for an empty bucket", () => {
    const out = rollupBucket([]);
    expect(out.beats).toBe(0);
    expect(out.queueMaxWaiting).toBeNull();
    expect(out.checked).toBeNull();
    expect(out.queues).toBeNull();
  });

  it("derives throughput from the work-counter delta against the prior beat", () => {
    const prior = beat("2026-08-17T09:59:35Z", worker({ redisMs: 1, work: { checked: 100, changed: 10, failed: 1 } }));
    const out = rollupBucket(
      [
        beat("2026-08-17T10:00:05Z", worker({ redisMs: 1, work: { checked: 112, changed: 12, failed: 1 } })),
        beat("2026-08-17T10:04:35Z", worker({ redisMs: 1, work: { checked: 140, changed: 15, failed: 2 } })),
      ],
      [],
      prior
    );
    expect(out.checked).toBe(40);
    expect(out.changed).toBe(5);
    expect(out.failed).toBe(1);
  });

  it("prefers cron payloads when the deployment is serverless", () => {
    const out = rollupBucket(
      [],
      [
        { status: "ok", data: { checked: 6, changed: 2, failed: 0 } },
        { status: "error", data: { error: "boom" } },
      ]
    );
    expect(out.checked).toBe(6);
    expect(out.changed).toBe(2);
    expect(out.cronRuns).toBe(2);
    expect(out.cronErrors).toBe(1);
  });

  it("counts degraded beats separately from stopped ones", () => {
    const out = rollupBucket([
      beat("2026-08-17T10:00:05Z", worker({ redisMs: null }), "degraded"),
      beat("2026-08-17T10:00:35Z", worker({ redisMs: 3 })),
    ]);
    expect(out.degraded).toBe(1);
    expect(out.redisOk).toBe(1);
  });
});
