// A1 helpers mirrored from the server (server/src/shared/google/sheets.ts).

export function columnToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function indexToColumn(i: number): string {
  let n = i + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

// Zero-based column and 1-based row of an A1 range's first cell.
// "B2:D50" → { col: 1, row: 2 }; row-only/unparsable → { col: 0, row: 1 }.
export function rangeStart(range: string): { col: number; row: number } {
  const m = range.trim().match(/^([A-Za-z]{1,3})(\d*)/);
  if (!m) return { col: 0, row: 1 };
  return { col: columnToIndex(m[1]), row: m[2] ? Number(m[2]) : 1 };
}

// Grid-relative cell ref "R3C2" → { row: 3, col: 2 } (1-based) or null.
export function parseCellRef(cell: string): { row: number; col: number } | null {
  const m = /^R(\d+)C(\d+)$/.exec(cell);
  return m ? { row: Number(m[1]), col: Number(m[2]) } : null;
}

export type GridCell = { r: number; c: number };
export type SelectionMode = "cell" | "row" | "col";
export interface A1Selection {
  mode: SelectionMode;
  anchor: GridCell;
  focus: GridCell;
}

// Parse a saved A1 value back into a grid selection so reopening a picker
// restores what the field already holds. Zero-based, absolute (a preview grid
// always starts at A1). Handles "A1", "A1:C30", "C:F", "C", "5:9", "5".
// Returns null for anything unparsable — callers then start with nothing
// selected rather than committing a guess.
export function parseA1Selection(value: string): A1Selection | null {
  const s = value.trim().toUpperCase();
  if (!s) return null;

  const cellRe = /^([A-Z]{1,3})(\d+)$/;
  const one = (t: string) => cellRe.exec(t);

  const [left, right, extra] = s.split(":");
  if (extra !== undefined) return null;

  // Block or single cell: A1 / A1:C30
  const a = one(left);
  if (a) {
    const b = right === undefined ? a : one(right);
    if (!b) return null;
    return {
      mode: "cell",
      anchor: { r: Number(a[2]) - 1, c: columnToIndex(a[1]) },
      focus: { r: Number(b[2]) - 1, c: columnToIndex(b[1]) },
    };
  }

  // Whole columns: C / C:F
  if (/^[A-Z]{1,3}$/.test(left)) {
    const end = right === undefined ? left : right;
    if (!/^[A-Z]{1,3}$/.test(end)) return null;
    return {
      mode: "col",
      anchor: { r: 0, c: columnToIndex(left) },
      focus: { r: 0, c: columnToIndex(end) },
    };
  }

  // Whole rows: 5 / 5:9
  if (/^\d+$/.test(left)) {
    const end = right === undefined ? left : right;
    if (!/^\d+$/.test(end)) return null;
    return {
      mode: "row",
      anchor: { r: Number(left) - 1, c: 0 },
      focus: { r: Number(end) - 1, c: 0 },
    };
  }

  return null;
}
