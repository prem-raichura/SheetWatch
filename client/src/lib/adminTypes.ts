// Response shapes for /api/admin/*. Deliberately declared here rather than in
// src/types.ts: importing anything the app's tree touches would drag motion,
// recharts, sonner and react-router into the ops bundle.

export type ServiceState =
  | "up"
  | "stale"
  | "down"
  | "stopped"
  | "not_applicable"
  | "not_configured";

export interface ServiceReport {
  state: ServiceState;
  latencyMs?: number | null;
  reason?: string | null;
  lastBeatAt?: string | null;
  ageMs?: number | null;
  uptimeS?: number | null;
  rssMb?: number | null;
  version?: string | null;
  instance?: string | null;
  httpStatus?: number | null;
}

export interface HealthReport {
  overall: "ok" | "degraded" | "down";
  deployment: "worker" | "serverless" | "unknown";
  now: string;
  services: Record<string, ServiceReport>;
  channels: Record<string, boolean>;
  /** match is null when either side is unknown — unknown is not "mismatch". */
  versions?: { api: string | null; worker: string | null; match: boolean | null };
}

export interface CronReport {
  source: string;
  lastRunAt: string | null;
  ageMs: number | null;
  status: string | null;
  durationMs: number | null;
  data: unknown;
}

export interface PulseReport extends HealthReport {
  queues: Record<string, Record<string, number> | null> | null;
  schedulers: {
    live: Record<string, number | null> | null;
    expected: { sheets: number | null; integrity: number | null };
    reconciledAt: string | null;
    reconcileError: string | null;
  };
  cron: CronReport[];
}

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
    window: string;
    matrix: { channel: string; status: string; count: number }[];
    oldestQueued: { createdAt: string; deliverAfter: string | null; ageMs: number } | null;
    failures: { id: string; channel: string; target: string; error: string | null; createdAt: string }[];
  };
  scale: Record<string, number>;
}

export interface HistoryReport {
  now: string;
  range: "1h" | "24h" | "7d";
  bucketMs: number;
  /** Dense UTC bucket starts, oldest first; every series is aligned to it. */
  t: string[];
  /** Beats per bucket. 0 means unobserved — not "the queue was empty". */
  coverage: number[];
  series: Record<string, (number | null)[]>;
  stacks: { notifications: { key: string; values: (number | null)[] }[] };
  distributions: {
    pollInterval: { label: string; value: number }[];
    freshness: { label: string; value: number }[];
    integrity: { label: string; value: number }[];
  };
  sources: Record<string, string>;
}

export type HistoryRange = HistoryReport["range"];
export const RANGES: HistoryRange[] = ["1h", "24h", "7d"];

// The validated categorical order, declared once. Series colours are indexed
// from here and never hand-picked: --chart-1 against --chart-2 is below the
// normal-vision separation floor, which is why --series-* exists at all.
export const SERIES = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
] as const;

export const TONE: Record<ServiceState, "live" | "muted" | "alert"> = {
  up: "live",
  stale: "alert",
  down: "alert",
  stopped: "muted",
  not_applicable: "muted",
  not_configured: "muted",
};

export function isDown(state: ServiceState): boolean {
  return state === "down" || state === "stale";
}

/** Compact duration for ages and uptimes. */
export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Compact bucket size for a caption: 300000 → "5m", not "5m 0s". */
export function bucketLabel(ms: number): string {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  return `${Math.round(ms / 1000)}s`;
}

/** Never render an unknown number as 0 — an empty queue must look different. */
export function num(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toLocaleString();
}

/** Cron payloads are three known shapes plus an error — render them, don't dump JSON. */
export function cronSummary(data: unknown): { text: string; error: boolean } {
  if (!data || typeof data !== "object") return { text: "—", error: false };
  const d = data as Record<string, unknown>;

  if (typeof d.error === "string") return { text: d.error, error: true };

  const parts: string[] = [];
  const add = (key: string, label = key) => {
    if (typeof d[key] === "number") parts.push(`${label} ${d[key]}`);
  };
  // cron:poll
  add("due");
  add("checked");
  add("skipped");
  add("changed");
  add("failed");
  // cron:maintenance
  add("digests");
  add("flushed");
  add("reports");
  add("pruned");
  add("rolled");

  if (parts.length === 0) return { text: d.ok === true ? "ok" : "—", error: false };
  return { text: parts.join(" · "), error: false };
}
