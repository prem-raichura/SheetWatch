import { describe, it, expect } from "vitest";
import { bucketAxis, denseFill, foldRows, rangeSpec, type FoldableRow } from "../opsHistory";

const NOW = new Date("2026-08-17T10:07:00Z").getTime();

const row = (o: Partial<FoldableRow> = {}): FoldableRow => ({
  beats: 10,
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
  ...o,
});

describe("rangeSpec", () => {
  it("derives the bucket size from the range, never the client", () => {
    expect(rangeSpec("1h")).toMatchObject({ bucketMs: 60_000, source: "beat" });
    expect(rangeSpec("24h")).toMatchObject({ bucketMs: 300_000, source: "rollup", fold: 1 });
    expect(rangeSpec("7d")).toMatchObject({ bucketMs: 1_800_000, source: "rollup", fold: 6 });
  });

  it("falls back rather than throwing on an unknown range", () => {
    // A stale bookmark should show a dashboard, not an error page.
    expect(rangeSpec("90d").range).toBe("24h");
    expect(rangeSpec(undefined).range).toBe("24h");
  });

  it("keeps every range under a few hundred points", () => {
    for (const r of ["1h", "24h", "7d"] as const) {
      const spec = rangeSpec(r);
      expect(spec.spanMs / spec.bucketMs).toBeLessThanOrEqual(360);
    }
  });
});

describe("bucketAxis", () => {
  it("is dense, aligned and ascending", () => {
    const spec = rangeSpec("24h");
    const axis = bucketAxis(NOW, spec);
    expect(axis).toHaveLength(288);
    for (const t of axis) expect(t % spec.bucketMs).toBe(0);
    expect(axis[1] - axis[0]).toBe(spec.bucketMs);
    expect(axis[axis.length - 1]).toBeLessThanOrEqual(NOW);
  });
});

describe("denseFill", () => {
  it("leaves absent buckets null, never zero", () => {
    // An unobserved queue and an empty queue must not look the same.
    const spec = rangeSpec("24h");
    const axis = bucketAxis(NOW, spec);
    const filled = denseFill(
      axis,
      [{ at: axis[5], value: 42 }],
      spec.bucketMs
    );
    expect(filled[5]).toBe(42);
    expect(filled[4]).toBeNull();
    expect(filled.filter((v) => v !== null)).toHaveLength(1);
  });

  it("keeps a genuine zero distinct from a gap", () => {
    const spec = rangeSpec("24h");
    const axis = bucketAxis(NOW, spec);
    const filled = denseFill(axis, [{ at: axis[0], value: 0 }], spec.bucketMs);
    expect(filled[0]).toBe(0);
    expect(filled[1]).toBeNull();
  });
});

describe("foldRows", () => {
  it("sums throughput and takes the max of backlog", () => {
    const out = foldRows([
      row({ checked: 10, queueMaxWaiting: 3, notifSent: 2 }),
      row({ checked: 5, queueMaxWaiting: 11, notifSent: 1 }),
    ]);
    expect(out.checked).toBe(15);
    expect(out.queueMaxWaiting).toBe(11);
    expect(out.notifSent).toBe(3);
    expect(out.beats).toBe(20);
  });

  it("weights the latency average by beats", () => {
    // A bucket with two beats must not outvote one with ten.
    const out = foldRows([
      row({ beats: 10, redisAvgMs: 10 }),
      row({ beats: 2, redisAvgMs: 100 }),
    ]);
    expect(out.redisAvgMs).toBe(25); // (10*10 + 100*2) / 12
  });

  it("folds an all-null window to null, not zero", () => {
    const out = foldRows([row({ beats: 0 }), row({ beats: 0 })]);
    expect(out.redisAvgMs).toBeNull();
    expect(out.checked).toBeNull();
    expect(out.queueMaxWaiting).toBeNull();
    expect(out.beats).toBe(0);
  });

  it("ignores gaps when some buckets did report", () => {
    const out = foldRows([row({ beats: 0 }), row({ beats: 10, checked: 7 })]);
    expect(out.checked).toBe(7);
  });
});
