import prisma from "./prisma";
import { apiVersion } from "./env";
import {
  classifyGroups,
  compareVersions,
  classifyHeartbeat,
  classifySheets,
  maskTarget,
  rollupOverall,
  type GroupRow,
  type HeartbeatRow,
  type Overall,
  type OpsSource,
  type PollRow,
  type ServiceState,
} from "./ops";
import { emailConfigured } from "./notify/email";
import { telegramConfigured } from "./notify/telegram";

// Gatherers for the admin dashboard. Kept out of the route file so they can be
// unit-tested and so the auth surface stays one small router.
//
// NOTE: nothing here may import shared/redis — getRedis() throws without
// REDIS_URL, which on Vercel would turn every admin request into a 500 and
// tempt someone into setting REDIS_URL there, breaking the invariant that the
// API never talks to Redis. Queue data arrives via the worker's heartbeat.

export interface ServiceReport {
  state: ServiceState;
  latencyMs?: number | null;
  reason?: string | null;
  [extra: string]: unknown;
}

export interface HealthReport {
  overall: Overall;
  deployment: "worker" | "serverless" | "unknown";
  now: string;
  services: Record<string, ServiceReport>;
  channels: Record<string, boolean>;
  /** match is null when either side is unknown — unknown is not "mismatch". */
  versions: { api: string | null; worker: string | null; match: boolean | null };
}

/** One reference instant from the database — see the clock-skew note in ops.ts. */
export async function dbNow(): Promise<Date> {
  const rows = await prisma.$queryRaw<{ now: Date }[]>`SELECT now() as now`;
  return rows[0]?.now ?? new Date();
}

export async function latestBeats(
  sources: OpsSource[]
): Promise<Partial<Record<OpsSource, HeartbeatRow>>> {
  // Four explicit findFirsts in one transaction, not findMany({distinct}):
  // Prisma only emits DISTINCT ON when the distinct fields lead the orderBy,
  // so distinct here would pull the whole 24h window and dedupe in memory.
  const rows = await prisma.$transaction(
    sources.map((source) =>
      prisma.opsHeartbeat.findFirst({
        where: { source },
        orderBy: { createdAt: "desc" },
        select: { status: true, createdAt: true, instance: true, version: true, data: true },
      })
    )
  );

  const out: Partial<Record<OpsSource, HeartbeatRow>> = {};
  sources.forEach((source, i) => {
    const row = rows[i];
    if (row) out[source] = row as HeartbeatRow;
  });
  return out;
}

async function postgresLatency(): Promise<ServiceReport> {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { state: "up", latencyMs: Date.now() - started };
  } catch (err) {
    return { state: "down", latencyMs: null, reason: (err as Error)?.message ?? "query failed" };
  }
}

// Always capped: a hung edge would otherwise hold the function for the full
// 60s maxDuration — and hold the single pooled Postgres connection with it.
async function realtimeHealth(): Promise<ServiceReport> {
  const url = process.env.REALTIME_URL;
  if (!url || !process.env.REALTIME_SECRET) {
    return { state: "not_configured" };
  }
  const started = Date.now();
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return {
      state: res.ok ? "up" : "down",
      latencyMs: Date.now() - started,
      httpStatus: res.status,
      reason: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    const reason = (err as Error)?.name === "TimeoutError" ? "timeout after 2000ms" : "unreachable";
    return { state: "down", latencyMs: null, reason };
  }
}

// Redis state is read out of the worker's last beat rather than probed. That
// indirection is the whole reason the heartbeat table exists.
function redisFromBeat(beat: HeartbeatRow | undefined, workerState: ServiceState): ServiceReport {
  if (!beat || workerState === "not_applicable") return { state: "not_applicable" };
  const data = (beat.data ?? {}) as { redis?: { ok?: boolean; latencyMs?: number | null } };
  if (!data.redis) return { state: "down", reason: "worker could not read Redis" };
  if (workerState === "down" || workerState === "stopped") {
    return { state: "not_applicable", reason: "no live worker reporting" };
  }
  return data.redis.ok
    ? { state: "up", latencyMs: data.redis.latencyMs ?? null }
    : { state: "down", reason: "worker reports Redis unreachable" };
}

