import { useCallback, useEffect, useState } from "react";
import { AvailableSheet } from "../types";
import { api } from "../lib/api";
import { useToast } from "./Toast";
import { SkeletonRows } from "./Skeleton";
import ConfirmModal from "./ConfirmModal";

interface Props {
  onChanged: () => void; // refresh the main list after a restore
}

// Spreadsheets in the Google Drive bin: restore or delete forever.
export default function DriveBin({ onChanged }: Props) {
  const toast = useToast();
  const [files, setFiles] = useState<AvailableSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [toDelete, setToDelete] = useState<AvailableSheet | null>(null);

  const refetch = useCallback(async () => {
    try {
      const data = await api.get<AvailableSheet[]>("/api/sheets/drive/trash");
      setFiles(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t load the Drive bin");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const restore = async (f: AvailableSheet) => {
    setBusy((b) => ({ ...b, [f.spreadsheetId]: true }));
    try {
      await api.post(`/api/sheets/drive/${f.spreadsheetId}/restore`);
      toast.success(`Restored “${f.name}”`);
      await refetch();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setBusy((b) => ({ ...b, [f.spreadsheetId]: false }));
    }
  };

  const deleteForever = async (f: AvailableSheet) => {
    try {
      await api.delete(`/api/sheets/drive/${f.spreadsheetId}/forever`);
      toast.success(`Permanently deleted “${f.name}”`);
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  if (loading) return <SkeletonRows count={3} />;

  if (error) {
    return (
      <div className="rounded-2xl border border-coral/30 bg-coral-soft px-5 py-4">
        <p className="text-sm font-medium text-coral-600">{error}</p>
        <button onClick={refetch} className="mt-2 font-mono text-xs text-coral-600 underline">
          try again
        </button>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-surface px-6 py-14 text-center">
        <p className="text-sm font-medium text-ink-700">Bin is empty</p>
        <p className="mt-1 text-sm text-ink-400">No spreadsheets in your Drive trash.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
          🗑 {files.length} in bin — items are auto-deleted by Google after ~30 days
        </span>
        <button
          onClick={refetch}
          className="rounded-md px-2 py-1 font-mono text-[11px] text-ink-400 transition-colors hover:bg-paper hover:text-ink-700 active:scale-95"
        >
          ↻ refresh
        </button>
      </div>

      <ul className="divide-y divide-line">
        {files.map((f) => (
          <li
            key={f.spreadsheetId}
            className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-paper/60"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-sm font-semibold text-ink-700">{f.name}</p>
              {f.modifiedTime && (
                <p className="mt-0.5 font-mono text-[11px] text-ink-400">
                  edited {new Date(f.modifiedTime).toLocaleDateString()}
                </p>
              )}
            </div>

            <button
              onClick={() => restore(f)}
              disabled={busy[f.spreadsheetId]}
              className="shrink-0 rounded-lg border border-teal/40 bg-teal-soft px-3.5 py-2 text-[13px] font-semibold text-teal-600 transition-all hover:bg-teal hover:text-primary-foreground active:scale-[0.97] disabled:opacity-50"
            >
              ↩ Restore
            </button>
            <button
              onClick={() => setToDelete(f)}
              disabled={busy[f.spreadsheetId]}
              className="shrink-0 rounded-lg border border-line bg-card px-3.5 py-2 text-[13px] font-semibold text-ink-400 transition-all hover:border-coral/50 hover:bg-coral-soft hover:text-coral-600 active:scale-[0.97] disabled:opacity-50"
            >
              ✕ Delete forever
            </button>
          </li>
        ))}
      </ul>

      {toDelete && (
        <ConfirmModal
          title="Delete forever?"
          message={`“${toDelete.name}” will be permanently deleted from Google Drive. This cannot be undone.`}
          confirmLabel="Delete forever"
          danger
          onConfirm={() => deleteForever(toDelete)}
          onClose={() => setToDelete(null)}
        />
      )}
    </div>
  );
}
