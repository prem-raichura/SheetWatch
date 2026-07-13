import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { CellChange, SnapshotMeta } from "../types";
import DiffGrid from "./DiffGrid";

interface SnapshotDetail {
  id: string;
  createdAt: string;
  rows: string[][];
  diffToCurrent: CellChange[];
}

interface CompareResult {
  a: { id: string; createdAt: string };
  b: { id: string; createdAt: string };
  rows: string[][];
  diff: CellChange[];
}

interface Props {
  sheetId: string;
}

type Mode = "current" | "pair";

function csvEscape(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// Collapsible snapshot timeline: pick a point in time, see the sheet as it
// was, with differences vs the current snapshot highlighted.
export default function TimeTravel({ sheetId }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("current");
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<SnapshotDetail | null>(null);
  const [pairA, setPairA] = useState<string | null>(null);
  const [pairB, setPairB] = useState<string | null>(null);
  const [pair, setPair] = useState<CompareResult | null>(null);
  const [compare, setCompare] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    api
      .get<SnapshotMeta[]>(`/api/sheets/${sheetId}/snapshots`)
      .then((list) => {
        setSnapshots(list);
        if (list.length > 0 && !selected) setSelected(list[0].id);
        if (list.length > 1) {
          setPairB((b) => b ?? list[0].id);
          setPairA((a) => a ?? list[1].id);
        }
      })
      .catch(() => setSnapshots([]));
  }, [open, sheetId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pair mode: diff two arbitrary snapshots (a → b).
  useEffect(() => {
    if (mode !== "pair" || !pairA || !pairB) return;
    setLoading(true);
    api
      .get<CompareResult>(`/api/sheets/${sheetId}/snapshots/compare?a=${pairA}&b=${pairB}`)
      .then(setPair)
      .catch(() => setPair(null))
      .finally(() => setLoading(false));
  }, [mode, pairA, pairB, sheetId]);

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    api
      .get<SnapshotDetail>(`/api/sheets/${sheetId}/snapshots/${selected}`)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [selected, sheetId]);

  const downloadCsv = () => {
    if (!detail) return;
    const csv = detail.rows.map((r) => r.map((c) => csvEscape(c ?? "")).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sheetwatch-snapshot-${detail.createdAt.slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-paper/60"
      >
        <span className="font-display text-sm font-bold text-ink-900">🕰 Time travel</span>
        <span className={`text-ink-300 transition-transform ${open ? "rotate-90" : ""}`}>›</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-line px-4 py-4">
          {snapshots.length === 0 ? (
            <p className="font-mono text-xs text-ink-300">
              no snapshots yet — one is saved each time a change is detected
            </p>
          ) : (
            <>
              <div className="inline-flex rounded-lg border border-line bg-paper p-0.5" role="group">
                {(["current", "pair"] as Mode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    aria-pressed={mode === m}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                      mode === m ? "bg-card text-ink-900 shadow-xs" : "text-ink-500 hover:text-ink-900"
                    }`}
                  >
                    {m === "current" ? "vs current" : "pick two"}
                  </button>
                ))}
              </div>

              {mode === "current" ? (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <select
                      value={selected ?? ""}
                      onChange={(e) => setSelected(e.target.value)}
                      aria-label="Snapshot"
                      className="rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-hidden focus:border-teal"
                    >
                      {snapshots.map((s) => (
                        <option key={s.id} value={s.id}>
                          {new Date(s.createdAt).toLocaleString()}
                        </option>
                      ))}
                    </select>
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-500">
                      <input
                        type="checkbox"
                        checked={compare}
                        onChange={(e) => setCompare(e.target.checked)}
                        className="accent-teal"
                      />
                      highlight differences vs current
                    </label>
                    <button
                      onClick={downloadCsv}
                      disabled={!detail}
                      className="ml-auto rounded-lg border border-line bg-surface px-3 py-1.5 font-mono text-[11px] font-medium text-ink-700 shadow-xs transition-all hover:border-teal/40 hover:text-teal-600 disabled:opacity-40"
                    >
                      ↓ Download CSV
                    </button>
                  </div>

                  {loading ? (
                    <p className="font-mono text-xs text-ink-300">loading snapshot…</p>
                  ) : detail ? (
                    <div className="max-h-96 overflow-y-auto rounded-lg border border-line">
                      <DiffGrid
                        rows={detail.rows.slice(0, 100)}
                        changes={compare ? detail.diffToCurrent : []}
                        range="A1"
                      />
                    </div>
                  ) : (
                    <p className="font-mono text-xs text-coral-600">couldn’t load this snapshot</p>
                  )}
                  {detail && detail.rows.length > 100 && (
                    <p className="font-mono text-[10px] text-ink-300">
                      showing first 100 rows — download the CSV for everything
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={pairA ?? ""}
                      onChange={(e) => setPairA(e.target.value)}
                      aria-label="Older snapshot"
                      className="rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-hidden focus:border-teal"
                    >
                      {snapshots.map((s) => (
                        <option key={s.id} value={s.id}>
                          {new Date(s.createdAt).toLocaleString()}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        setPairA(pairB);
                        setPairB(pairA);
                      }}
                      aria-label="Swap snapshots"
                      title="Swap"
                      className="rounded-lg border border-line bg-surface px-2 py-2 font-mono text-xs text-ink-500 shadow-xs transition-all hover:border-teal/40 hover:text-teal-600"
                    >
                      ⇄
                    </button>
                    <select
                      value={pairB ?? ""}
                      onChange={(e) => setPairB(e.target.value)}
                      aria-label="Newer snapshot"
                      className="rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-hidden focus:border-teal"
                    >
                      {snapshots.map((s) => (
                        <option key={s.id} value={s.id}>
                          {new Date(s.createdAt).toLocaleString()}
                        </option>
                      ))}
                    </select>
                    <span className="font-mono text-[11px] text-ink-400">
                      {pair ? `${pair.diff.length} difference${pair.diff.length !== 1 ? "s" : ""}` : ""}
                    </span>
                  </div>

                  {loading ? (
                    <p className="font-mono text-xs text-ink-300">comparing…</p>
                  ) : pair ? (
                    <div className="max-h-96 overflow-y-auto rounded-lg border border-line">
                      <DiffGrid rows={pair.rows.slice(0, 100)} changes={pair.diff} range="A1" />
                    </div>
                  ) : (
                    <p className="font-mono text-xs text-coral-600">couldn’t compare these snapshots</p>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