export async function getHealth(): Promise<HealthReport> {
  const expectWorker = process.env.ADMIN_EXPECT_WORKER === "true";

  const [now, postgres, beats] = await Promise.all([
    dbNow().catch(() => new Date()),
    postgresLatency(),
    latestBeats(["worker", "cron:poll", "cron:integrity", "cron:maintenance"]).catch(
      () => ({}) as Partial<Record<OpsSource, HeartbeatRow>>
    ),
  ]);
  // Outside the DB work on purpose — an external fetch must never sit inside a
  // transaction holding a connection.
  const realtime = await realtimeHealth();

  const workerBeat = beats.worker;
  const worker = classifyHeartbeat(workerBeat ?? null, now.getTime(), expectWorker);
  const workerData = (workerBeat?.data ?? {}) as {
    process?: { uptimeS?: number; rssMb?: number };
  };

  const cronSeen = Boolean(beats["cron:poll"] || beats["cron:integrity"]);
  const deployment: HealthReport["deployment"] =
    worker.state === "up" || worker.state === "stale" || expectWorker
      ? "worker"
      : cronSeen
        ? "serverless"
        : "unknown";

  const api = apiVersion();
  const services: Record<string, ServiceReport> = {
    api: { state: "up", version: api, instance: process.env.VERCEL_REGION ?? null },
    postgres,
    redis: redisFromBeat(workerBeat, worker.state),
    worker: {
      state: worker.state,
      reason: worker.reason,
      lastBeatAt: worker.lastBeatAt,
      ageMs: worker.ageMs,
      uptimeS: workerData.process?.uptimeS ?? null,
      rssMb: workerData.process?.rssMb ?? null,
      version: workerBeat?.version ?? null,
      instance: workerBeat?.instance ?? null,
    },
    realtime,
  };

  return {
    overall: rollupOverall(Object.values(services).map((s) => s.state)),
    deployment,
    now: now.toISOString(),
    services,
    versions: {
      api,
      worker: workerBeat?.version ?? null,
      match: compareVersions(api, workerBeat?.version ?? null),
    },
    channels: {
      email: emailConfigured(),
      telegram: telegramConfigured(),
      push: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
      realtime: Boolean(process.env.REALTIME_URL && process.env.REALTIME_SECRET),
      cron: Boolean(process.env.CRON_SECRET),
    },
  };
}


// ---- pulse: health + queues + cron liveness (10s cadence on the client) -----

export interface PulseReport extends HealthReport {
  queues: Record<string, Record<string, number> | null> | null;
  schedulers: {
    live: Record<string, number | null> | null;
    expected: { sheets: number | null; integrity: number | null };
    reconciledAt: string | null;
    reconcileError: string | null;
  };
  cron: {
    source: string;
    lastRunAt: string | null;
    ageMs: number | null;
    status: string | null;
    durationMs: number | null;
    data: unknown;
  }[];
}

const CRON_SOURCES: OpsSource[] = ["cron:poll", "cron:integrity", "cron:maintenance"];

