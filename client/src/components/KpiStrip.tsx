import { useCallback, useEffect, useState } from "react";
import { GalleryHorizontal, LayoutGrid, Pencil, X } from "lucide-react";
import { m } from "motion/react";
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
import { api } from "../lib/api";
import { KpiWidget, Sheet } from "../types";
import { useToast } from "./Toast";
import { usePrefs } from "../providers/PrefsProvider";
import ViewToggle from "./ViewToggle";
import { ModalShell } from "./Modal";
import Spinner from "./Spinner";
import NumberTicker from "./magic/NumberTicker";

function Sparkline({ series }: { series: (number | null)[] }) {
  const points = series.filter((v): v is number => v !== null);
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const W = 96;
  const H = 28;
  const step = W / (points.length - 1);
  const d = points
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(H - ((v - min) / span) * H).toFixed(1)}`)
    .join(" ");
  const up = points[points.length - 1] >= points[0];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible" aria-hidden>
      <path d={d} fill="none" strokeWidth="1.5" className={up ? "stroke-teal" : "stroke-coral"} />
    </svg>
  );
}

function parseValue(value: string | null): number | null {
  if (value === null || value === "") return null;
  const n = Number(value.replace(/[^0-9eE.+-]/g, ""));
  return Number.isNaN(n) ? null : n;
}

function formatNumber(n: number, format: string): string {
  switch (format) {
    case "currency":
      return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
    case "percent":
      return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
    default:
      return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
}

function KpiValue({ value, format }: { value: string | null; format: string }) {
  const n = parseValue(value);
  if (n === null) {
    return <>{value === null || value === "" ? "—" : value}</>;
  }
  return <NumberTicker value={n} format={(v) => formatNumber(v, format)} />;
}

// Drag-sortable KPI card. dnd-kit owns the transform while dragging; the
// hover lift comes from Motion when idle.
function KpiCard({
  widget: w,
  onRemove,
  onEdit,
}: {
  widget: KpiWidget;
  onRemove: () => void;
  onEdit: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: w.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "z-10 opacity-80" : ""}
      {...attributes}
      {...listeners}
    >
      <m.div
        whileHover={isDragging ? undefined : { y: -2 }}
        className="group cursor-grab rounded-2xl border border-line bg-surface px-5 py-4 shadow-card transition-colors hover:border-ink-300 active:cursor-grabbing"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-mono text-[11px] uppercase tracking-wider text-ink-400">
              {w.label}
            </div>
            <div className="mt-1 font-display text-2xl font-bold tracking-tight text-ink-900">
              <KpiValue value={w.value ?? null} format={w.format} />
            </div>
            {w.delta24h !== null && w.delta24h !== undefined && w.delta24h !== 0 && (
              <div
                className={`mt-0.5 font-mono text-[11px] font-semibold ${
                  w.delta24h > 0 ? "text-teal-600" : "text-coral-600"
                }`}
              >
                {w.delta24h > 0 ? "▲" : "▼"}{" "}
                {Math.abs(w.delta24h).toLocaleString(undefined, { maximumFractionDigits: 2 })} · 24h
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label={`Edit ${w.label}`}
                className="rounded p-0.5 text-ink-300 transition-colors hover:text-teal-600"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label={`Unpin ${w.label}`}
                className="rounded p-0.5 text-ink-300 transition-colors hover:text-coral-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {w.series && <Sparkline series={w.series} />}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2 truncate font-mono text-[10px] text-ink-300">
          <span className="truncate">
            {w.sheetLabel} · {w.cell}
          </span>
          {(w.alertAbove ?? null) !== null && (
            <span className="shrink-0 rounded bg-teal-soft px-1 text-teal-600">&gt; {w.alertAbove}</span>
          )}
          {(w.alertBelow ?? null) !== null && (
            <span className="shrink-0 rounded bg-coral-soft px-1 text-coral-600">&lt; {w.alertBelow}</span>
          )}
        </div>
      </m.div>
    </div>
  );
}

// Pinned KPI cells across watched sheets, with 24h delta and sparkline.
export default function KpiStrip() {
  const toast = useToast();
  const { prefs, update } = usePrefs();
  const [widgets, setWidgets] = useState<KpiWidget[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<KpiWidget | null>(null);

  const refetch = useCallback(() => {
    api
      .get<KpiWidget[]>("/api/kpis")
      .then(setWidgets)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    refetch();
    const interval = setInterval(refetch, 60_000);
    return () => clearInterval(interval);
  }, [refetch]);

  const remove = async (w: KpiWidget) => {
    try {
      await api.delete(`/api/kpis/${w.id}`);
      refetch();
      toast.success(`Unpinned “${w.label}”`);
    } catch {
      toast.error("Couldn’t remove widget");
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
    api.post("/api/kpis/reorder", { ids: next.map((w) => w.id) }).catch(() => {
      toast.error("Couldn’t save the new order");
      refetch();
    });
  };

  if (!loaded) return null;

  const view = prefs.views.kpis;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-bold text-ink-900">KPIs</h2>
        <div className="flex items-center gap-2">
          {widgets.length > 0 && (
            <ViewToggle
              value={view}
              onChange={(v) => update({ views: { kpis: v } })}
              options={[
                { value: "cards", icon: LayoutGrid, label: "Cards" },
                { value: "strip", icon: GalleryHorizontal, label: "Strip" },
              ]}
            />
          )}
          <button
            onClick={() => setAdding(true)}
            className="rounded-md bg-teal-soft px-2 py-0.5 font-mono text-[11px] font-semibold text-teal-600 transition-colors hover:bg-teal hover:text-primary-foreground"
          >
            + pin a cell
          </button>
        </div>
      </div>

      {widgets.length === 0 ? (
        <p className="font-mono text-xs text-ink-300">
          pin a cell — revenue total, ticket count, % done — and watch it live here
        </p>
      ) : view === "strip" ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {widgets.map((w) => (
            <div
              key={w.id}
              className="flex shrink-0 flex-col gap-0.5 rounded-xl border border-line bg-surface px-3.5 py-2.5 shadow-card"
            >
              <span className="truncate font-mono text-[10px] uppercase tracking-wider text-ink-400">
                {w.label}
              </span>
              <span className="font-display text-lg font-bold tracking-tight text-ink-900">
                <KpiValue value={w.value ?? null} format={w.format} />
              </span>
              {w.delta24h !== null && w.delta24h !== undefined && w.delta24h !== 0 && (
                <span
                  className={`font-mono text-[10px] font-semibold ${
                    w.delta24h > 0 ? "text-teal-600" : "text-coral-600"
                  }`}
                >
                  {w.delta24h > 0 ? "▲" : "▼"}{" "}
                  {Math.abs(w.delta24h).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {widgets.map((w) => (
                <KpiCard
                  key={w.id}
                  widget={w}
                  onRemove={() => remove(w)}
                  onEdit={() => setEditing(w)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {adding && <AddKpiModal onClose={() => setAdding(false)} onAdded={refetch} />}
      {editing && (
        <EditKpiModal widget={editing} onClose={() => setEditing(null)} onSaved={refetch} />
      )}
    </section>
  );
}

// Label / format / threshold-alert editing for a pinned cell.
function EditKpiModal({
  widget,
  onClose,
  onSaved,
}: {
  widget: KpiWidget;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [label, setLabel] = useState(widget.label);
  const [format, setFormat] = useState(widget.format);
  const [above, setAbove] = useState(widget.alertAbove?.toString() ?? "");
  const [below, setBelow] = useState(widget.alertBelow?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const parse = (s: string) => (s.trim() === "" ? null : Number(s));
    const alertAbove = parse(above);
    const alertBelow = parse(below);
    if ((alertAbove !== null && Number.isNaN(alertAbove)) || (alertBelow !== null && Number.isNaN(alertBelow))) {
      setError("Thresholds must be numbers.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/api/kpis/${widget.id}`, {
        label: label.trim() || widget.label,
        format,
        alertAbove,
        alertBelow,
      });
      onSaved();
      onClose();
      toast.success("KPI updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save.");
      setSaving(false);
    }
  };

  const field =
    "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-hidden transition-shadow focus:border-teal focus:ring-4 focus:ring-teal/10";

  return (
    <ModalShell onClose={onClose} label={`Edit ${widget.label}`}>
      <div className="border-b border-line px-5 py-4">
        <h2 className="font-display text-lg font-bold text-ink-900">Edit KPI</h2>
        <p className="mt-0.5 font-mono text-[11px] text-ink-400">
          {widget.sheetLabel} · {widget.cell}
        </p>
      </div>
      <div className="space-y-3 px-5 py-4">
        <div>
          <label className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-ink-400">
            Label
          </label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} className={field} />
        </div>
        <div>
          <label className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-ink-400">
            Format
          </label>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as KpiWidget["format"])}
            className={field}
          >
            <option value="number">Number</option>
            <option value="currency">Currency</option>
            <option value="percent">Percent</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-ink-400">
            Threshold alerts
          </label>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-ink-400">above</span>
            <input
              value={above}
              onChange={(e) => setAbove(e.target.value)}
              placeholder="—"
              inputMode="decimal"
              className={field}
            />
            <span className="font-mono text-xs text-ink-400">below</span>
            <input
              value={below}
              onChange={(e) => setBelow(e.target.value)}
              placeholder="—"
              inputMode="decimal"
              className={field}
            />
          </div>
          <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-ink-400">
            notifies once when the value crosses a bound — clear a box to disable
          </p>
        </div>
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
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-teal px-4 py-2 text-sm font-semibold text-primary-foreground shadow-xs transition-all hover:bg-teal-600 active:scale-[0.97] disabled:opacity-50"
        >
          {saving && <Spinner />}
          Save
        </button>
      </div>
    </ModalShell>
  );
}

function AddKpiModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const toast = useToast();
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetId, setSheetId] = useState("");
  const [cell, setCell] = useState("");
  const [label, setLabel] = useState("");
  const [format, setFormat] = useState("number");
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
    if (!sheetId || !/^[A-Za-z]{1,3}\d+$/.test(cell.trim())) {
      setError("Pick a sheet and enter a cell like B4.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post("/api/kpis", {
        sheetId,
        cell: cell.trim().toUpperCase(),
        label: label.trim() || undefined,
        format,
      });
      onAdded();
      onClose();
      toast.success("KPI pinned");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t pin the cell.");
      setSaving(false);
    }
  };

  const field =
    "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-hidden transition-shadow focus:border-teal focus:ring-4 focus:ring-teal/10";

  return (
    <ModalShell onClose={onClose} label="Pin a KPI cell">
      <div className="border-b border-line px-5 py-4">
        <h2 className="font-display text-lg font-bold text-ink-900">Pin a KPI cell</h2>
      </div>
      <div className="space-y-4 px-5 py-5">
        <div>
          <label className="text-xs font-semibold text-ink-500">Sheet</label>
          <select value={sheetId} onChange={(e) => setSheetId(e.target.value)} className={`mt-1.5 ${field}`}>
            {sheets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-ink-500">Cell</label>
            <input
              value={cell}
              onChange={(e) => setCell(e.target.value)}
              placeholder="B4"
              className={`mt-1.5 ${field} font-mono uppercase`}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-500">Format</label>
            <select value={format} onChange={(e) => setFormat(e.target.value)} className={`mt-1.5 ${field}`}>
              <option value="number">Number</option>
              <option value="currency">Currency</option>
              <option value="percent">Percent</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-ink-500">Label (optional)</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Monthly revenue"
            className={`mt-1.5 ${field}`}
          />
        </div>
        {error && <p className="text-xs text-coral-600">{error}</p>}
      </div>
      <div className="flex items-center gap-2 border-t border-line px-5 py-4">
        <button
          onClick={add}
          disabled={saving}
          className="rounded-lg bg-teal px-4 py-2 text-sm font-semibold text-primary-foreground shadow-xs transition-all hover:bg-teal-600 active:scale-[0.97] disabled:opacity-50"
        >
          {saving ? "Pinning…" : "Pin KPI"}
        </button>
        <button
          onClick={onClose}
          className="rounded-lg px-4 py-2 text-sm font-medium text-ink-500 transition-colors hover:bg-paper"
        >
          Cancel
        </button>
      </div>
    </ModalShell>
  );
}
