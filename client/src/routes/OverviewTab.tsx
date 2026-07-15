import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Check, Eye, EyeOff, GripVertical, LayoutGrid } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = order.indexOf(active.id as string);
    const to = order.indexOf(over.id as string);
    update({ dashboard: { sectionOrder: arrayMove(order, from, to) } });
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

      {!editing
        ? order.map((id) => {
            const node = sections[id];
            if (!node || hidden.has(id)) return null;
            return <div key={id}>{node}</div>;
          })
        : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              {order.map((id) =>
                sections[id] ? (
                  <SortableSection
                    key={id}
                    id={id}
                    title={titleOf(id)}
                    hidden={hidden.has(id)}
                    onToggleHidden={() => toggleHidden(id)}
                  >
                    {sections[id]}
                  </SortableSection>
                ) : null
              )}
            </SortableContext>
          </DndContext>
        )}
    </div>
  );
}

// Draggable wrapper shown in Overview's edit-layout mode. The grip is the only
// drag handle so the eye-toggle button stays clickable.
function SortableSection({
  id,
  title,
  hidden,
  onToggleHidden,
  children,
}: {
  id: string;
  title: string;
  hidden: boolean;
  onToggleHidden: () => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative rounded-2xl border border-dashed p-3 transition-colors ${
        isDragging ? "z-10 opacity-80" : ""
      } ${hidden ? "border-line opacity-45" : "border-teal/40"}`}
    >
      <div className="mb-2 flex items-center gap-2">
        <button
          aria-label={`Drag ${title}`}
          className="cursor-grab text-ink-300 hover:text-ink-500 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="font-mono text-[11px] uppercase tracking-wider text-ink-500">{title}</span>
        <button
          onClick={onToggleHidden}
          aria-label={hidden ? `Show ${title}` : `Hide ${title}`}
          className="ml-auto rounded-md border border-line bg-surface p-1.5 text-ink-500 hover:text-ink-900"
        >
          {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>
      <div className="pointer-events-none">{children}</div>
    </div>
  );
}
