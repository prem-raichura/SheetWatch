import { CellChange } from "./types";

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function csvRow(fields: string[]): string {
  return fields.map(csvEscape).join(",");
}

// Flatten change logs into one CSV row per cell change.
export function changesToCsv(
  changes: { id: string; createdAt: Date; summary: string; details: unknown }[],
  extra?: (change: { id: string }) => string[]
): string {
  const lines: string[] = [];
  for (const change of changes) {
    const details = (change.details as CellChange[]) ?? [];
    for (const cell of details) {
      lines.push(
        csvRow([
          ...(extra ? extra(change) : []),
          change.id,
          change.createdAt.toISOString(),
          change.summary,
          cell.cell,
          cell.before,
          cell.after,
        ])
      );
    }
  }
  return lines.join("\n");
}
