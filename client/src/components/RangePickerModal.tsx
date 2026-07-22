import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import { indexToColumn as colLetter } from "../lib/grid";
import { ModalShell } from "./Modal";
import { SkeletonRows } from "./Skeleton";

interface Props {
  sheetId: string;
  tab: string | null;
  onPick: (range: string) => void;
  onClose: () => void;
}

type Sel = { r: number; c: number };
type Mode = "cell" | "col" | "row";

const COLS = 26;

export default function RangePickerModal({ sheetId, tab, onPick, onClose }: Props) {
  const [rows, setRows] = useState<string[][]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [anchor, setAnchor] = useState<Sel | null>(null);
  const [focus, setFocus] = useState<Sel | null>(null);
  const [mode, setMode] = useState<Mode>("cell");
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    setLoading(true);
    api
      .get<{ rows: string[][] }>(
        `/api/sheets/${sheetId}/preview${tab ? `?tab=${encodeURIComponent(tab)}` : ""}`
      )
      .then((d) => setRows(d.rows ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load sheet"))
      .finally(() => setLoading(false));
  }, [sheetId, tab]);

  useEffect(() => {
    const up = () => setDragging(false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  const rowCount = Math.max(rows.length, 20);

  const startCell = (r: number, c: number) => {
    setMode("cell");
    setAnchor({ r, c });
    setFocus({ r, c });
    setDragging(true);
  };
  const extend = (r: number, c: number) => {
    if (dragging && mode === "cell") setFocus({ r, c });
  };
  const pickColumn = (c: number) => {
    setMode("col");
    setAnchor({ r: 0, c });
    setFocus({ r: rowCount - 1, c });
    setDragging(false);
  };
  const pickRow = (r: number) => {
    setMode("row");
    setAnchor({ r, c: 0 });
    setFocus({ r, c: COLS - 1 });
    setDragging(false);
  };

  const rect =
    anchor && focus
      ? {
          minR: Math.min(anchor.r, focus.r),
          maxR: Math.max(anchor.r, focus.r),
          minC: Math.min(anchor.c, focus.c),
          maxC: Math.max(anchor.c, focus.c),
        }
      : null;

  const inRect = useCallback(
    (r: number, c: number) =>
      rect && r >= rect.minR && r <= rect.maxR && c >= rect.minC && c <= rect.maxC,
    [rect]
  );

  const rangeStr = (() => {
    if (!rect) return "";
    if (mode === "col") {
      return rect.minC === rect.maxC
        ? `${colLetter(rect.minC)}:${colLetter(rect.maxC)}`
        : `${colLetter(rect.minC)}:${colLetter(rect.maxC)}`;
    }
    if (mode === "row") {
      return `${rect.minR + 1}:${rect.maxR + 1}`;
    }
    const a = `${colLetter(rect.minC)}${rect.minR + 1}`;
    const b = `${colLetter(rect.maxC)}${rect.maxR + 1}`;
    return a === b ? a : `${a}:${b}`;
  })();

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-4xl">
      <div className="flex max-h-[85vh] flex-col">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-bold text-ink-900">Select what to watch</h2>
            <p className="mt-0.5 text-xs text-ink-400">
              Drag across cells, or click a column letter / row number.
            </p>
          </div>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-ink-400 hover:bg-paper hover:text-ink-900">
            ✕
          </button>
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
                  <th className="sticky left-0 top-0 z-10 h-7 w-10 bg-paper" />
                  {Array.from({ length: COLS }).map((_, c) => (
                    <th
                      key={c}
                      onClick={() => pickColumn(c)}
                      className={`sticky top-0 h-7 min-w-[64px] cursor-pointer border-b border-line px-2 font-semibold ${
                        rect && mode !== "row" && c >= rect.minC && c <= rect.maxC
                          ? "bg-teal text-primary-foreground"
                          : "bg-paper text-ink-500 hover:bg-teal-soft"
                      }`}
                    >
                      {colLetter(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: rowCount }).map((_, r) => (
                  <tr key={r}>
                    <td
                      onClick={() => pickRow(r)}
                      className={`sticky left-0 z-[1] h-7 w-10 cursor-pointer border-r border-line px-1 text-center font-semibold ${
                        rect && mode !== "col" && r >= rect.minR && r <= rect.maxR
                          ? "bg-teal text-primary-foreground"
                          : "bg-paper text-ink-400 hover:bg-teal-soft"
                      }`}
                    >
                      {r + 1}
                    </td>
                    {Array.from({ length: COLS }).map((_, c) => {
                      const val = rows[r]?.[c] ?? "";
                      const on = inRect(r, c);
                      return (
                        <td
                          key={c}
                          onMouseDown={() => startCell(r, c)}
                          onMouseEnter={() => extend(r, c)}
                          title={val}
                          className={`h-7 max-w-[140px] cursor-cell truncate border-b border-r border-line px-2 ${
                            on ? "bg-teal/15 text-ink-900" : "bg-card text-ink-700"
                          }`}
                          style={{ maxWidth: 140 }}
                        >
                          {val}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-4">
          <div className="font-mono text-sm">
            {rangeStr ? (
              <span className="text-ink-700">
                Selected:{" "}
                <span className="rounded bg-teal-soft px-2 py-0.5 font-semibold text-teal-600">
                  {tab ? `${tab}!${rangeStr}` : rangeStr}
                </span>
              </span>
            ) : (
              <span className="text-ink-400">nothing selected yet</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-ink-500 hover:bg-paper"
            >
              Cancel
            </button>
            <button
              onClick={() => rangeStr && onPick(rangeStr)}
              disabled={!rangeStr}
              className="rounded-lg bg-teal px-4 py-2 text-sm font-semibold text-primary-foreground shadow-xs transition-all hover:bg-teal-600 active:scale-[0.97] disabled:opacity-50"
            >
              Use this range
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
