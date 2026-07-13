import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../lib/api";
import { ChangeLog } from "../types";
import { SkeletonRows } from "../components/Skeleton";
import ChangeContext from "../components/ChangeContext";
import TimeTravel from "../components/TimeTravel";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export default function SheetDetail() {
  const { id } = useParams<{ id: string }>();
  const [changes, setChanges] = useState<ChangeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [gridOpen, setGridOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!id) return;
    api
      .get<ChangeLog[]>(`/api/sheets/${id}/changes`)
      .then(setChanges)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div className="animate-fade-up space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            to="/tracking"
            className="font-mono text-xs text-ink-400 transition-colors hover:text-ink-700"
          >
            ← tracking
          </Link>
          <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-ink-900">
            Change history
          </h1>
        </div>
        {changes.length > 0 && (
          <a
            href={`${API_BASE}/api/sheets/${id}/changes.csv`}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 font-mono text-[11px] font-medium text-ink-700 shadow-xs transition-all hover:border-teal/40 hover:text-teal-600 active:scale-[0.97]"
          >
            ↓ Export CSV
          </a>
        )}
      </div>

      {id && <TimeTravel sheetId={id} />}

      {loading ? (
        <SkeletonRows count={3} />
      ) : changes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface px-6 py-14 text-center">
          <p className="text-sm font-medium text-ink-700">No changes recorded</p>
          <p className="mt-1 text-sm text-ink-400">
            This sheet hasn’t changed since you started watching it.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {changes.map((c) => (
            <div
              key={c.id}
              className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card"
            >
              <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                <span className="font-mono text-xs font-medium text-ink-700">
                  {c.summary}
                </span>
                <span className="flex items-center gap-2">
                  <button
                    onClick={() => setGridOpen((o) => ({ ...o, [c.id]: !o[c.id] }))}
                    className="rounded-md px-2 py-0.5 font-mono text-[11px] text-ink-400 transition-colors hover:bg-paper hover:text-teal-600"
                  >
                    {gridOpen[c.id] ? "▦ hide grid" : "▦ view in grid"}
                  </button>
                  <span className="font-mono text-[11px] text-ink-400">
                    {new Date(c.createdAt).toLocaleString()}
                  </span>
                </span>
              </div>
              {gridOpen[c.id] && id && (
                <div className="border-b border-line">
                  <ChangeContext sheetId={id} changeId={c.id} />
                </div>
              )}
              <div className="divide-y divide-line">
                {c.details.slice(0, 12).map((d, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-4 py-2 font-mono text-xs"
                  >
                    <span className="shrink-0 rounded bg-paper px-1.5 py-0.5 text-[10px] text-ink-400">
                      {d.cell}
                    </span>
                    <span className="truncate text-coral-600 line-through">
                      {d.before || "∅"}
                    </span>
                    <span className="text-ink-300">→</span>
                    <span className="truncate text-teal-600">{d.after || "∅"}</span>
                  </div>
                ))}
                {c.details.length > 12 && (
                  <p className="px-4 py-2 font-mono text-[11px] text-ink-400">
                    +{c.details.length - 12} more cells
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
