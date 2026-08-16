import { useEffect, useMemo, useState } from "react";
import { ModalShell } from "../Modal";
import { api } from "../../lib/api";
import { indexToColumn as colLetter } from "../../lib/grid";
import { SkeletonRows } from "../Skeleton";
import SheetPicker from "../SheetPicker";
import PickFromSheetButton from "../PickFromSheetButton";
import type { CompareGroup, DriveSheet } from "../../types";
import type { NewGroup } from "../../hooks/useCompare";

interface Props {
  group?: CompareGroup | null; // present = edit
  onClose: () => void;
  onSave: (g: NewGroup) => Promise<void>;
}

// Pull a spreadsheet id out of a pasted Google Sheets URL, or accept a bare id.
function sheetIdFromQuery(q: string): string | null {
  const s = q.trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-_]{30,}$/.test(s)) return s; // looks like a raw id
  return null;
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
  const [picking, setPicking] = useState<null | "key" | "compare">(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Sheets added by pasting a link (not in the Drive list). Kept so a picked
  // link stays visible after the search box is cleared.
  const [linked, setLinked] = useState<DriveSheet[]>([]);
  const [resolving, setResolving] = useState(false);
  const [resolveErr, setResolveErr] = useState<string | null>(null);

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

  // Known sheets = pasted links first, then the Drive list, de-duplicated.
  const pool = useMemo(() => {
    const seen = new Set<string>();
    const out: DriveSheet[] = [];
    for (const s of [...linked, ...drive]) {
      if (seen.has(s.spreadsheetId)) continue;
      seen.add(s.spreadsheetId);
      out.push(s);
    }
    return out;
  }, [linked, drive]);

  const queryId = useMemo(() => sheetIdFromQuery(query), [query]);

  // When the search box holds a Google Sheets link we don't already know,
  // resolve it (validate access + fetch its title) and add it to the list.
  useEffect(() => {
    setResolveErr(null);
    if (!queryId || pool.some((s) => s.spreadsheetId === queryId)) {
      setResolving(false);
      return;
    }
    let live = true;
    setResolving(true);
    const t = setTimeout(() => {
      api
        .get<{ spreadsheetId: string; name: string }>(
          `/api/compare/resolve?url=${encodeURIComponent(query.trim())}`
        )
        .then((r) => {
          if (!live) return;
          setLinked((prev) =>
            prev.some((s) => s.spreadsheetId === r.spreadsheetId)
              ? prev
              : [{ spreadsheetId: r.spreadsheetId, name: r.name, ownedByMe: false, modifiedTime: "" }, ...prev]
          );
        })
        .catch((e) => live && setResolveErr(e instanceof Error ? e.message : "Couldn’t open that sheet"))
        .finally(() => live && setResolving(false));
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [queryId, query, pool]);

  const selectedIds = useMemo(
    () => new Set([masterId, ...targetIds].filter(Boolean)),
    [masterId, targetIds]
  );

  // Selected sheets pinned on top (so picks stay visible under any filter),
  // then the search-name / pasted-link matches.
  const visible = useMemo(() => {
    const selected = pool.filter((s) => selectedIds.has(s.spreadsheetId));
    const nq = query.trim().toLowerCase();
    const rest = pool.filter((s) => {
      if (selectedIds.has(s.spreadsheetId)) return false;
      return queryId ? s.spreadsheetId === queryId : !nq || s.name.toLowerCase().includes(nq);
    });
    return [...selected, ...rest];
  }, [pool, selectedIds, query, queryId]);

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
              placeholder="Search sheets, or paste a Google Sheets link…"
            />
            <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-line bg-paper p-2">
              {driveLoading ? (
                <SkeletonRows count={4} />
              ) : visible.length === 0 ? (
                <p className="px-1 py-2 text-xs text-ink-400">
                  {resolving
                    ? "Opening that link…"
                    : resolveErr
                      ? resolveErr
                      : queryId
                        ? "Couldn’t open that link."
                        : drive.length === 0
                          ? "No sheets in your Drive. Paste a Google Sheets link to add one."
                          : "No matches. Paste a Google Sheets link to add a sheet."}
                </p>
              ) : (
                <>
                  {resolving && (
                    <p className="px-1 py-1 text-[11px] text-ink-400">Opening that link…</p>
                  )}
                  {resolveErr && !resolving && (
                    <p className="px-1 py-1 text-[11px] text-coral-600">{resolveErr}</p>
                  )}
                  {visible.map((s) => {
                    const isMaster = masterId === s.spreadsheetId;
                    const isTarget = !isMaster && targetIds.includes(s.spreadsheetId);
                    const fromLink = linked.some((l) => l.spreadsheetId === s.spreadsheetId);
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
                          {fromLink ? "link" : s.ownedByMe ? "owner" : "shared"}
                        </span>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>

          <label className="block">
            <span className="mb-1 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-ink-500">
                Key column <span className="font-normal text-ink-400">(optional — matches rows across sheets)</span>
              </span>
              <PickFromSheetButton onClick={() => setPicking("key")} disabled={!masterId} />
            </span>
            <input className={input} value={keyColumn} onChange={(e) => setKeyColumn(e.target.value)} placeholder="e.g. A — leave blank to match by row position" />
          </label>

          <label className="block">
            <span className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold text-ink-500">Columns to compare</span>
              <PickFromSheetButton onClick={() => setPicking("compare")} disabled={!masterId} />
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

      {picking === "key" && masterId && (
        <SheetPicker
          select="column"
          source={{ kind: "raw", spreadsheetId: masterId }}
          tab={masterTab}
          initial={keyColumn}
          title="Pick the key column"
          hint="Click the column whose values identify a row across sheets."
          onClose={() => setPicking(null)}
          onPick={(picked) => {
            setKeyColumn(picked);
            setPicking(null);
          }}
        />
      )}

      {picking === "compare" && masterId && (
        <SheetPicker
          select="columns"
          source={{ kind: "raw", spreadsheetId: masterId }}
          tab={masterTab}
          initial={parsedColumns}
          title="Pick the columns to compare"
          onClose={() => setPicking(null)}
          onPick={(cols) => {
            setCompareColumns(cols.join(", "));
            setPicking(null);
          }}
        />
      )}
    </ModalShell>
  );
}
