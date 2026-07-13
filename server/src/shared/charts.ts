import type { ChartWidget } from "@prisma/client";
import { columnToIndex, rangeStartColumn } from "./google/sheets";
import { parseNumeric } from "./rules";

export interface ChartData {
  labels: string[];
  series: { name: string; data: (number | null)[] }[];
}

const RANGE_RE = /^([A-Za-z]{1,3})(\d+):([A-Za-z]{1,3})(\d+)$/;

export function parseA1Range(
  range: string
): { c1: number; r1: number; c2: number; r2: number } | null {
  const m = RANGE_RE.exec(range.trim());
  if (!m) return null;
  const c1 = columnToIndex(m[1]);
  const r1 = Number(m[2]);
  const c2 = columnToIndex(m[3]);
  const r2 = Number(m[4]);
  return {
    c1: Math.min(c1, c2),
    r1: Math.min(r1, r2),
    c2: Math.max(c1, c2),
    r2: Math.max(r1, r2),
  };
}

// Slices the watched grid (sheet.lastSnapshot) by the widget's A1 range —
// both are absolute sheet coordinates; the grid starts at the sheet range's
// first cell. Ragged rows and non-numeric cells become nulls.
export function extractChartData(
  rows: string[][],
  sheetRange: string,
  widget: Pick<ChartWidget, "range" | "xColumn" | "dataColumns" | "headerRow">
): ChartData {
  const box = parseA1Range(widget.range);
  if (!box) return { labels: [], series: [] };

  const colOffset = rangeStartColumn(sheetRange);
  const rowStart = Number((sheetRange.trim().match(/^[A-Za-z]{1,3}(\d+)/) ?? [])[1] ?? 1);

  const grid: string[][] = [];
  for (let r = box.r1; r <= box.r2; r++) {
    const row: string[] = [];
    for (let c = box.c1; c <= box.c2; c++) {
      row.push(rows[r - rowStart]?.[c - colOffset] ?? "");
    }
    grid.push(row);
  }
  if (grid.length === 0) return { labels: [], series: [] };

  const width = box.c2 - box.c1 + 1;
  const colIndex = (letters: string) => columnToIndex(letters) - box.c1;

  const xIdx =
    widget.xColumn && colIndex(widget.xColumn) >= 0 && colIndex(widget.xColumn) < width
      ? colIndex(widget.xColumn)
      : 0;

  let dataIdxs =
    widget.dataColumns.length > 0
      ? widget.dataColumns
          .map(colIndex)
          .filter((i) => i >= 0 && i < width && i !== xIdx)
      : Array.from({ length: width }, (_, i) => i).filter((i) => i !== xIdx);
  if (dataIdxs.length === 0 && width === 1) dataIdxs = [0];

  const header = widget.headerRow ? grid[0] : null;
  const body = widget.headerRow ? grid.slice(1) : grid;

  const labels = body.map((row) => row[xIdx] ?? "");
  const series = dataIdxs.map((i) => ({
    name: header?.[i]?.trim() || `Col ${i + 1}`,
    data: body.map((row) => {
      const cell = row[i];
      // parseNumeric strips non-numeric chars, so "abc" would coerce to 0 —
      // require at least one digit before trusting the parse.
      if (cell === "" || cell === undefined || !/\d/.test(cell)) return null;
      const n = parseNumeric(cell);
      return Number.isNaN(n) ? null : n;
    }),
  }));

  return { labels, series };
}
