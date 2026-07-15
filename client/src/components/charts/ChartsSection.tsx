import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
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
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "@/lib/api";
import { Sheet } from "@/types";
import { useToast } from "@/components/Toast";
import { ModalShell } from "@/components/Modal";
import Spinner from "@/components/Spinner";
import { SkeletonChart } from "@/components/Skeleton";
import type { ChartWidgetData } from "./ChartCard";

// Recharts stays out of the entry bundle; the card lazy-loads with the section.
const ChartCard = lazy(() => import("./ChartCard"));

// One draggable chart card. The grip is the only handle so the chart stays
// interactive and the remove button keeps working.
function SortableChart({
  widget: w,
  onRemove,
}: {
  widget: ChartWidgetData;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: w.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group rounded-2xl border border-line bg-surface px-5 py-4 shadow-card transition-colors hover:border-ink-300 ${
        isDragging ? "z-10 opacity-80" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <button
            aria-label={`Drag ${w.label}`}
            className="mt-0.5 cursor-grab text-ink-300 opacity-0 transition-opacity hover:text-ink-500 active:cursor-grabbing group-hover:opacity-100"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <div className="min-w-0">
            <div className="truncate font-mono text-[11px] uppercase tracking-wider text-ink-400">
              {w.label}
            </div>
            <div className="truncate font-mono text-[10px] text-ink-300">
              {w.sheetLabel} · {w.range} · {w.type}
            </div>
          </div>
        </div>
        <button
          onClick={onRemove}
          aria-label={`Remove ${w.label}`}
          className="rounded p-0.5 text-ink-300 opacity-0 transition-opacity hover:text-coral-600 group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-3">
        <Suspense fallback={<SkeletonChart />}>
          <ChartCard widget={w} />
        </Suspense>
      </div>
    </div>
  );
}

// User-defined charts rendered from live sheet ranges.
export default function ChartsSection() {
  const toast = useToast();
  const [widgets, setWidgets] = useState<ChartWidgetData[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);

  const refetch = useCallback(() => {
    api
      .get<ChartWidgetData[]>("/api/charts")
      .then(setWidgets)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    refetch();
    const interval = setInterval(refetch, 60_000);
    return () => clearInterval(interval);
  }, [refetch]);

  const remove = async (w: ChartWidgetData) => {
    try {
      await api.delete(`/api/charts/${w.id}`);
      refetch();
      toast.success(`Removed “${w.label}”`);
    } catch {
      toast.error("Couldn’t remove chart");
    }
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = widgets.findIndex((w) => w.id === active.id);
    const to = widgets.findIndex((w) => w.id === over.id);
    const next = arrayMove(widgets, from, to);
    setWidgets(next);
    api.post("/api/charts/reorder", { ids: next.map((w) => w.id) }).catch(() => {
      toast.error("Couldn’t save the new order");
      refetch();
    });
  };

  if (!loaded) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-bold text-ink-900">Charts</h2>
        <button
          onClick={() => setAdding(true)}
          className="rounded-md bg-teal-soft px-2 py-0.5 font-mono text-[11px] font-semibold text-teal-600 transition-colors hover:bg-teal hover:text-primary-foreground"
        >
          + chart from a range
        </button>
      </div>

      {widgets.length === 0 ? (
        <p className="font-mono text-xs text-ink-300">
          turn any sheet range into a live line, bar, area or donut chart
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {widgets.map((w) => (
                <SortableChart key={w.id} widget={w} onRemove={() => remove(w)} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {adding && <AddChartModal onClose={() => setAdding(false)} onAdded={refetch} />}
    </section>
  );
}

const TYPES = [
  { value: "line", label: "Line" },
  { value: "bar", label: "Bar" },
  { value: "area", label: "Area" },
  { value: "donut", label: "Donut" },
] as const;

function AddChartModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const toast = useToast();
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetId, setSheetId] = useState("");
  const [label, setLabel] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]["value"]>("line");
  const [range, setRange] = useState("");
  const [xColumn, setXColumn] = useState("");
  const [dataColumns, setDataColumns] = useState("");
  const [headerRow, setHeaderRow] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Sheet[]>("/api/sheets")
      .then((list) => {
        setSheets(list);
        if (list.length > 0) setSheetId(list[0].id);
      })
      .catch(() => {});
  }, []);

  const add = async () => {
    if (!sheetId || !/^[A-Za-z]{1,3}\d+:[A-Za-z]{1,3}\d+$/.test(range.trim())) {
      setError("Pick a sheet and enter a range like A1:C30.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post("/api/charts", {
        sheetId,
        label: label.trim() || `${range.trim().toUpperCase()} ${type}`,
        type,
        range: range.trim().toUpperCase(),
        xColumn: xColumn.trim() ? xColumn.trim().toUpperCase() : null,
        dataColumns: dataColumns
          .split(",")
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean),
        headerRow,
      });
      onAdded();
      onClose();
      toast.success("Chart added");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t add the chart.");
      setSaving(false);
    }
  };

  const field =
    "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-hidden transition-shadow focus:border-teal focus:ring-4 focus:ring-teal/10";

  return (
    <ModalShell onClose={onClose} label="Add a chart" maxWidth="max-w-lg">
      <div className="border-b border-line px-5 py-4">
        <h2 className="font-display text-lg font-bold text-ink-900">Chart from a range</h2>
        <p className="mt-0.5 text-xs text-ink-400">
          Rendered from the sheet’s latest data, refreshed every poll.
        </p>
      </div>
      <div className="space-y-3 px-5 py-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-ink-400">
              Sheet
            </label>
            <select value={sheetId} onChange={(e) => setSheetId(e.target.value)} className={field}>
              {sheets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-ink-400">
              Type
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
              className={field}
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-ink-400">
            Label
          </label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} className={field} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-ink-400">
              Range
            </label>
            <input
              value={range}
              onChange={(e) => setRange(e.target.value)}
              placeholder="A1:C30"
              className={`${field} font-mono`}
            />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-ink-400">
              X column
            </label>
            <input
              value={xColumn}
              onChange={(e) => setXColumn(e.target.value)}
              placeholder="A"
              className={`${field} font-mono`}
            />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-ink-400">
              Data columns
            </label>
            <input
              value={dataColumns}
              onChange={(e) => setDataColumns(e.target.value)}
              placeholder="B,C"
              className={`${field} font-mono`}
            />
          </div>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={headerRow}
            onChange={(e) => setHeaderRow(e.target.checked)}
            className="h-4 w-4 accent-[var(--primary)]"
          />
          <span className="text-sm text-ink-700">First row is headers (series names)</span>
        </label>
        {error && <p className="font-mono text-xs text-coral-600">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
        <button
          onClick={onClose}
          className="rounded-lg px-4 py-2 text-sm font-medium text-ink-500 hover:bg-paper"
        >
          Cancel
        </button>
        <button
          onClick={add}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-teal px-4 py-2 text-sm font-semibold text-primary-foreground shadow-xs transition-all hover:bg-teal-600 active:scale-[0.97] disabled:opacity-50"
        >
          {saving ? <Spinner /> : <Plus className="h-4 w-4" />}
          Add chart
        </button>
      </div>
    </ModalShell>
  );
}
