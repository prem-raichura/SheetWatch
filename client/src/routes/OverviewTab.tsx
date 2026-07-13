import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Check, Eye, EyeOff, GripVertical, LayoutGrid } from "lucide-react";
import { useOverview } from "../hooks/useOverview";
import { useChanges } from "../hooks/useChanges";
import { usePrefs } from "../providers/PrefsProvider";
import { DASHBOARD_SECTIONS } from "../lib/prefs";
import { formatTimeAgo } from "../lib/format";
import PulseDot from "../components/PulseDot";
import ActivityChart from "../components/ActivityChart";
import DigestSettings from "../components/DigestSettings";
import KpiStrip from "../components/KpiStrip";
import ChartsSection from "../components/charts/ChartsSection";
import HeatmapCalendar from "../components/charts/HeatmapCalendar";
import { SkeletonStats, SkeletonRows, SkeletonChart } from "../components/Skeleton";

function Stat({
  value,
  label,
  tone = "ink",
  to,
}: {
  value: number | string;
  label: string;
  tone?: "ink" | "teal" | "coral";
  to?: string;
}) {
  const color =
    tone === "teal" ? "text-teal-600" : tone === "coral" ? "text-coral-600" : "text-ink-900";
  const inner = (
    <div className="rounded-2xl border border-line bg-surface px-5 py-4 shadow-card transition-colors hover:border-ink-300">
      <div className={`font-display text-3xl font-bold tracking-tight ${color}`}>{value}</div>
      <div className="mt-1 font-mono text-[11px] uppercase tracking-wider text-ink-400">
        {label}
      </div>
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

export default function OverviewTab() {
  const { overview, loading } = useOverview();
  const { changes, loading: recentLoading } = useChanges();
  const { prefs, update } = usePrefs();
  const [editing, setEditing] = useState(false);
  const recent = changes.slice(0, 5);

  const sections: Record<string, ReactNode> = {
    stats:
      loading || !overview ? (
        <SkeletonStats />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat value={overview.active} label="Watching" tone="teal" to="/tracking" />
          <Stat value={overview.changesToday} label="Changes today" to="/activity" />
          <Stat
            value={overview.errored}
            label="Errors"
            tone={overview.errored ? "coral" : "ink"}
            to="/tracking"
          />
          <Stat value={overview.projects} label="Projects" to="/tracking" />
        </div>
      ),
    kpis: <KpiStrip />,
    charts: <ChartsSection />,
    "activity-chart": overview ? <ActivityChart daily={overview.daily} /> : <SkeletonChart />,
    heatmap: <HeatmapCalendar />,
    digest: <DigestSettings />,
    recent: (
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm font-bold text-ink-900">Recent activity</h2>
          <Link to="/activity" className="font-mono text-[11px] text-ink-400 hover:text-ink-700">
            all →
          </Link>
        </div>
        {recentLoading ? (
          <SkeletonRows count={3} />
        ) : recent.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-surface px-6 py-14 text-center">
            <p className="text-sm font-medium text-ink-700">No activity yet</p>
            <p className="mt-1 text-sm text-ink-400">
              Track a sheet on{" "}
              <Link to="/sheets" className="font-medium text-teal-600 hover:underline">
                Sheets
              </Link>{" "}
              to start seeing changes.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {recent.map((c) => (
              <Link
                key={c.id}
                to={`/history/${c.sheetId}`}
                className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-card transition-colors hover:border-ink-300"
              >
                <PulseDot tone="alert" />
                <span className="flex-1 truncate font-display text-sm font-semibold text-ink-900">
                  {c.sheet.label}
                </span>
                <span className="hidden font-mono text-xs text-ink-500 sm:block">{c.summary}</span>
                <span className="font-mono text-[11px] text-ink-400">
                  {formatTimeAgo(c.createdAt, prefs.time)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    ),
  };

  const order = useMemo(() => {
    const known = prefs.dashboard.sectionOrder.filter((id) => id in sections);
    const missing = DASHBOARD_SECTIONS.map((s) => s.id).filter((id) => !known.includes(id));
    return [...known, ...missing];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.dashboard.sectionOrder]);

  const hidden = new Set(prefs.dashboard.hiddenSections);
  const titleOf = (id: string) => DASHBOARD_SECTIONS.find((s) => s.id === id)?.title ?? id;

  const move = (id: string, dir: -1 | 1) => {
    const idx = order.indexOf(id);
    const to = idx + dir;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    next.splice(idx, 1);
    next.splice(to, 0, id);
    update({ dashboard: { sectionOrder: next } });
  };

  const toggleHidden = (id: string) =>
    update({
      dashboard: {
        hiddenSections: hidden.has(id)
          ? prefs.dashboard.hiddenSections.filter((x) => x !== id)
          : [...prefs.dashboard.hiddenSections, id],
      },
    });

  return (
    <div className="animate-fade-up space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900">Overview</h1>
          <p className="mt-1 text-sm text-ink-500">
            {overview?.lastChangeAt
              ? `Last change ${formatTimeAgo(overview.lastChangeAt, prefs.time)}.`
              : "No changes recorded yet."}
          </p>
        </div>
        <button
          onClick={() => setEditing((e) => !e)}
          aria-pressed={editing}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-xs transition-all active:scale-[0.97] ${
            editing
              ? "border-teal/40 bg-teal-soft text-teal-600"
              : "border-line bg-surface text-ink-500 hover:border-teal/40 hover:text-teal-600"
          }`}
        >
          {editing ? <Check className="h-3.5 w-3.5" /> : <LayoutGrid className="h-3.5 w-3.5" />}
          {editing ? "Done" : "Edit layout"}
        </button>
      </div>

      {order.map((id) => {
        const node = sections[id];
        if (!node) return null;
        if (!editing && hidden.has(id)) return null;
        if (!editing) return <div key={id}>{node}</div>;
        return (
          <div
            key={id}
            className={`relative rounded-2xl border border-dashed p-3 transition-colors ${
              hidden.has(id) ? "border-line opacity-45" : "border-teal/40"
            }`}
          >
            <div className="mb-2 flex items-center gap-2">
              <GripVertical className="h-4 w-4 text-ink-300" />
              <span className="font-mono text-[11px] uppercase tracking-wider text-ink-500">
                {titleOf(id)}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <button
                  onClick={() => move(id, -1)}
                  aria-label={`Move ${titleOf(id)} up`}
                  className="rounded-md border border-line bg-surface px-2 py-1 font-mono text-[11px] text-ink-500 hover:text-ink-900"
                >
                  ↑
                </button>
                <button
                  onClick={() => move(id, 1)}
                  aria-label={`Move ${titleOf(id)} down`}
                  className="rounded-md border border-line bg-surface px-2 py-1 font-mono text-[11px] text-ink-500 hover:text-ink-900"
                >
                  ↓
                </button>
                <button
                  onClick={() => toggleHidden(id)}
                  aria-label={hidden.has(id) ? `Show ${titleOf(id)}` : `Hide ${titleOf(id)}`}
                  className="rounded-md border border-line bg-surface p-1.5 text-ink-500 hover:text-ink-900"
                >
                  {hidden.has(id) ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <div className="pointer-events-none">{node}</div>
          </div>
        );
      })}
    </div>
  );
}
