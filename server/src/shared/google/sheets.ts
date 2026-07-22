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
// Row-only ranges ("5:5") and unparsable input yield 0.
export function rangeStartColumn(range: string): number {
  const m = range.trim().match(/^([A-Za-z]{1,3})\d*/);
  return m ? columnToIndex(m[1]) : 0;
}

// 1-based row number of the first row of an A1 range ("B2:D50" → 2, "C:C" → 1).
export function rangeStartRow(range: string): number {
  const m = range.trim().match(/^[A-Za-z]*?(\d+)/);
  return m ? Number(m[1]) : 1;
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
  const rows = await fetchRange(
    sheet.spreadsheetId,
    buildRange(sheet.tab, sheet.range),
    auth
  );

  if (sheet.watchMode !== "rowmatch" || !sheet.matchColumn) return rows;

  // Resolve the match column by header name, then column letters.
  const idx = resolveColumn(rows[0] ?? [], sheet.matchColumn);
  if (idx < 0) return rows; // column not found → fall back to full range

  const want = (sheet.matchValue ?? "").trim();
  return rows.filter((r) => ((r[idx] ?? "") as string).trim() === want);
}
