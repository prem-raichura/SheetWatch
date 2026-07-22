import { useEffect, useMemo, useState } from "react";
import { KeyRound } from "lucide-react";
import { api } from "../../lib/api";
import { indexToColumn as colLetter } from "../../lib/grid";
import { ModalShell } from "../Modal";
import { SkeletonRows } from "../Skeleton";

interface Props {
  sheetId: string;
  tab: string | null;
  initialKey: string | null;
  initialColumns: string[];
  onPick: (sel: { keyColumn: string | null; compareColumns: string[] }) => void;
  onClose: () => void;
}

const SAMPLE_ROWS = 6;

// Pick the key column and the columns to compare by clicking a live preview of
// the master sheet — mirrors RangePickerModal's grid. A column's identifier is
// its header text when present, else the column letter, matching how the server
// resolves either form.
export default function ColumnPickerModal({
  sheetId,
  tab,
  initialKey,
  initialColumns,
  onPick,
  onClose,
}: Props) {
  const [rows, setRows] = useState<string[][]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyCol, setKeyCol] = useState<string | null>(initialKey);
  const [compare, setCompare] = useState<Set<string>>(new Set(initialColumns));

  useEffect(() => {
    setLoading(true);
    api
      .get<{ rows: string[][] }>(
        `/api/sheets/${sheetId}/preview?rows=${SAMPLE_ROWS}${tab ? `&tab=${encodeURIComponent(tab)}` : ""}`
      )
      .then((d) => setRows(d.rows ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load sheet"))
      .finally(() => setLoading(false));
  }, [sheetId, tab]);

  const colCount = useMemo(
    () => Math.min(Math.max(1, ...rows.map((r) => r.length)), 40),
    [rows]
  );
  // Columns are identified by their spreadsheet letter — row 0 is treated as
  // data, not a header.
  const idOf = (c: number) => colLetter(c);

  const toggleCompare = (c: number) => {
    const id = idOf(c);
    setCompare((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const setKey = (c: number) => {
    const id = idOf(c);
    setKeyCol((prev) => (prev === id ? null : id));
  };

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-4xl" label="Pick columns">
      <div className="flex max-h-[85vh] flex-col">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-display text-lg font-bold text-ink-900">Pick columns</h2>
          <p className="mt-0.5 text-xs text-ink-400">
            Columns are the sheet’s own letters (A, B, C…). Click a column to compare it; click the{" "}
            <KeyRound className="inline h-3 w-3" /> to set the key that matches rows across sheets.
          </p>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <SkeletonRows count={5} />
          ) : error ? (
            <p className="text-sm text-coral-600">{error}</p>
          ) : (
            <table className="border-separate border-spacing-0 select-none font-mono text-[11px]">
              <thead>
                <tr>
                  {Array.from({ length: colCount }).map((_, c) => {
                    const id = idOf(c);
                    const isKey = keyCol === id;
                    const on = compare.has(id);
                    return (
                      <th
                        key={c}
                        onClick={() => toggleCompare(c)}
                        title={`Compare "${id}"`}
                        className={`sticky top-0 h-8 min-w-[72px] cursor-pointer border-b border-line px-2 font-semibold ${
                          on ? "bg-teal text-primary-foreground" : "bg-paper text-ink-500 hover:bg-teal-soft"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-1">
                          <span className="truncate">{id}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setKey(c);
                            }}
                            title="Set as key column"
                            className={`rounded p-0.5 ${
                              isKey ? "text-amber-300" : on ? "text-primary-foreground/70 hover:text-white" : "text-ink-300 hover:text-amber-500"
                            }`}
                          >
                            <KeyRound className="h-3 w-3" />
                          </button>
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: Math.max(rows.length, 1) }).map((_, r) => {
                  return (
                    <tr key={r}>
                      {Array.from({ length: colCount }).map((_, c) => {
                        const id = idOf(c);
                        const on = compare.has(id);
                        const isKey = keyCol === id;
                        const val = rows[r]?.[c] ?? "";
                        return (
                          <td
                            key={c}
                            title={val}
                            className={`h-7 max-w-[140px] truncate border-b border-r border-line px-2 ${
                              isKey ? "bg-amber-50 text-ink-900" : on ? "bg-teal/10 text-ink-900" : "bg-card text-ink-700"
                            }`}
                            style={{ maxWidth: 140 }}
                          >
                            {val}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-4">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
            {keyCol && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">
                <KeyRound className="h-3 w-3" /> {keyCol}
              </span>
            )}
            {[...compare].map((c) => (
              <span key={c} className="rounded-full bg-teal-soft px-2 py-0.5 font-mono font-semibold text-teal-600">
                {c}
              </span>
            ))}
            {compare.size === 0 && !keyCol && <span className="text-ink-400">nothing selected yet</span>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-ink-500 hover:bg-paper">
              Cancel
            </button>
            <button
              onClick={() => onPick({ keyColumn: keyCol, compareColumns: [...compare] })}
              disabled={compare.size === 0}
              className="rounded-lg bg-teal px-4 py-2 text-sm font-semibold text-primary-foreground shadow-xs transition-all hover:bg-teal-600 active:scale-[0.97] disabled:opacity-50"
            >
              Use selection
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
