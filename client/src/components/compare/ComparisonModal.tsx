import { useEffect, useMemo, useState } from "react";
import { Table2 } from "lucide-react";
import { ModalShell } from "../Modal";
import { api } from "../../lib/api";
import { indexToColumn as colLetter } from "../../lib/grid";
import { SkeletonRows } from "../Skeleton";
import ColumnPickerModal from "./ColumnPickerModal";
import type { CompareGroup, DriveSheet } from "../../types";
import type { NewGroup } from "../../hooks/useCompare";

interface Props {
  group?: CompareGroup | null; // present = edit
  onClose: () => void;
  onSave: (g: NewGroup) => Promise<void>;
}

// Create/edit a comparison group. Sheets are chosen from the user's Google
// Drive (independent of tracking): pick one master and one or more targets,
// then a key column (optional) and the columns to compare.
export default function ComparisonModal({ group, onClose, onSave }: Props) {
  const [drive, setDrive] = useState<DriveSheet[]>([]);
  const [driveLoading, setDriveLoading] = useState(true);
  const [query, setQuery] = useState("");

  const [name, setName] = useState(group?.name ?? "");
  const [masterId, setMasterId] = useState(group?.master.spreadsheetId ?? "");
  const [masterTab] = useState<string | null>(group?.master.tab ?? null);
  const [targetIds, setTargetIds] = useState<string[]>(
    group?.targets.map((t) => t.spreadsheetId) ?? []
  );
  const [keyColumn, setKeyColumn] = useState(group?.keyColumn ?? "");
  const [compareColumns, setCompareColumns] = useState(group?.compareColumns.join(", ") ?? "");
  const [headers, setHeaders] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Load the user's Drive spreadsheets for the picker.
  useEffect(() => {
    let live = true;
    api
      .get<DriveSheet[]>("/api/compare/drive-sheets")
      .then((d) => live && setDrive(d))
      .catch(() => live && setErr("Couldn’t load your Google Drive sheets"))
      .finally(() => live && setDriveLoading(false));
    return () => {
      live = false;
    };
  }, []);

  // Offer column-letter chips sized to the master's width.
  useEffect(() => {
    if (!masterId) {
      setHeaders([]);
      return;
    }
    let live = true;
    api
      .get<{ rows: string[][] }>(
        `/api/compare/preview?spreadsheetId=${encodeURIComponent(masterId)}&rows=1${masterTab ? `&tab=${encodeURIComponent(masterTab)}` : ""}`
      )
      .then((d) => {
        if (!live) return;
        const width = Math.min(Math.max((d.rows[0] ?? []).length, 8), 26);
        setHeaders(Array.from({ length: width }, (_, i) => colLetter(i)));
      })
      .catch(() => live && setHeaders([]));
    return () => {
      live = false;
    };
  }, [masterId, masterTab]);

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

  const filtered = useMemo(
    () => drive.filter((s) => s.name.toLowerCase().includes(query.toLowerCase())),
    [drive, query]
  );

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
        master: { spreadsheetId: masterId, tab: masterTab },
        targets: targets.map((id) => ({ spreadsheetId: id, tab: null })),
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

          <div>
            <span className="mb-1 block text-xs font-semibold text-ink-500">
              Sheets <span className="font-normal text-ink-400">— set one master, tick the targets</span>
            </span>
            <input
              className={`${input} mb-2`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your Google Drive sheets…"
            />
            <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-line bg-paper p-2">
              {driveLoading ? (
                <SkeletonRows count={4} />
              ) : filtered.length === 0 ? (
                <p className="px-1 py-2 text-xs text-ink-400">
                  {drive.length === 0 ? "No spreadsheets found in your Google Drive." : "No matching sheets."}
                </p>
              ) : (
                filtered.map((s) => {
                  const isMaster = masterId === s.spreadsheetId;
                  const isTarget = !isMaster && targetIds.includes(s.spreadsheetId);
                  return (
                    <div key={s.spreadsheetId} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-secondary">
                      <button
                        type="button"
                        onClick={() => setMasterId(isMaster ? "" : s.spreadsheetId)}
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                          isMaster
                            ? "border-teal bg-teal text-primary-foreground"
                            : "border-line bg-surface text-ink-500 hover:border-teal/40 hover:text-teal-600"
                        }`}
                        title="Use as master"
                      >
                        {isMaster ? "Master" : "Master?"}
                      </button>
                      <label className={`flex min-w-0 flex-1 items-center gap-2 ${isMaster ? "opacity-50" : "cursor-pointer"}`}>
                        <input
                          type="checkbox"
                          disabled={isMaster}
                          checked={isTarget}
                          onChange={() => toggleTarget(s.spreadsheetId)}
                        />
                        <span className="truncate">{s.name}</span>
                      </label>
                      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-ink-400">
                        {s.ownedByMe ? "owner" : "shared"}
                      </span>
                    </div>
                  );
                })
              )}
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
          spreadsheetId={masterId}
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