export async function getPulse(): Promise<PulseReport> {
  const health = await getHealth();
  const nowMs = new Date(health.now).getTime();

  const beats = await latestBeats(["worker", ...CRON_SOURCES]).catch(
    () => ({}) as Partial<Record<OpsSource, HeartbeatRow>>
  );

  const workerData = (beats.worker?.data ?? {}) as {
    queues?: Record<string, Record<string, number> | null>;
    schedulers?: Record<string, number | null>;
    reconcile?: {
      at?: string | null;
      error?: string | null;
      sheets?: { active?: number } | null;
      integrity?: { active?: number } | null;
    };
  };

  // Stale worker data is worse than none: a queue depth from an hour ago read
  // as current would be actively misleading.
  const live = health.services.worker.state === "up" ? (workerData.queues ?? null) : null;

  return {
    ...health,
    queues: live,
    schedulers: {
      live: health.services.worker.state === "up" ? (workerData.schedulers ?? null) : null,
      expected: {
        sheets: workerData.reconcile?.sheets?.active ?? null,
        integrity: workerData.reconcile?.integrity?.active ?? null,
      },
      reconciledAt: workerData.reconcile?.at ?? null,
      reconcileError: workerData.reconcile?.error ?? null,
    },
    cron: CRON_SOURCES.map((source) => {
      const beat = beats[source];
      return {
        source,
        lastRunAt: beat ? beat.createdAt.toISOString() : null,
        ageMs: beat ? Math.max(0, nowMs - beat.createdAt.getTime()) : null,
        status: beat?.status ?? null,
        durationMs: (beat as { durationMs?: number } | undefined)?.durationMs ?? null,
        data: beat?.data ?? null,
      };
    }),
  };
}

// ---- stats: the expensive half (60s cadence) -------------------------------

export interface StatsReport {
  now: string;
  polling: {
    total: number;
    active: number;
    paused: number;
    archived: number;
    buckets: Record<string, number>;
    byInterval: { pollInterval: number; count: number }[];
    worst: { id: string; label: string; pollInterval: number; overdueSeconds: number }[];
    errors: { id: string; label: string; errorMessage: string; lastCheckedAt: string | null }[];
  };
  integrity: {
    total: number;
    enabled: number;
    due: number;
    overdue: number;
    never: number;
    suggestions: Record<string, number>;
    conflicts: number;
  };
  notifications: {
    window: "24h";
    matrix: { channel: string; status: string; count: number }[];
    oldestQueued: { createdAt: string; deliverAfter: string | null; ageMs: number } | null;
    failures: { id: string; channel: string; target: string; error: string | null; createdAt: string }[];
  };
  scale: Record<string, number>;
}

// Per-lambda, best-effort. Blunts a multi-tab dashboard hammering the single
// pooled Neon connection that user traffic also needs.
let statsMemo: { at: number; value: StatsReport } | null = null;
const STATS_TTL_MS = 15_000;

