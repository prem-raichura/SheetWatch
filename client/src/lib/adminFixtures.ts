import type { HistoryReport, PulseReport, StatsReport } from "./adminTypes";

// DEV-only fixtures for /admin?mock=<scenario>. Behind import.meta.env.DEV at
// the call site, so this file is dead-code-eliminated from production builds.
// Lets every visual state be checked with no backend at all.

const now = () => new Date().toISOString();

const basePulse = (): PulseReport => ({
  overall: "ok",
  deployment: "worker",
  now: now(),
  services: {
    api: { state: "up" },
    postgres: { state: "up", latencyMs: 12 },
    redis: { state: "up", latencyMs: 1 },
    worker: {
      state: "up",
      lastBeatAt: now(),
      ageMs: 4000,
      uptimeS: 93_600,
      rssMb: 148,
      version: "a1b2c3d",
      instance: "worker-1:12",
    },
    realtime: { state: "up", latencyMs: 38, httpStatus: 200 },
  },
  channels: { email: true, telegram: false, push: true, realtime: true, cron: true },
  versions: { api: "a1b2c3d", worker: "a1b2c3d", match: true },
  queues: {
    poll: { waiting: 3, active: 2, delayed: 41, failed: 0, completed: 128_402 },
    notify: { waiting: 0, active: 0, delayed: 0, failed: 2, completed: 8_120 },
    compare: { waiting: 0, active: 1, delayed: 4, failed: 0, completed: 3_400 },
  },
  schedulers: {
    live: { poll: 41, notify: 0, compare: 4 },
    expected: { sheets: 41, integrity: 4 },
    reconciledAt: new Date(Date.now() - 12_000).toISOString(),
    reconcileError: null,
  },
  cron: [],
});

const baseStats = (): StatsReport => ({
  now: now(),
  polling: {
    total: 47,
    active: 41,
    paused: 5,
    archived: 1,
    buckets: { ok: 34, due: 5, overdue: 2, blocked: 1, transient: 0 },
    byInterval: [
      { pollInterval: 60, count: 12 },
      { pollInterval: 300, count: 21 },
      { pollInterval: 3600, count: 8 },
    ],
    worst: [
      { id: "s1", label: "SRL 2026 — Performance Reports", pollInterval: 60, overdueSeconds: 1840 },
      { id: "s2", label: "Q3 roster", pollInterval: 300, overdueSeconds: 900 },
    ],
    errors: [
      {
        id: "s9",
        label: "Old pricing",
        errorMessage: "Sheet not found or deleted.",
        lastCheckedAt: new Date(Date.now() - 86_400_000).toISOString(),
      },
    ],
  },
  integrity: {
    total: 4,
    enabled: 4,
    due: 1,
    overdue: 0,
    never: 0,
    suggestions: { pending: 3, applied: 41, ignored: 0, failed: 0 },
    conflicts: 1,
  },
  notifications: {
    window: "24h",
    matrix: [
      { channel: "email", status: "sent", count: 82 },
      { channel: "email", status: "failed", count: 2 },
      { channel: "push", status: "sent", count: 140 },
      { channel: "webhook", status: "queued", count: 3 },
    ],
    oldestQueued: {
      createdAt: new Date(Date.now() - 3_600_000).toISOString(),
      deliverAfter: new Date(Date.now() + 1_800_000).toISOString(),
      ageMs: 3_600_000,
    },
    failures: [
      {
        id: "n1",
        channel: "email",
        target: "pr***@gmail.com",
        error: "SMTP 550 mailbox unavailable",
        createdAt: new Date(Date.now() - 600_000).toISOString(),
      },
    ],
  },
  scale: {
    users: 3,
    sheetsActive: 41,
    sheetsPaused: 5,
    sheetsArchived: 1,
    changes24h: 312,
    snapshots: 9_450,
    kpiWidgets: 7,
    chartWidgets: 4,
    shareLinks: 2,
    webhooks: 3,
    pushSubscriptions: 5,
    integrityChecks: 4,
  },
});

export function mockPulse(scenario: string): PulseReport {
  const p = basePulse();
  if (scenario === "worker-down") {
    p.overall = "down";
    p.services.worker = {
      state: "down",
      reason: "no beat for 14m",
      lastBeatAt: new Date(Date.now() - 840_000).toISOString(),
      ageMs: 840_000,
    };
    p.services.redis = { state: "not_applicable", reason: "no live worker reporting" };
    p.queues = null;
    p.schedulers.live = null;
  }
  if (scenario === "redis-down") {
    p.overall = "degraded";
    p.services.redis = { state: "down", reason: "worker reports Redis unreachable" };
    p.queues = { poll: null, notify: null, compare: null };
    p.schedulers.live = { poll: null, notify: null, compare: null };
  }
  if (scenario === "serverless") {
    p.deployment = "serverless";
    p.services.worker = { state: "not_applicable" };
    p.services.redis = { state: "not_applicable" };
    p.queues = null;
    p.cron = [
      { source: "cron:poll", lastRunAt: now(), ageMs: 42_000, status: "ok", durationMs: 2_140, data: { due: 6, checked: 6, skipped: 0, changed: 2, failed: 0 } },
      { source: "cron:integrity", lastRunAt: now(), ageMs: 51_000, status: "ok", durationMs: 900, data: { ok: true } },
      { source: "cron:maintenance", lastRunAt: new Date(Date.now() - 3_000_000).toISOString(), ageMs: 3_000_000, status: "error", durationMs: 12_000, data: { error: "digest run failed" } },
    ];
  }
  return p;
}

export const mockStats = (): StatsReport => baseStats();


