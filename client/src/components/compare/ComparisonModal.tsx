import { useEffect, useState } from "react";
import { Table2 } from "lucide-react";
import { ModalShell } from "../Modal";
import { api } from "../../lib/api";
import { indexToColumn as colLetter } from "../../lib/grid";
import ColumnPickerModal from "./ColumnPickerModal";
import type { CompareGroup, Sheet } from "../../types";
import type { NewGroup } from "../../hooks/useCompare";

interface Props {
  sheets: Sheet[];
  group?: CompareGroup | null; // present = edit
  onClose: () => void;
  onSave: (g: NewGroup) => Promise<void>;
}

// Create/edit a comparison group: pick the master sheet, the targets to keep in
// sync, a key column (optional) and the columns to compare. Columns are the
// sheet's own letters (A, B, C…); letter chips make column entry click-to-fill.
export default function ComparisonModal({ sheets, group, onClose, onSave }: Props) {
  const [name, setName] = useState(group?.name ?? "");
  const [masterId, setMasterId] = useState(group?.master.id ?? sheets[0]?.id ?? "");
  const [targetIds, setTargetIds] = useState<string[]>(group?.targets.map((t) => t.id) ?? []);
  const [keyColumn, setKeyColumn] = useState(group?.keyColumn ?? "");
  const [compareColumns, setCompareColumns] = useState(group?.compareColumns.join(", ") ?? "");
  const [headers, setHeaders] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const masterTab = sheets.find((s) => s.id === masterId)?.tab ?? null;

  // Offer column-letter chips sized to the master's width.
  useEffect(() => {
    if (!masterId) return;
    let live = true;
    api
      .get<{ rows: string[][] }>(`/api/sheets/${masterId}/preview?rows=1`)
      .then((d) => {
        if (!live) return;
        const width = Math.min(Math.max((d.rows[0] ?? []).length, 8), 26);
        setHeaders(Array.from({ length: width }, (_, i) => colLetter(i)));
      })
      .catch(() => live && setHeaders([]));
    return () => {
      live = false;
    };
  }, [masterId]);

  const toggleTarget = (id: string) =>
    setTargetIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const parsedColumns = compareColumns
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  const addColumn = (h: string) => {
    if (parsedColumns.some((c) => c.toLowerCase() === h.toLowerCase())) return;
    setCompareColumns((prev) => (prev.trim() ? `${prev.trim()}, ${h}` : h));
  };

  const submit = async () => {
    setErr(null);
    if (!name.trim()) return setErr("Name is required");
    if (!masterId) return setErr("Pick a master sheet");
    const targets = targetIds.filter((id) => id !== masterId);
    if (targets.length === 0) return setErr("Pick at least one target sheet");
    if (parsedColumns.length === 0) return setErr("Add at least one column to compare");
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        masterSheetId: masterId,
        targetSheetIds: targets,
        keyColumn: keyColumn.trim() || null,
        compareColumns: parsedColumns,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn’t save");
      setSaving(false);
    }
  };

  const input =
    "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-hidden transition-shadow focus:border-teal focus:ring-4 focus:ring-teal/10";

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-lg" label="Comparison group">
      <div className="max-h-[85vh] overflow-y-auto p-6">
        <h2 className="font-display text-lg font-bold text-ink-900">
          {group ? "Edit comparison" : "New comparison"}
        </h2>
        <p className="mt-1 text-sm text-ink-500">
          The master’s values are suggested onto the target sheets — never applied automatically.
        </p>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-500">Name</span>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Q3 roster sync" />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-500">Master sheet</span>
            <select className={input} value={masterId} onChange={(e) => setMasterId(e.target.value)}>
              {sheets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <div>
            <span className="mb-1 block text-xs font-semibold text-ink-500">Target sheets</span>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line bg-paper p-2">
              {sheets.filter((s) => s.id !== masterId).length === 0 && (
                <p className="px-1 py-2 text-xs text-ink-400">Track another sheet to compare against.</p>
              )}
              {sheets
                .filter((s) => s.id !== masterId)
                .map((s) => (
                  <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-secondary">
                    <input type="checkbox" checked={targetIds.includes(s.id)} onChange={() => toggleTarget(s.id)} />
                    <span className="truncate">{s.label}</span>
                  </label>
                ))}
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-500">
              Key column <span className="font-normal text-ink-400">(optional — matches rows across sheets)</span>
            </span>
            <input className={input} value={keyColumn} onChange={(e) => setKeyColumn(e.target.value)} placeholder="e.g. A — leave blank to match by row position" />
          </label>

          <label className="block">
            <span className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold text-ink-500">Columns to compare</span>
              <button
                type="button"
                onClick={() => masterId && setPickerOpen(true)}
                disabled={!masterId}
                className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink-600 transition-colors hover:border-teal/40 hover:text-teal-600 disabled:opacity-50"
              >
                <Table2 className="h-3 w-3" /> Choose from sheet
              </button>
            </span>
            <input className={input} value={compareColumns} onChange={(e) => setCompareColumns(e.target.value)} placeholder="e.g. B, C, D" />
            {headers.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {headers.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => addColumn(h)}
                    className="rounded-full border border-line bg-surface px-2.5 py-0.5 font-mono text-[11px] text-ink-500 transition-colors hover:border-teal/40 hover:text-teal-600"
                  >
                    + {h}
                  </button>
                ))}
              </div>
            )}
          </label>

          {err && <p className="text-sm font-medium text-coral-600">{err}</p>}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-ink-500 transition-colors hover:bg-paper">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="rounded-lg bg-teal px-4 py-2 text-sm font-semibold text-primary-foreground shadow-xs transition-all hover:bg-teal-600 active:scale-[0.97] disabled:opacity-50"
          >
            {saving ? "Saving…" : group ? "Save" : "Create"}
          </button>
        </div>
      </div>

      {pickerOpen && masterId && (
        <ColumnPickerModal
          sheetId={masterId}
          tab={masterTab}
          initialKey={keyColumn.trim() || null}
          initialColumns={parsedColumns}
          onClose={() => setPickerOpen(false)}
          onPick={({ keyColumn: k, compareColumns: cols }) => {
            setKeyColumn(k ?? "");
            setCompareColumns(cols.join(", "));
            setPickerOpen(false);
          }}
        />
      )}
    </ModalShell>
  );
}
