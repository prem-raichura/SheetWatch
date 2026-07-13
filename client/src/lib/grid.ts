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
