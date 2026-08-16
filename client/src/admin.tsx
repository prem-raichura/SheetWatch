import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { API_BASE } from "./lib/api";
import PulseDot from "./components/PulseDot";
import { SkeletonChart } from "./components/Skeleton";
import Chart from "./components/ops/Chart";
import { Lines, MeterRows, Sparkline } from "./components/ops/marks";
import { ThemeProvider } from "./providers/ThemeProvider";
import {
  bucketLabel,
  cronSummary,
  duration,
  isDown,
  num,
  RANGES,
  SERIES,
  TONE,
  type HistoryRange,
  type HistoryReport,
  type PulseReport,
  type ServiceReport,
  type ServiceState,
  type StatsReport,
} from "./lib/adminTypes";
import "./styles/index.css";

// Ops dashboard — its own HTML entry, its own bundle, not a route in the app.
// Read-only: everything here is a GET. Deliberately imports nothing from
// App/AppLayout/providers beyond ThemeProvider, so the app's dependency graph
// stays out of this bundle.

type Fetched<T> = { data: T | null; error: string | null; status: number | null };

const MOCK = new URLSearchParams(location.search).get("mock");

async function get<T>(path: string): Promise<Fetched<T>> {
  // DEV-only: /admin?mock=worker-down renders any state with no backend. The
  // import is dynamic and DEV-gated so fixtures never reach production.
  if (import.meta.env.DEV && MOCK) {
    const fixtures = await import("./lib/adminFixtures");
    // Order matters: /history carries a query string, so a loose "includes"
    // chain would fall through to the pulse branch.
    const data = path.includes("/history")
      ? fixtures.mockHistory(MOCK, new URLSearchParams(path.split("?")[1]).get("range") ?? "24h")
      : path.includes("/stats")
        ? fixtures.mockStats()
        : fixtures.mockPulse(MOCK);
    return { data: data as T, error: null, status: 200 };
  }
  try {
    const res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
    if (!res.ok) {
      return { data: null, error: `HTTP ${res.status}`, status: res.status };
    }
    return { data: (await res.json()) as T, error: null, status: 200 };
  } catch (err) {
    return { data: null, error: (err as Error)?.message ?? "unreachable", status: null };
  }
}

// Polls on an interval, but only while the tab is visible — a backgrounded
// dashboard hammering Vercel forever is a real cost item. Backs off after
// repeated failures so an outage isn't made worse by this page.
function usePoll<T>(path: string, intervalMs: number, live: boolean) {
  const [state, setState] = useState<Fetched<T>>({ data: null, error: null, status: null });
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const failures = useRef(0);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const next = await get<T>(path);
    failures.current = next.error ? failures.current + 1 : 0;
    setState((prev) => (next.error && prev.data ? { ...prev, error: next.error } : next));
    if (!next.error) setUpdatedAt(Date.now());
  }, [path]);

  const loadedOnce = useRef(false);

  useEffect(() => {
    let stopped = false;

    const schedule = () => {
      if (stopped) return;
      const backoff = Math.min(60_000, intervalMs * 2 ** Math.max(0, failures.current - 2));
      timer.current = window.setTimeout(run, failures.current >= 3 ? backoff : intervalMs);
    };
    const run = async () => {
      // The visibility gate is about not polling a backgrounded tab forever —
      // it must never withhold the FIRST load, or a dashboard opened in a
      // background tab sits on "connecting…" until someone focuses it.
      const visible = document.visibilityState === "visible";
      if (!loadedOnce.current || (live && visible)) {
        loadedOnce.current = true;
        await load();
      }
      schedule();
    };

    void run();
    const onFocus = () => {
      if (live) void load();
    };
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      stopped = true;
      if (timer.current) window.clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load, intervalMs, live]);

  return { ...state, updatedAt, reload: load };
}

// Live vitals: the numbers a system monitor keeps on screen, sampled from the
// pulse poll and kept in a bounded ring so the sparkline shows the last few
// minutes without another request.
const VITAL_SAMPLES = 60;

interface Vitals {
  postgresMs: (number | null)[];
  redisMs: (number | null)[];
  rssMb: (number | null)[];
  queueWaiting: (number | null)[];
  realtimeMs: (number | null)[];
}

