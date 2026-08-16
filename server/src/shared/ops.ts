import prisma from "./prisma";

// Ops telemetry shared by the worker (which writes heartbeats), the cron
// handlers (which write run records) and the admin API (which reads both).
//
// Everything below the classifiers is best-effort by design: telemetry must
// never be able to fail the thing it is measuring.

export type OpsSource = "worker" | "cron:poll" | "cron:integrity" | "cron:maintenance";
export type OpsStatus = "ok" | "degraded" | "error" | "stopped";

export interface OpsRecord {
  source: OpsSource;
  status?: OpsStatus;
  instance?: string | null;
  durationMs?: number | null;
  version?: string | null;
  data?: Record<string, unknown>;
}

/** Worker beat cadence. Down detection is three missed beats. */
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const HEARTBEAT_STALE_MS = HEARTBEAT_INTERVAL_MS * 3; // 90s
export const HEARTBEAT_DOWN_MS = 10 * 60_000;

// Never rejects. A telemetry write failing is worth a log line and nothing more
// — it must not surface as an unhandled rejection inside a timer, which under
// Node 20 would take the worker process down.
export async function recordOps(record: OpsRecord): Promise<void> {
  try {
    await prisma.opsHeartbeat.create({
      data: {
        source: record.source,
        status: record.status ?? "ok",
        instance: record.instance ?? null,
        durationMs: record.durationMs ?? null,
        version: record.version ?? null,
        data: (record.data ?? {}) as object,
      },
    });
  } catch (err) {
    console.error("Ops heartbeat write failed:", (err as Error)?.message ?? err);
  }
}

export async function pruneOps(retentionHours = 24): Promise<number> {
  const cutoff = new Date(Date.now() - retentionHours * 3600_000);
  const { count } = await prisma.opsHeartbeat.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return count;
}

// ---- pure classifiers (unit-tested; no DB, no clock of their own) ----------
//
// Every one takes `now` explicitly. Three different clocks write the timestamps
// these compare against — the worker VM, Vercel lambdas and Postgres defaults —
// so the caller passes a single reference instant read from the database.

export type ServiceState =
  | "up"
  | "stale"
  | "down"
  | "stopped"
  | "not_applicable"
  | "not_configured";

export interface HeartbeatRow {
  status: string;
  createdAt: Date;
  instance: string | null;
  version: string | null;
  data: unknown;
}

export interface WorkerVerdict {
  state: ServiceState;
  lastBeatAt: string | null;
  ageMs: number | null;
  reason: string | null;
}

// `expectWorker` comes from ADMIN_EXPECT_WORKER on the API deployment. Without
// it, "no heartbeats" is ambiguous: a serverless install that never had a
// worker looks exactly like one whose worker died more than 24h ago, since the
// prune has by then removed its last beat.
export function classifyHeartbeat(
  latest: HeartbeatRow | null,
  nowMs: number,
  expectWorker: boolean
): WorkerVerdict {
  if (!latest) {
    return {
      state: expectWorker ? "down" : "not_applicable",
      lastBeatAt: null,
      ageMs: null,
      reason: expectWorker ? "no heartbeat ever recorded" : null,
    };
  }

  const ageMs = Math.max(0, nowMs - latest.createdAt.getTime());
  const base = { lastBeatAt: latest.createdAt.toISOString(), ageMs };

  // A clean shutdown is not an alarm — it is someone deploying.
  if (latest.status === "stopped") {
    return { ...base, state: "stopped", reason: "worker stopped cleanly" };
  }
  if (ageMs <= HEARTBEAT_STALE_MS) return { ...base, state: "up", reason: null };
  if (ageMs <= HEARTBEAT_DOWN_MS) {
    return { ...base, state: "stale", reason: `no beat for ${Math.round(ageMs / 1000)}s` };
  }
  return { ...base, state: "down", reason: `no beat for ${Math.round(ageMs / 60_000)}m` };
}

const RANK: Record<ServiceState, number> = {
  down: 3,
  stale: 2,
  stopped: 2,
  up: 0,
  not_applicable: 0,
  not_configured: 0,
};

export type Overall = "ok" | "degraded" | "down";

// A service that isn't part of this deployment can never degrade it.
export function rollupOverall(states: ServiceState[]): Overall {
  let worst = 0;
  for (const s of states) worst = Math.max(worst, RANK[s] ?? 0);
  if (worst >= 3) return "down";
  if (worst >= 2) return "degraded";
  return "ok";
}

// ---- poll classification --------------------------------------------------

