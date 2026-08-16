import { google, Auth } from "googleapis";

export function extractSpreadsheetId(url: string): string {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) throw new Error("Not a valid Google Sheets URL");
  return m[1];
}

// Prefix an A1 range with a tab title when set: "Sheet2!B2:D50".
export function buildRange(tab: string | null | undefined, range: string): string {
  if (!tab) return range;
  const safe = tab.replace(/'/g, "''");
  return `'${safe}'!${range}`;
}

// A watched range may be several blocks: "B2:D50, G1:G9". Columns are
// zero-based, rows one-based, and an open edge (whole column / whole row) is
// Infinity. One block behaves exactly as it always did.
export interface A1Block {
  c1: number;
  c2: number;
  r1: number;
  r2: number;
}

const CELL = /^([A-Za-z]{1,3})(\d+)$/;
const COLS = /^([A-Za-z]{1,3})$/;
const ROWS = /^(\d+)$/;

function parseBlock(token: string): A1Block | null {
  const t = token.trim();
  if (!t) return null;
  const [a, b, extra] = t.split(":");
  if (extra !== undefined) return null;
  const end = b === undefined ? a : b;

  const ca = CELL.exec(a);
  const cb = CELL.exec(end);
  if (ca && cb) {
    const c1 = columnToIndex(ca[1]);
    const c2 = columnToIndex(cb[1]);
    const r1 = Number(ca[2]);
    const r2 = Number(cb[2]);
    return {
      c1: Math.min(c1, c2),
      c2: Math.max(c1, c2),
      r1: Math.min(r1, r2),
      r2: Math.max(r1, r2),
    };
  }

  const la = COLS.exec(a);
  const lb = COLS.exec(end);
  if (la && lb) {
    const c1 = columnToIndex(la[1]);
    const c2 = columnToIndex(lb[1]);
    return { c1: Math.min(c1, c2), c2: Math.max(c1, c2), r1: 1, r2: Infinity };
  }

  const na = ROWS.exec(a);
  const nb = ROWS.exec(end);
  if (na && nb) {
    const r1 = Number(na[1]);
    const r2 = Number(nb[1]);
    return { c1: 0, c2: Infinity, r1: Math.min(r1, r2), r2: Math.max(r1, r2) };
  }

  return null;
}

// Every block in a range string. Unparsable tokens are dropped; an entirely
// unparsable range yields [].
export function parseRanges(range: string): A1Block[] {
  return (range ?? "")
    .split(",")
    .map(parseBlock)
    .filter((b): b is A1Block => b !== null);
}

export function isValidRange(range: string): boolean {
  const tokens = (range ?? "").split(",").filter((t) => t.trim());
  return tokens.length > 0 && tokens.every((t) => parseBlock(t) !== null);
}

// The single A1 range that covers every block — what actually gets fetched, so
// a multi-block watch still costs one Sheets call.
export function boundingA1(range: string): string {
  const blocks = parseRanges(range);
  if (blocks.length === 0) return range.trim();

  const minC = Math.min(...blocks.map((b) => b.c1));
  const maxC = Math.max(...blocks.map((b) => b.c2));
  const minR = Math.min(...blocks.map((b) => b.r1));
  const maxR = Math.max(...blocks.map((b) => b.r2));

  const colsOpen = !Number.isFinite(maxC);
  const rowsOpen = !Number.isFinite(maxR);

  if (!colsOpen && !rowsOpen) {
    return `${indexToColumn(minC)}${minR}:${indexToColumn(maxC)}${maxR}`;
  }
  // Whole rows and whole columns together: everything worth reading.
  if (colsOpen && rowsOpen) return "A:ZZ";
  // Whole columns: bounded left/right, open at the bottom ("B1:G").
  if (rowsOpen) return `${indexToColumn(minC)}${minR}:${indexToColumn(maxC)}`;
  // Whole rows: bounded top/bottom, every column ("2:50").
  return `${minR}:${maxR}`;
}

// Blank out everything the user didn't select. The fetched grid is the
// bounding box, so cells between two blocks would otherwise be watched.
export function maskOutsideBlocks(rows: string[][], range: string): string[][] {
  const blocks = parseRanges(range);
  if (blocks.length < 2) return rows;

  const originC = rangeStartColumn(range);
  const originR = rangeStartRow(range);
  const inside = (r: number, c: number) =>
    blocks.some((b) => c >= b.c1 && c <= b.c2 && r >= b.r1 && r <= b.r2);

  return rows.map((row, ri) =>
    row.map((value, ci) => (inside(originR + ri, originC + ci) ? value : ""))
  );
}

export async function validateAndSnapshot(
  spreadsheetId: string,
  range: string,
  auth: Auth.OAuth2Client
): Promise<{ label: string; rows: string[][] }> {
  const sheets = google.sheets({ version: "v4", auth });
  const [meta, values] = await Promise.all([
    sheets.spreadsheets.get({ spreadsheetId }),
    sheets.spreadsheets.values.get({ spreadsheetId, range }),
  ]);
  return {
    label: meta.data.properties?.title ?? spreadsheetId,
    rows: (values.data.values ?? []) as string[][],
  };
}

export async function fetchRange(
  spreadsheetId: string,
  range: string,
  auth: Auth.OAuth2Client
): Promise<string[][]> {
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return (res.data.values ?? []) as string[][];
}

// Read a handful of individual cells in one call. Each range is a full A1
// reference (tab-qualified where needed); the result is positional, with null
// for a cell that's empty or unreadable.
export async function fetchCells(
  spreadsheetId: string,
  ranges: string[],
  auth: Auth.OAuth2Client
): Promise<(string | null)[]> {
  if (ranges.length === 0) return [];
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges });
  const valueRanges = res.data.valueRanges ?? [];
  return ranges.map((_, i) => {
    const v = valueRanges[i]?.values?.[0]?.[0];
    return v === undefined || v === null ? null : String(v);
  });
}