const emptyVitals = (): Vitals => ({
  postgresMs: [],
  redisMs: [],
  rssMb: [],
  queueWaiting: [],
  realtimeMs: [],
});

function useVitals(pulse: PulseReport | null, at: number | null): Vitals {
  const [vitals, setVitals] = useState<Vitals>(emptyVitals);
  const lastSample = useRef<number | null>(null);

  useEffect(() => {
    if (!pulse || at === null || lastSample.current === at) return;
    lastSample.current = at;

    const queues = pulse.queues;
    const waiting =
      queues === null
        ? null
        : Object.values(queues).reduce<number | null>((total, counts) => {
            if (!counts) return total;
            return (total ?? 0) + (counts.waiting ?? 0);
          }, null);

    const push = (list: (number | null)[], value: number | null) =>
      [...list, value].slice(-VITAL_SAMPLES);

    setVitals((prev) => ({
      postgresMs: push(prev.postgresMs, pulse.services.postgres?.latencyMs ?? null),
      redisMs: push(prev.redisMs, pulse.services.redis?.latencyMs ?? null),
      rssMb: push(prev.rssMb, pulse.services.worker?.rssMb ?? null),
      queueWaiting: push(prev.queueWaiting, waiting),
      realtimeMs: push(prev.realtimeMs, pulse.services.realtime?.latencyMs ?? null),
    }));
  }, [pulse, at]);

  return vitals;
}

const card = "rounded-2xl border border-line bg-surface p-4 shadow-card";
const label = "font-mono text-[11px] uppercase tracking-wider text-ink-400";

