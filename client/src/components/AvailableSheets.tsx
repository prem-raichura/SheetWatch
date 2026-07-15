import { useState } from "react";
import { AvailableSheet } from "../types";
import { api } from "../lib/api";
import { useToast } from "./Toast";
import Spinner from "./Spinner";
import { SkeletonRows } from "./Skeleton";
import ConfirmModal from "./ConfirmModal";

interface Props {
  available: AvailableSheet[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onChanged: () => void;
  emptyHint?: string;
  view?: "list" | "cards";
}

export default function AvailableSheets({
  available,
  loading,
  error,
  onRefresh,
  onChanged,
  emptyHint,
  view = "list",
}: Props) {
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [toTrash, setToTrash] = useState<AvailableSheet | null>(null);
  const toast = useToast();

  const trash = async (sheet: AvailableSheet) => {
    try {
      await api.delete(`/api/sheets/drive/${sheet.spreadsheetId}`);
      toast.success(`Moved “${sheet.name}” to Drive trash`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t delete");
    }
  };

  const toggle = async (sheet: AvailableSheet) => {
    setBusy((b) => ({ ...b, [sheet.spreadsheetId]: true }));
    try {
      if (sheet.tracked && sheet.sheetId) {
        await api.delete(`/api/sheets/${sheet.sheetId}`);
        toast.success(`Stopped watching “${sheet.name}”`);
      } else {
        await api.post("/api/sheets", { spreadsheetId: sheet.spreadsheetId });
        toast.success(`Now watching “${sheet.name}”`);
      }
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t update");
      onRefresh();
    } finally {
      setBusy((b) => ({ ...b, [sheet.spreadsheetId]: false }));
    }
  };

  if (loading) {
    return <SkeletonRows count={5} />;
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-coral/30 bg-coral-soft px-5 py-4">
        <p className="text-sm font-medium text-coral-600">{error}</p>
        <button
          onClick={onRefresh}
          className="mt-2 font-mono text-xs text-coral-600 underline"
        >
          try again
        </button>
      </div>
    );
  }

  if (available.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-surface px-6 py-14 text-center">
        <p className="text-sm font-medium text-ink-700">No spreadsheets found</p>
        <p className="mt-1 text-sm text-ink-400">
          {emptyHint ?? "Nothing in this Google account yet."}
        </p>
      </div>
    );
  }

  const trashBtn = (s: AvailableSheet) =>
    s.ownedByMe ? (
      <button
        onClick={() => setToTrash(s)}
        aria-label={`Delete ${s.name} from Drive`}
        title="Move to Drive trash"
        className="shrink-0 rounded-lg border border-line bg-card px-2.5 py-2 text-sm text-ink-400 transition-all hover:border-coral/50 hover:bg-coral-soft hover:text-coral-600 active:scale-[0.97]"
      >
        🗑
      </button>
    ) : null;

  const trackBtn = (s: AvailableSheet) => (
    <button
      onClick={() => toggle(s)}
      disabled={busy[s.spreadsheetId]}
      className={`group/btn inline-flex w-28 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-4 py-2 text-[13px] font-semibold transition-all active:scale-[0.97] disabled:opacity-50 ${
        s.tracked
          ? "border-teal/40 bg-card text-teal-600 hover:border-coral/50 hover:bg-coral-soft hover:text-coral-600"
          : "border-teal bg-teal text-primary-foreground shadow-xs hover:bg-teal-600 hover:shadow-md"
      }`}
    >
      {busy[s.spreadsheetId] ? (
        <Spinner />
      ) : s.tracked ? (
        <>
          <span className="group-hover/btn:hidden">✓ Tracking</span>
          <span className="hidden group-hover/btn:inline">✕ Stop</span>
        </>
      ) : (
        <>+ Track</>
      )}
    </button>
  );

  const ownerChip = (s: AvailableSheet) => (
    <span
      className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
        s.ownedByMe ? "bg-paper text-ink-400" : "bg-coral-soft text-coral-600"
      }`}
    >
      {s.ownedByMe ? "owner" : "shared"}
    </span>
  );

  if (view === "cards") {
    return (
      <div>
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
            {available.length} sheets
          </span>
          <button
            onClick={onRefresh}
            className="rounded-md px-2 py-1 font-mono text-[11px] text-ink-400 transition-colors hover:bg-paper hover:text-ink-700 active:scale-95"
          >
            ↻ refresh
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {available.map((s) => (
            <div
              key={s.spreadsheetId}
              className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card transition-colors hover:border-ink-300"
            >
              <a
                href={`https://docs.google.com/spreadsheets/d/${s.spreadsheetId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="line-clamp-2 font-display text-sm font-semibold text-ink-900 hover:text-teal-600"
              >
                {s.name}
              </a>
              <div className="flex items-center gap-2">
                {ownerChip(s)}
                {s.modifiedTime && (
                  <span className="font-mono text-[11px] text-ink-400">
                    {new Date(s.modifiedTime).toLocaleDateString()}
                  </span>
                )}
              </div>
              <div className="mt-auto flex items-center gap-2">
                {trackBtn(s)}
                {trashBtn(s)}
              </div>
            </div>
          ))}
        </div>
        {toTrash && (
          <ConfirmModal
            title="Delete from Google Drive?"
            message={`“${toTrash.name}” will move to your Drive trash${
              toTrash.tracked ? " and SheetWatch will stop watching it" : ""
            }. You can restore it from Drive trash for ~30 days.`}
            confirmLabel="Move to trash"
            danger
            onConfirm={() => trash(toTrash)}
            onClose={() => setToTrash(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
          {available.length} sheets
        </span>
        <button
          onClick={onRefresh}
          className="rounded-md px-2 py-1 font-mono text-[11px] text-ink-400 transition-colors hover:bg-paper hover:text-ink-700 active:scale-95"
        >
          ↻ refresh
        </button>
      </div>

      <ul className="divide-y divide-line">
        {available.map((s) => (
          <li
            key={s.spreadsheetId}
            className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-paper/60"
          >
            <div className="min-w-0 flex-1">
              <a
                href={`https://docs.google.com/spreadsheets/d/${s.spreadsheetId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate font-display text-sm font-semibold text-ink-900 hover:text-teal-600"
              >
                {s.name}
              </a>
              <div className="mt-0.5 flex items-center gap-2">
                {ownerChip(s)}
                {s.modifiedTime && (
                  <span className="font-mono text-[11px] text-ink-400">
                    edited {new Date(s.modifiedTime).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>

            {trashBtn(s)}
            {trackBtn(s)}
          </li>
        ))}
      </ul>

      {toTrash && (
        <ConfirmModal
          title="Delete from Google Drive?"
          message={`“${toTrash.name}” will move to your Drive trash${
            toTrash.tracked ? " and SheetWatch will stop watching it" : ""
          }. You can restore it from Drive trash for ~30 days.`}
          confirmLabel="Move to trash"
          danger
          onConfirm={() => trash(toTrash)}
          onClose={() => setToTrash(null)}
        />
      )}
    </div>
  );
}