export async function listTabs(
  spreadsheetId: string,
  auth: Auth.OAuth2Client
): Promise<string[]> {
  const sheets = google.sheets({ version: "v4", auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  return (meta.data.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter((t): t is string => !!t);
}

// A1 column letters → zero-based index. "A"→0, "C"→2, "AA"→26.
export function columnToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// Zero-based index → A1 column letters. 0→"A", 2→"C", 26→"AA".
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

// Zero-based index of the first column of an A1 range ("B2:D50" → 1).
// Row-only ranges ("5:5") and unparsable input yield 0. With several blocks
// this is the bounding box's first column — the origin of the fetched grid.
export function rangeStartColumn(range: string): number {
  const blocks = parseRanges(range);
  if (blocks.length === 0) {
    const m = range.trim().match(/^([A-Za-z]{1,3})\d*/);
    return m ? columnToIndex(m[1]) : 0;
  }
  return Math.min(...blocks.map((b) => b.c1));
}

// 1-based row number of the first row of an A1 range ("B2:D50" → 2, "C:C" → 1).
export function rangeStartRow(range: string): number {
  const blocks = parseRanges(range);
  if (blocks.length === 0) {
    const m = range.trim().match(/^[A-Za-z]*?(\d+)/);
    return m ? Number(m[1]) : 1;
  }
  return Math.min(...blocks.map((b) => b.r1));
}

// Resolve a column reference against a grid's header row. Matches a header name
// first (case-insensitive, trimmed) so short labels like "ID"/"No" work, then
// falls back to A1 column letters. Returns a zero-based index, or -1 if absent.
export function resolveColumn(headerRow: string[], colNameOrLetter: string): number {
  const col = (colNameOrLetter ?? "").trim();
  if (!col) return -1;
  const idx = headerRow.findIndex((h) => (h ?? "").trim().toLowerCase() === col.toLowerCase());
  if (idx >= 0) return idx;
  if (/^[A-Za-z]{1,3}$/.test(col)) return columnToIndex(col);
  return -1;
}

// Column resolution for the Compare feature: comparisons are anchored to the
// spreadsheet's built-in column letters (A, B, AA) so row 0 stays real data and
// matching keeps working even when a sheet is emptied. Returns a zero-based
// index, or -1 for anything that isn't a column letter.
export function resolveCompareColumn(ref: string): number {
  const s = (ref ?? "").trim();
  return /^[A-Za-z]{1,3}$/.test(s) ? columnToIndex(s) : -1;
}

// Write individual cells. Each update is an absolute A1 range (tab-qualified
// where needed) and a single scalar value. One batched call per spreadsheet.
export async function updateCells(
  spreadsheetId: string,
  updates: { range: string; value: string }[],
  auth: Auth.OAuth2Client
): Promise<void> {
  if (updates.length === 0) return;
  const sheets = google.sheets({ version: "v4", auth });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: updates.map((u) => ({ range: u.range, values: [[u.value]] })),
    },
  });
}

interface ScopeInput {
  spreadsheetId: string;
  tab: string | null;
  range: string;
  watchMode: string;
  matchColumn: string | null;
  matchValue: string | null;
}

// Fetch the watched cells for a sheet, applying tab + optional row-match filter.
export async function fetchScoped(
  sheet: ScopeInput,
  auth: Auth.OAuth2Client
): Promise<string[][]> {
  // One call for the bounding box, then blank whatever falls between blocks.
  const raw = await fetchRange(
    sheet.spreadsheetId,
    buildRange(sheet.tab, boundingA1(sheet.range)),
    auth
  );
  const rows = maskOutsideBlocks(raw, sheet.range);

  if (sheet.watchMode !== "rowmatch" || !sheet.matchColumn) return rows;

  // Resolve the match column by header name, then column letters.
  const idx = resolveColumn(rows[0] ?? [], sheet.matchColumn);
  if (idx < 0) return rows; // column not found → fall back to full range

  const want = (sheet.matchValue ?? "").trim();
  return rows.filter((r) => ((r[idx] ?? "") as string).trim() === want);
}