function Tile({ name, report }: { name: string; report: ServiceReport | undefined }) {
  const state = report?.state ?? "not_applicable";
  const detail =
    report?.reason ??
    (report?.latencyMs !== null && report?.latencyMs !== undefined
      ? `${report.latencyMs} ms`
      : report?.uptimeS
        ? `up ${duration(report.uptimeS * 1000)}`
        : state.replace("_", " "));

  return (
    <div
      className={`rounded-xl border bg-surface px-3 py-2.5 ${
        isDown(state) ? "border-coral/50 border-l-4 border-l-coral" : "border-line"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <PulseDot tone={TONE[state]} />
        <span className="truncate text-sm font-semibold text-ink-900">{name}</span>
      </div>
      <div
        className={`mt-1 truncate font-mono text-[11px] ${
          isDown(state) ? "text-coral-600" : "text-ink-400"
        }`}
        title={detail}
      >
        {detail}
      </div>
    </div>
  );
}

function Stat({ name, value, tone }: { name: string; value: string; tone?: "alert" | "warn" }) {
  return (
    <div className="rounded-xl border border-line bg-paper px-3 py-2">
      <div className={label}>{name}</div>
      <div
        className={`mt-0.5 font-display text-xl font-bold ${
          tone === "alert" ? "text-coral-600" : tone === "warn" ? "text-warning-strong" : "text-ink-900"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

const QUEUE_KEYS = ["waiting", "active", "delayed", "failed", "completed"];

function Queues({ pulse }: { pulse: PulseReport }) {
  const queues = pulse.queues;
  const live = pulse.schedulers.live;
  const expected = pulse.schedulers.expected;
  const mismatch =
    live?.poll !== null && live?.poll !== undefined && expected.sheets !== null
      ? live.poll !== expected.sheets
      : false;

  return (
    <section className={card}>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-bold text-ink-900">Queues</h2>
        <span className="font-mono text-[11px] text-ink-400">
          reconciled {pulse.schedulers.reconciledAt ? duration(Date.now() - new Date(pulse.schedulers.reconciledAt).getTime()) + " ago" : "—"}
        </span>
      </div>

      {queues === null ? (
        <p className="mt-3 font-mono text-xs text-coral-600">
          queue depth unreadable — no live worker reporting
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full font-mono text-xs">
            <thead>
              <tr className="text-ink-400">
                <th className="py-1 text-left font-medium">queue</th>
                {QUEUE_KEYS.map((k) => (
                  <th key={k} className="py-1 text-right font-medium">
                    {k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(queues).map(([name, counts]) => (
                <tr key={name} className="border-t border-line">
                  <td className="py-1.5 font-semibold text-ink-900">{name}</td>
                  {QUEUE_KEYS.map((k) => (
                    <td
                      key={k}
                      className={`py-1.5 text-right ${
                        k === "failed" && (counts?.[k] ?? 0) > 0 ? "text-coral-600" : "text-ink-700"
                      }`}
                    >
                      {num(counts?.[k])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-3 font-mono text-[11px]">
        <span className={mismatch ? "text-coral-600" : "text-ink-400"}>
          schedulers poll={num(live?.poll)} · expects {num(expected.sheets)}
          {mismatch ? " — MISMATCH" : ""}
        </span>
        <span className="text-ink-400">
          integrity={num(live?.compare)} · expects {num(expected.integrity)}
        </span>
        {pulse.schedulers.reconcileError && (
          <span className="text-coral-600">reconcile error: {pulse.schedulers.reconcileError}</span>
        )}
      </div>
    </section>
  );
}

function Cron({ pulse }: { pulse: PulseReport }) {
  return (
    <section className={card}>
      <h2 className="font-display text-sm font-bold text-ink-900">Cron</h2>
      <div className="mt-3 space-y-2">
        {pulse.cron.map((c) => {
          const stale = c.ageMs === null || c.ageMs > 15 * 60_000;
          return (
            <div key={c.source} className="flex flex-wrap items-center gap-2 font-mono text-xs">
              <PulseDot tone={stale ? "alert" : "live"} />
              <span className="w-40 font-semibold text-ink-900">{c.source}</span>
              <span className={stale ? "text-coral-600" : "text-ink-500"}>
                {c.lastRunAt ? `ran ${duration(c.ageMs)} ago` : "never seen"}
              </span>
              {c.status && c.status !== "ok" && (
                <span className="text-coral-600">{c.status}</span>
              )}
              {c.durationMs !== null && <span className="text-ink-400">{c.durationMs} ms</span>}
              {(() => {
                const summary = cronSummary(c.data);
                return (
                  <span className={`truncate ${summary.error ? "text-coral-600" : "text-ink-400"}`}>
                    {summary.text}
                  </span>
                );
              })()}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Polling({ stats }: { stats: StatsReport }) {
  const b = stats.polling.buckets;
  return (
    <section className={card}>
      <h2 className="font-display text-sm font-bold text-ink-900">Polling</h2>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Stat name="total" value={num(stats.polling.total)} />
        <Stat name="active" value={num(stats.polling.active)} />
        <Stat name="paused" value={num(stats.polling.paused)} />
        <Stat name="due" value={num(b.due)} />
        <Stat name="overdue" value={num(b.overdue)} tone={b.overdue > 0 ? "alert" : undefined} />
        <Stat name="blocked" value={num(b.blocked)} tone={b.blocked > 0 ? "warn" : undefined} />
        <Stat name="transient" value={num(b.transient)} tone={b.transient > 0 ? "warn" : undefined} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2 font-mono text-[11px] text-ink-500">
        {stats.polling.byInterval.map((i) => (
          <span key={i.pollInterval} className="rounded-full border border-line px-2 py-0.5">
            {i.pollInterval < 3600 ? `${i.pollInterval / 60}m` : `${i.pollInterval / 3600}h`} ·{" "}
            {i.count}
          </span>
        ))}
      </div>

      {stats.polling.worst.length > 0 && (
        <div className="mt-4">
          <div className={label}>most overdue</div>
          <table className="mt-1 w-full font-mono text-xs">
            <tbody>
              {stats.polling.worst.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <td className="max-w-[280px] truncate py-1.5 text-ink-700">{s.label}</td>
                  <td className="py-1.5 text-right text-ink-400">every {s.pollInterval}s</td>
                  <td className="py-1.5 text-right text-coral-600">
                    {duration(s.overdueSeconds * 1000)} late
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {stats.polling.errors.length > 0 && (
        <div className="mt-4">
          <div className={label}>sheets reporting an error</div>
          <table className="mt-1 w-full font-mono text-xs">
            <tbody>
              {stats.polling.errors.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <td className="max-w-[240px] truncate py-1.5 text-ink-700">{s.label}</td>
                  <td className="truncate py-1.5 text-coral-600">{s.errorMessage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Notifications({ stats }: { stats: StatsReport }) {
  const { matrix, oldestQueued, failures } = stats.notifications;
  const channels = useMemo(() => [...new Set(matrix.map((m) => m.channel))], [matrix]);
  const statuses = ["sent", "queued", "failed", "suppressed"];
  // One lookup table instead of a find() per cell.
  const counts = useMemo(
    () => new Map(matrix.map((m) => [`${m.channel}|${m.status}`, m.count])),
    [matrix]
  );

  return (
    <section className={card}>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-bold text-ink-900">Notifications</h2>
        <span className={label}>last {stats.notifications.window}</span>
      </div>

      {channels.length === 0 ? (
        <p className="mt-3 font-mono text-xs text-ink-400">nothing sent in the window</p>
      ) : (
        <table className="mt-3 w-full font-mono text-xs">
          <thead>
            <tr className="text-ink-400">
              <th className="py-1 text-left font-medium">channel</th>
              {statuses.map((s) => (
                <th key={s} className="py-1 text-right font-medium">
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {channels.map((channel) => (
              <tr key={channel} className="border-t border-line">
                <td className="py-1.5 font-semibold text-ink-900">{channel}</td>
                {statuses.map((status) => {
                  const cell = counts.get(`${channel}|${status}`);
                  return (
                    <td
                      key={status}
                      className={`py-1.5 text-right ${
                        status === "failed" && cell ? "text-coral-600" : "text-ink-700"
                      }`}
                    >
                      {cell === undefined ? "·" : cell.toLocaleString()}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {oldestQueued && (
        <p className="mt-3 flex items-center gap-1.5 font-mono text-[11px] text-ink-700">
          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
          oldest queued notification is {duration(oldestQueued.ageMs)} old
        </p>
      )}

      {failures.length > 0 && (
        <div className="mt-4">
          <div className={label}>recent failures</div>
          <table className="mt-1 w-full font-mono text-xs">
            <tbody>
              {failures.map((f) => (
                <tr key={f.id} className="border-t border-line">
                  <td className="py-1.5 text-ink-500">{f.channel}</td>
                  <td className="py-1.5 text-ink-700">{f.target}</td>
                  <td className="max-w-[320px] truncate py-1.5 text-coral-600">{f.error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Integrity({ stats }: { stats: StatsReport }) {
  const i = stats.integrity;
  return (
    <section className={card}>
      <h2 className="font-display text-sm font-bold text-ink-900">Integrity checks</h2>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat name="enabled" value={`${num(i.enabled)} / ${num(i.total)}`} />
        <Stat name="due" value={num(i.due)} />
        <Stat name="overdue" value={num(i.overdue)} tone={i.overdue > 0 ? "alert" : undefined} />
        <Stat name="never run" value={num(i.never)} tone={i.never > 0 ? "warn" : undefined} />
        <Stat name="pending" value={num(i.suggestions.pending ?? 0)} />
        <Stat name="conflicts" value={num(i.conflicts)} tone={i.conflicts > 0 ? "warn" : undefined} />
      </div>
    </section>
  );
}

function Scale({ stats }: { stats: StatsReport }) {
  return (
    <section className={card}>
      <h2 className="font-display text-sm font-bold text-ink-900">Scale</h2>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {Object.entries(stats.scale).map(([name, value]) => (
          <Stat key={name} name={name.replace(/([A-Z])|(\d+)/g, " $1$2").trim().toLowerCase()} value={num(value)} />
        ))}
      </div>
    </section>
  );
}


// ---- chart sections --------------------------------------------------------

function Vital({
  name,
  value,
  unit,
  samples,
  color,
  state,
}: {
  name: string;
  value: number | null | undefined;
  unit: string;
  samples: (number | null)[];
  color: string;
  state?: ServiceState;
}) {
  const real = samples.filter((v): v is number => v !== null);
  const peak = real.length ? Math.max(...real) : null;
  const offline = state ? isDown(state) : false;

  return (
    <div
      className={`rounded-2xl border bg-surface px-4 py-3 shadow-card ${
        offline ? "border-coral/40" : "border-line"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={label}>{name}</span>
        {state && <PulseDot tone={TONE[state]} />}
      </div>
      <div className="mt-1 flex items-end justify-between gap-3">
        <div className="font-display text-2xl font-bold tracking-tight text-ink-900">
          {value === null || value === undefined ? (
            <span className="text-ink-300">—</span>
          ) : (
            <>
              {value.toLocaleString()}
              <span className="ml-0.5 font-mono text-xs font-medium text-ink-400">{unit}</span>
            </>
          )}
        </div>
        <Sparkline values={samples} color={color} />
      </div>
      <div className="mt-1 font-mono text-[10px] text-ink-400">
        {peak === null ? "no samples yet" : `peak ${peak.toLocaleString()}${unit} · last ${real.length} samples`}
      </div>
    </div>
  );
}

function LiveVitals({ pulse, vitals }: { pulse: PulseReport; vitals: Vitals }) {
  const queues = pulse.queues;
  const waiting =
    queues === null
      ? null
      : Object.values(queues).reduce<number | null>((total, counts) => {
          if (!counts) return total;
          return (total ?? 0) + (counts.waiting ?? 0);
        }, null);

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Vital
        name="postgres"
        value={pulse.services.postgres?.latencyMs}
        unit="ms"
        samples={vitals.postgresMs}
        color={SERIES[0]}
        state={pulse.services.postgres?.state}
      />
      <Vital
        name="redis"
        value={pulse.services.redis?.latencyMs}
        unit="ms"
        samples={vitals.redisMs}
        color={SERIES[3]}
        state={pulse.services.redis?.state}
      />
      <Vital
        name="worker memory"
        value={pulse.services.worker?.rssMb}
        unit="MB"
        samples={vitals.rssMb}
        color={SERIES[4]}
        state={pulse.services.worker?.state}
      />
      <Vital name="queue backlog" value={waiting} unit="" samples={vitals.queueWaiting} color={SERIES[1]} />
      <Vital
        name="realtime"
        value={pulse.services.realtime?.latencyMs}
        unit="ms"
        samples={vitals.realtimeMs}
        color={SERIES[2]}
        state={pulse.services.realtime?.state}
      />
    </div>
  );
}

function ChartCard({
  title,
  hint,
  loading,
  children,
}: {
  title: string;
  hint?: string;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={card}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-sm font-bold text-ink-900">{title}</h2>
        {hint && <span className={label}>{hint}</span>}
      </div>
      <div className="mt-3">{loading ? <SkeletonChart wide count={12} className="!border-0 !p-0 !shadow-none" /> : children}</div>
    </section>
  );
}

function Throughput({ history }: { history: HistoryReport }) {
  const series = [
    { key: "checked", label: "checked", color: SERIES[0], values: history.series.checked ?? [] },
    { key: "changed", label: "changed", color: SERIES[1], values: history.series.changed ?? [] },
    // failed is a status, not a series — the destructive token is legal here.
    { key: "failed", label: "failed", color: "var(--destructive)", values: history.series.failed ?? [] },
  ];

  return (
    <ChartCard title="Throughput" hint={`per ${bucketLabel(history.bucketMs)}`}>
      <Chart series={series} t={history.t} coverage={history.coverage}>
        {(ctx) => <Lines ctx={ctx} series={series} />}
      </Chart>
    </ChartCard>
  );
}

function QueueDepth({ history }: { history: HistoryReport }) {
  const series = [
    { key: "waiting", label: "waiting", color: SERIES[0], values: history.series.queueWaiting ?? [] },
    { key: "failed", label: "failed", color: "var(--destructive)", values: history.series.queueFailed ?? [] },
  ];
  return (
    <ChartCard title="Queue depth" hint="max per bucket">
      <Chart series={series} t={history.t} coverage={history.coverage}>
        {(ctx) => <Lines ctx={ctx} series={series} />}
      </Chart>
    </ChartCard>
  );
}

// Latency and memory get their own charts rather than a shared axis: ms and MB
// are not comparable, and a dual axis would invent a relationship between them.
function RedisLatency({ history }: { history: HistoryReport }) {
  const series = [{ key: "redis", label: "redis latency", color: SERIES[3], values: history.series.redisMs ?? [] }];
  return (
    <ChartCard title="Redis latency" hint="ms">
      <Chart series={series} t={history.t} coverage={history.coverage} unit="ms" height={140}>
        {(ctx) => <Lines ctx={ctx} series={series} area />}
      </Chart>
    </ChartCard>
  );
}

function WorkerMemory({ history }: { history: HistoryReport }) {
  const series = [{ key: "rss", label: "worker memory", color: SERIES[4], values: history.series.rssMb ?? [] }];
  return (
    <ChartCard title="Worker memory" hint="MB">
      <Chart series={series} t={history.t} coverage={history.coverage} unit="MB" height={140}>
        {(ctx) => <Lines ctx={ctx} series={series} area />}
      </Chart>
    </ChartCard>
  );
}

function Delivery({ history }: { history: HistoryReport }) {
  const series = history.stacks.notifications.map((stack, i) => ({
    key: stack.key,
    label: stack.key,
    color: stack.key === "failed" ? "var(--destructive)" : SERIES[i],
    values: stack.values,
  }));
  if (series.length === 0) return null;

  return (
    <ChartCard title="Delivery" hint={`per ${bucketLabel(history.bucketMs)}`}>
      <Chart series={series} t={history.t}>
        {(ctx) => <Lines ctx={ctx} series={series} />}
      </Chart>
    </ChartCard>
  );
}

function Coverage({ history }: { history: HistoryReport }) {
  const { pollInterval, freshness, integrity } = history.distributions;
  return (
    <section className={card}>
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-sm font-bold text-ink-900">Coverage</h2>
        {/* "now", not the selected range — these are point-in-time shapes. */}
        <span className={label}>now</span>
      </div>
      <div className="mt-3 grid gap-5 sm:grid-cols-3 xl:grid-cols-1">
        <div>
          <div className={`${label} mb-2`}>poll interval</div>
          <MeterRows bins={pollInterval} color={SERIES[0]} />
        </div>
        <div>
          <div className={`${label} mb-2`}>sheet freshness</div>
          <MeterRows bins={freshness} color={SERIES[1]} />
        </div>
        <div>
          <div className={`${label} mb-2`}>integrity staleness</div>
          <MeterRows bins={integrity} color={SERIES[2]} />
        </div>
      </div>
    </section>
  );
}

const VERDICT: Record<string, { text: string; className: string; tone: "live" | "muted" | "alert" }> = {
  ok: { text: "All systems normal", className: "border-teal/40 bg-teal-soft text-teal-600", tone: "live" },
  degraded: { text: "Degraded", className: "border-warning/50 bg-warning-soft text-warning-strong", tone: "alert" },
  down: { text: "Down", className: "border-coral/50 bg-coral-soft text-coral-600", tone: "alert" },
};

function AdminApp() {
  const [live, setLive] = useState(true);
  const [range, setRange] = useState<HistoryRange>("24h");

  // Vitals sample on the fast poll; the heavier endpoints stay slow.
  const pulse = usePoll<PulseReport>("/api/admin/pulse", 5_000, live);
  const stats = usePoll<StatsReport>("/api/admin/stats", 60_000, live);
  const history = usePoll<HistoryReport>(`/api/admin/history?range=${range}`, 60_000, live);
  const vitals = useVitals(pulse.data, pulse.updatedAt);

  if (pulse.status === 401)
    return <Gate title="Sign in" body="This page needs a signed-in session." href="/login" cta="Go to sign in" />;
  if (pulse.status === 404)
    return (
      <Gate
        title="Not available"
        body="This account doesn't have ops access."
        href="/overview"
        cta="Back to SheetWatch"
      />
    );

  const p = pulse.data;
  const down = p ? Object.entries(p.services).filter(([, s]) => isDown(s.state)) : [];
  const verdict = VERDICT[p?.overall ?? "ok"];
  const skew = p?.versions?.match === false;

  return (
    <div className="min-h-screen bg-paper">
      {/* Full-bleed shell with a sticky header, matching the app's chrome. */}
      <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur">
        <div className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <span className="font-display text-lg font-bold tracking-tight text-ink-900">
              SheetWatch
            </span>
            <span className={label}>ops</span>
            {p && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${verdict.className}`}
              >
                <PulseDot tone={verdict.tone} />
                {verdict.text}
              </span>
            )}
            {skew && (
              <span
                title="The worker is running different code from the API. Normal for the minutes of a rolling deploy."
                className="rounded-full border border-warning/50 bg-warning-soft px-2.5 py-1 text-xs font-semibold text-warning-strong"
              >
                version skew
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-line bg-surface p-0.5">
              {RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`rounded-md px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors ${
                    range === r ? "bg-foreground text-background" : "text-ink-500 hover:text-ink-900"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            <button
              onClick={() => setLive((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[11px] font-semibold transition-colors ${
                live
                  ? "border-teal/40 bg-teal-soft text-teal-600"
                  : "border-line bg-surface text-ink-700 hover:border-teal/40"
              }`}
            >
              <PulseDot tone={live ? "live" : "muted"} />
              {live ? "live" : "paused"}
            </button>
            <button
              onClick={() => {
                void pulse.reload();
                void stats.reload();
                void history.reload();
              }}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 font-mono text-[11px] font-semibold text-ink-700 transition-colors hover:border-teal/40 hover:text-teal-600"
            >
              ↻ refresh
            </button>
          </div>
        </div>

        <div className="w-full px-4 pb-2 font-mono text-[11px] text-ink-400 sm:px-6 lg:px-8">
          {p ? `${p.deployment} deployment` : "connecting…"}
          {p?.versions?.api ? ` · api ${p.versions.api.slice(0, 7)}` : ""}
          {p?.versions?.worker ? ` · worker ${p.versions.worker.slice(0, 7)}` : ""}
          {pulse.updatedAt ? ` · updated ${duration(Date.now() - pulse.updatedAt)} ago` : ""}
          {pulse.error ? ` · last refresh failed (${pulse.error})` : ""}
          {down.length > 0 && (
            <span className="text-coral-600">
              {" "}
              · down: {down.map(([name, s]) => `${name} (${s.reason ?? s.state})`).join(" · ")}
            </span>
          )}
        </div>
      </header>

      <main className="w-full space-y-4 px-4 py-5 sm:px-6 lg:px-8">
        {p ? (
          <>
            <LiveVitals pulse={p} vitals={vitals} />
            {/* postgres, redis and realtime already carry their state in the
                vitals row above, so the strip covers what's left. */}
            <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
              {["api", "worker"].map((name) => (
                <Tile key={name} name={name} report={p.services[name]} />
              ))}
              {["email", "telegram", "push"].map((name) => (
                <Tile key={name} name={name} report={{ state: p.channels[name] ? "up" : "not_configured" }} />
              ))}
            </div>
          </>
        ) : (
          <div className={`${card} font-mono text-xs text-ink-400`}>
            {pulse.error ? `Couldn't reach the API: ${pulse.error}` : "loading…"}
          </div>
        )}

        {history.data ? (
          <>
            <div className="grid items-start gap-4 xl:grid-cols-3">
              <div className="xl:col-span-2">
                <Throughput history={history.data} />
              </div>
              <QueueDepth history={history.data} />
            </div>

            <div className="grid items-start gap-4 xl:grid-cols-3">
              <RedisLatency history={history.data} />
              <WorkerMemory history={history.data} />
              <Delivery history={history.data} />
            </div>
          </>
        ) : (
          <ChartCard title="Throughput" loading>
            <span />
          </ChartCard>
        )}

        <div className="grid items-start gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            {p && (p.deployment === "serverless" ? <Cron pulse={p} /> : <Queues pulse={p} />)}
          </div>
          {history.data && <Coverage history={history.data} />}
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">{stats.data && <Notifications stats={stats.data} />}</div>
          {stats.data && <Integrity stats={stats.data} />}
        </div>

        {stats.data && <Polling stats={stats.data} />}
        {stats.data && <Scale stats={stats.data} />}
      </main>
    </div>
  );
}

function Gate({ title, body, href, cta }: { title: string; body: string; href: string; cta: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className={`${card} max-w-sm text-center`}>
        <h1 className="font-display text-lg font-bold text-ink-900">{title}</h1>
        <p className="mt-1 text-sm text-ink-500">{body}</p>
        <a
          href={href}
          className="mt-4 inline-block rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background"
        >
          {cta}
        </a>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <AdminApp />
  </ThemeProvider>
);