export async function getStats(): Promise<StatsReport> {
  if (statsMemo && Date.now() - statsMemo.at < STATS_TTL_MS) return statsMemo.value;

  const now = await dbNow();
  const nowMs = now.getTime();
  const dayAgo = new Date(nowMs - 86_400_000);
  const todayStart = new Date(nowMs - 86_400_000);

  // One transaction rather than Promise.all: DATABASE_URL is Neon pooled with
  // connection_limit=1, so parallel queries serialize into N round-trips while
  // a transaction pipelines them into one.
  const [
    sheetRows,
    paused,
    archived,
    byInterval,
    groups,
    groupTotal,
    suggestionCounts,
    conflicts,
    notifMatrix,
    oldestQueued,
    failures,
    users,
    changesToday,
    snapshots,
    kpis,
    charts,
    shares,
    webhooks,
    pushSubs,
  ] = await prisma.$transaction([
    prisma.sheet.findMany({
      where: { paused: false, archivedAt: null },
      select: { id: true, label: true, pollInterval: true, lastCheckedAt: true, errorMessage: true },
      take: 5000,
    }),
    prisma.sheet.count({ where: { paused: true, archivedAt: null } }),
    prisma.sheet.count({ where: { archivedAt: { not: null } } }),
    prisma.sheet.groupBy({
      by: ["pollInterval"],
      where: { paused: false, archivedAt: null },
      orderBy: { pollInterval: "asc" },
      _count: true,
    }),
    prisma.comparisonGroup.findMany({
      where: { enabled: true },
      select: { id: true, name: true, checkInterval: true, lastCheckedAt: true },
      take: 1000,
    }),
    prisma.comparisonGroup.count(),
    prisma.suggestion.groupBy({ by: ["status"], orderBy: { status: "asc" }, _count: true }),
    prisma.suggestion.count({ where: { status: "pending", conflict: true } }),
    prisma.notificationLog.groupBy({
      by: ["channel", "status"],
      where: { createdAt: { gte: dayAgo } },
      orderBy: [{ channel: "asc" }, { status: "asc" }],
      _count: true,
    }),
    prisma.notificationLog.findFirst({
      where: { status: "queued" },
      orderBy: { deliverAfter: "asc" },
      select: { createdAt: true, deliverAfter: true },
    }),
    prisma.notificationLog.findMany({
      where: { status: "failed", createdAt: { gte: dayAgo } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, channel: true, target: true, error: true, createdAt: true },
    }),
    prisma.user.count(),
    prisma.changeLog.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.snapshot.count(),
    prisma.kpiWidget.count(),
    prisma.chartWidget.count(),
    prisma.shareLink.count({ where: { revokedAt: null } }),
    prisma.webhook.count(),
    prisma.pushSubscription.count(),
  ]);

  // $transaction widens groupBy's _count to a union of every possible shape;
  // narrow it back at the read site rather than fanning out separate queries.
  const intervalRows = byInterval as unknown as { pollInterval: number; _count: number }[];
  const suggestionRows = suggestionCounts as unknown as { status: string; _count: number }[];
  const notifRows = notifMatrix as unknown as {
    channel: string;
    status: string;
    _count: number;
  }[];

  const classified = classifySheets(sheetRows as PollRow[], nowMs);
  const groupClass = classifyGroups(groups as GroupRow[], nowMs);

  const value: StatsReport = {
    now: now.toISOString(),
    polling: {
      total: sheetRows.length + paused + archived,
      active: sheetRows.length,
      paused,
      archived,
      buckets: classified.counts,
      byInterval: intervalRows.map((r) => ({ pollInterval: r.pollInterval, count: r._count })),
      worst: classified.overdue.slice(0, 10).map((s) => ({
        id: s.id,
        label: s.label,
        pollInterval: s.pollInterval,
        overdueSeconds: s.overdueSeconds,
      })),
      errors: sheetRows
        .filter((s) => s.errorMessage)
        .slice(0, 20)
        .map((s) => ({
          id: s.id,
          label: s.label,
          errorMessage: s.errorMessage as string,
          lastCheckedAt: s.lastCheckedAt ? s.lastCheckedAt.toISOString() : null,
        })),
    },
    integrity: {
      total: groupTotal,
      enabled: groups.length,
      due: groupClass.due,
      overdue: groupClass.overdue,
      never: groupClass.never,
      suggestions: Object.fromEntries(suggestionRows.map((r) => [r.status, r._count])),
      conflicts,
    },
    notifications: {
      window: "24h",
      matrix: notifRows.map((r) => ({
        channel: r.channel,
        status: r.status,
        count: r._count,
      })),
      oldestQueued: oldestQueued
        ? {
            createdAt: oldestQueued.createdAt.toISOString(),
            deliverAfter: oldestQueued.deliverAfter ? oldestQueued.deliverAfter.toISOString() : null,
            ageMs: Math.max(0, nowMs - oldestQueued.createdAt.getTime()),
          }
        : null,
      // target holds a raw email address or push endpoint — mask it. The
      // dashboard needs to know a channel is failing, not who it failed for.
      failures: failures.map((f) => ({
        id: f.id,
        channel: f.channel,
        target: maskTarget(f.target),
        error: f.error,
        createdAt: f.createdAt.toISOString(),
      })),
    },
    scale: {
      users,
      sheetsActive: sheetRows.length,
      sheetsPaused: paused,
      sheetsArchived: archived,
      changes24h: changesToday,
      snapshots,
      kpiWidgets: kpis,
      chartWidgets: charts,
      shareLinks: shares,
      webhooks,
      pushSubscriptions: pushSubs,
      integrityChecks: groupTotal,
    },
  };

  statsMemo = { at: Date.now(), value };
  return value;
}