// These are the exact strings poll.ts writes. Matching on them is fragile, and
// deliberately pinned by a test so rewording there fails CI rather than
// silently turning "user must re-authorize" into "infrastructure is broken".
export const PERMANENT_ERRORS = [
  "Access denied — re-authorize in the app.",
  "Sheet not found or deleted.",
];
export const TRANSIENT_ERROR_PREFIX = "Google API temporarily unreachable";

/** Grace on top of 2× the interval, absorbing a poll that is simply in flight. */
export const OVERDUE_GRACE_MS = 30_000;

export interface PollRow {
  id: string;
  label: string;
  pollInterval: number;
  lastCheckedAt: Date | null;
  errorMessage: string | null;
}

export type PollBucket = "blocked" | "transient" | "overdue" | "due" | "ok";

export interface PollClassification {
  counts: Record<PollBucket, number>;
  overdue: (PollRow & { overdueSeconds: number })[];
}

// Why buckets rather than a single "overdue" number: poll.ts does NOT advance
// lastCheckedAt on 401/403/404, so under BullMQ those sheets are still being
// polled on schedule yet look infinitely overdue. Under the cron path,
// claimSheet advances it *before* fetching, so the same sheet looks fresh. A
// naive count is wrong in opposite directions per deployment; separating the
// permanent-error sheets out makes both readings honest.
export function classifySheets(rows: PollRow[], nowMs: number): PollClassification {
  const counts: Record<PollBucket, number> = {
    blocked: 0,
    transient: 0,
    overdue: 0,
    due: 0,
    ok: 0,
  };
  const overdue: (PollRow & { overdueSeconds: number })[] = [];

  for (const row of rows) {
    const err = row.errorMessage ?? "";
    if (PERMANENT_ERRORS.includes(err)) {
      counts.blocked++;
      continue;
    }

    const transient = err.startsWith(TRANSIENT_ERROR_PREFIX);
    if (transient) counts.transient++;

    const intervalMs = row.pollInterval * 1000;
    const age = row.lastCheckedAt ? nowMs - row.lastCheckedAt.getTime() : null;

    // Never polled yet is "due", not "overdue" — a sheet added ten seconds ago
    // hasn't missed anything.
    if (age === null) {
      counts.due++;
      continue;
    }
    if (age >= intervalMs * 2 + OVERDUE_GRACE_MS) {
      counts.overdue++;
      overdue.push({ ...row, overdueSeconds: Math.round(age / 1000) });
    } else if (age >= intervalMs) {
      counts.due++;
    } else if (!transient) {
      counts.ok++;
    }
  }

  overdue.sort((a, b) => b.overdueSeconds - a.overdueSeconds);
  return { counts, overdue };
}

// ---- integrity classification ---------------------------------------------

/** Same slack recomputeAllGroups uses, so dashboard and sweep agree on "due". */
export const INTEGRITY_SLACK_MS = 5_000;

export interface GroupRow {
  id: string;
  name: string;
  checkInterval: number;
  lastCheckedAt: Date | null;
}

export function classifyGroups(
  rows: GroupRow[],
  nowMs: number
): { due: number; overdue: number; never: number } {
  let due = 0;
  let overdue = 0;
  let never = 0;

  for (const row of rows) {
    if (!row.lastCheckedAt) {
      never++;
      continue;
    }
    const age = nowMs - row.lastCheckedAt.getTime();
    const intervalMs = row.checkInterval * 1000;
    if (age >= intervalMs * 2 + OVERDUE_GRACE_MS) overdue++;
    else if (age >= intervalMs - INTEGRITY_SLACK_MS) due++;
  }
  return { due, overdue, never };
}

// Version skew between the API and the worker is a top cause of confusing ops
// behaviour, so compare them here rather than making the client diff strings.
// Compares on the first 7 characters: Vercel exposes a full sha while
// docker-compose is documented with `git rev-parse --short`, and reading that
// as skew would be the obvious false positive. Unknown is never "mismatch".
export function compareVersions(
  api: string | null | undefined,
  worker: string | null | undefined
): boolean | null {
  if (!api || !worker) return null;
  return api.slice(0, 7).toLowerCase() === worker.slice(0, 7).toLowerCase();
}

// A NotificationLog target is a raw email address or a push endpoint URL.
// The dashboard shows failures; it has no business showing addresses.
export function maskTarget(target: string): string {
  if (target.includes("@")) {
    const [local, domain] = target.split("@");
    return `${local.slice(0, 2)}***@${domain}`;
  }
  try {
    return new URL(target).host;
  } catch {
    return target.slice(0, 24);
  }
}
