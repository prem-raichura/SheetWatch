import crypto from "crypto";
import { CellChange } from "../types";

export function hashGrid(rows: string[][]): string {
  return crypto.createHash("sha1").update(JSON.stringify(rows)).digest("hex");
}

export function diffGrid(oldRows: string[][] = [], newRows: string[][] = []): CellChange[] {
  const changes: CellChange[] = [];
  const maxRows = Math.max(oldRows.length, newRows.length);
  for (let r = 0; r < maxRows; r++) {
    const o = oldRows[r] || [];
    const n = newRows[r] || [];
    const maxCols = Math.max(o.length, n.length);
    for (let c = 0; c < maxCols; c++) {
      const before = o[c] ?? "";
      const after = n[c] ?? "";
      if (before !== after) changes.push({ cell: `R${r + 1}C${c + 1}`, before, after });
    }
  }
  return changes;
}

function rowsEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) if ((x[i] ?? "") !== (y[i] ?? "")) return false;
  return true;
}

export interface SmartDiff {
  changes: CellChange[];
  summary: string;
}

// Cell diff plus pure row insert/delete detection: a single inserted row
// would otherwise shift everything below it and register as hundreds of
// cell edits. Detect via common prefix/suffix of unchanged rows.
export function diffGridSmart(oldRows: string[][] = [], newRows: string[][] = []): SmartDiff {
  const delta = newRows.length - oldRows.length;
  if (delta !== 0) {
    const shorter = Math.min(oldRows.length, newRows.length);
    let prefix = 0;
    while (prefix < shorter && rowsEqual(oldRows[prefix], newRows[prefix])) prefix++;
    let suffix = 0;
    while (
      suffix < shorter - prefix &&
      rowsEqual(oldRows[oldRows.length - 1 - suffix], newRows[newRows.length - 1 - suffix])
    ) {
      suffix++;
    }

    // All surviving rows accounted for → the middle block was purely
    // inserted (delta > 0) or deleted (delta < 0).
    if (prefix + suffix >= shorter) {
      const count = Math.abs(delta);
      const changes: CellChange[] = [];
      if (delta > 0) {
        for (let r = prefix; r < prefix + count; r++) {
          (newRows[r] ?? []).forEach((v, c) => {
            if ((v ?? "") !== "") changes.push({ cell: `R${r + 1}C${c + 1}`, before: "", after: v });
          });
        }
      } else {
        for (let r = prefix; r < prefix + count; r++) {
          (oldRows[r] ?? []).forEach((v, c) => {
            if ((v ?? "") !== "") changes.push({ cell: `R${r + 1}C${c + 1}`, before: v, after: "" });
          });
        }
      }
      const verb = delta > 0 ? "inserted" : "deleted";
      const summary = `${count} row${count !== 1 ? "s" : ""} ${verb} at row ${prefix + 1}`;
      return { changes, summary };
    }
  }

  const changes = diffGrid(oldRows, newRows);
  return {
    changes,
    summary: `${changes.length} cell${changes.length !== 1 ? "s" : ""} changed`,
  };
}
