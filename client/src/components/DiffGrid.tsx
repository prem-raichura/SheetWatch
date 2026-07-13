import { CellChange } from "../types";
import { indexToColumn, parseCellRef, rangeStart } from "../lib/grid";

interface Props {
  rows: string[][];
  startRow?: number; // 1-based first grid row included in `rows`
  changes: CellChange[];
  range: string; // watched A1 range, for real row/col labels
}

// Spreadsheet-style table with changed cells highlighted (old value struck
// through, new value emphasised).
export default function DiffGrid({ rows, startRow = 1, changes, range }: Props) {
  const origin = rangeStart(range);

  const changed = new Map<string, CellChange>();
  for (const c of changes) {
    const ref = parseCellRef(c.cell);
    if (ref) changed.set(`${ref.row}:${ref.col}`, c);
  }

  const colCount = Math.max(1, ...rows.map((r) => r.length));

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse font-mono text-[11px]">
        <thead>
          <tr>
            <th className="sticky left-0 border border-line bg-paper px-2 py-1 text-ink-300" />
            {Array.from({ length: colCount }, (_, c) => (
              <th
                key={c}
                className="border border-line bg-paper px-2 py-1 font-semibold text-ink-400"
              >
                {indexToColumn(origin.col + c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const gridRow = startRow + i;
            return (
              <tr key={gridRow}>
                <td className="sticky left-0 border border-line bg-paper px-2 py-1 text-right font-semibold text-ink-400">
                  {origin.row + gridRow - 1}
                </td>
                {Array.from({ length: colCount }, (_, c) => {
                  const change = changed.get(`${gridRow}:${c + 1}`);
                  const value = row[c] ?? "";
                  if (!change) {
                    return (
                      <td key={c} className="max-w-40 truncate border border-line px-2 py-1 text-ink-700">
                        {value}
                      </td>
                    );
                  }
                  return (
                    <td
                      key={c}
                      className="max-w-40 border border-amber-300 bg-amber-50 px-2 py-1"
                      title={`${change.before || "∅"} → ${change.after || "∅"}`}
                    >
                      {change.before !== "" && (
                        <span className="mr-1 text-coral-600 line-through">{change.before}</span>
                      )}
                      <span className="font-semibold text-teal-600">{change.after || "∅"}</span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