// ---- history ---------------------------------------------------------------
//
// Deterministic: a seeded LCG, so ?mock=ok renders identically on every reload.
// Without that, a fixture change and a rendering change look the same.
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

const SPEC: Record<string, { bucketMs: number; count: number }> = {
  "1h": { bucketMs: 60_000, count: 60 },
  "24h": { bucketMs: 300_000, count: 288 },
  "7d": { bucketMs: 1_800_000, count: 336 },
};

export function mockHistory(scenario: string, range = "24h"): HistoryReport {
  const spec = SPEC[range] ?? SPEC["24h"];
  const random = rng(scenario.length * 7919 + spec.count);
  const end = Math.floor(Date.now() / spec.bucketMs) * spec.bucketMs;
  const axis = Array.from({ length: spec.count }, (_, i) => end - (spec.count - 1 - i) * spec.bucketMs);

  const coverage: number[] = axis.map(() => (range === "1h" ? 2 : 10));
  const wave = (i: number, amp: number, base: number, period: number) =>
    Math.max(0, Math.round(base + Math.sin((i / period) * Math.PI * 2) * amp + random() * amp * 0.3));

  let queueWaiting: (number | null)[] = axis.map((_, i) => wave(i, 6, 8, 40));
  let queueFailed: (number | null)[] = axis.map((_, i) => (i % 53 === 0 ? 1 : 0));
  let redisMs: (number | null)[] = axis.map((_, i) => wave(i, 2, 3, 90));
  let rssMb: (number | null)[] = axis.map((_, i) => 120 + Math.round((i / spec.count) * 40));
  let checked: (number | null)[] = axis.map((_, i) => wave(i, 5, 14, 30));
  let changed: (number | null)[] = axis.map((_, i) => wave(i, 2, 3, 25));
  let failed: (number | null)[] = axis.map((_, i) => (i % 71 === 0 ? 1 : 0));

  if (scenario === "worker-down") {
    // Beats stop: coverage 0 forces every heartbeat-derived series to null, so
    // the chart shows a gap band and a broken line rather than a drop to zero.
    for (let i = spec.count - 40; i < spec.count; i++) {
      coverage[i] = 0;
      queueWaiting[i] = null;
      queueFailed[i] = null;
      redisMs[i] = null;
      rssMb[i] = null;
      checked[i] = null;
      changed[i] = null;
      failed[i] = null;
    }
  }
  if (scenario === "redis-down") {
    // Beats keep landing, but the worker can't read Redis: coverage > 0 with
    // null values — a different state from a gap, and it must look different.
    queueWaiting = queueWaiting.map(() => null);
    queueFailed = queueFailed.map(() => null);
    redisMs = redisMs.map(() => null);
  }
  if (scenario === "serverless") {
    queueWaiting = queueWaiting.map(() => null);
    queueFailed = queueFailed.map(() => null);
    redisMs = redisMs.map(() => null);
    rssMb = rssMb.map(() => null);
  }
  if (scenario === "flat") {
    failed = failed.map(() => 0);
    // Pins the zero-baseline fix: a stable series must sit mid-plot, not
    // collapse onto an edge.
    queueWaiting = queueWaiting.map(() => 5);
    checked = checked.map(() => 12);
    changed = changed.map(() => 0);
    redisMs = redisMs.map(() => 2);
  }
  if (scenario === "spiky") {
    queueWaiting[Math.floor(spec.count / 2)] = 900;
    checked[Math.floor(spec.count / 3)] = 400;
  }
  if (scenario === "partial") {
    for (let i = 0; i < Math.floor(spec.count / 2); i++) {
      coverage[i] = 0;
      queueWaiting[i] = null;
      redisMs[i] = null;
      rssMb[i] = null;
      checked[i] = null;
      changed[i] = null;
      failed[i] = null;
    }
  }

  if (scenario === "empty") {
    return {
      now: new Date().toISOString(),
      range: (range as HistoryReport["range"]) ?? "24h",
      bucketMs: spec.bucketMs,
      t: [],
      coverage: [],
      series: {},
      stacks: { notifications: [] },
      distributions: { pollInterval: [], freshness: [], integrity: [] },
      sources: { queues: "unavailable", throughput: "unavailable", notifications: "unavailable" },
    };
  }

  return {
    now: new Date().toISOString(),
    range: (range as HistoryReport["range"]) ?? "24h",
    bucketMs: spec.bucketMs,
    t: axis.map((t) => new Date(t).toISOString()),
    coverage,
    series: { queueWaiting, queueFailed, redisMs, rssMb, checked, changed, failed },
    stacks: {
      notifications: [
        { key: "sent", values: axis.map((_, i) => wave(i, 3, 5, 60)) },
        { key: "queued", values: axis.map((_, i) => (i % 37 === 0 ? 2 : 0)) },
        { key: "failed", values: axis.map((_, i) => (i % 91 === 0 ? 1 : 0)) },
      ],
    },
    distributions: {
      pollInterval: [
        { label: "1m", value: 12 },
        { label: "5m", value: 21 },
        { label: "1h", value: 8 },
      ],
      freshness: [
        { label: "ok", value: 34 },
        { label: "due", value: 5 },
        { label: "overdue", value: 2 },
        { label: "blocked", value: 1 },
        { label: "transient", value: 0 },
      ],
      integrity: [
        { label: "on time", value: 3 },
        { label: "due", value: 1 },
        { label: "overdue", value: 0 },
        { label: "never", value: 0 },
      ],
    },
    sources: {
      queues: scenario === "serverless" ? "unavailable" : "rollup",
      throughput: "rollup",
      notifications: "rollup",
    },
  };
}
