import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { AvailableSheet } from "../types";
import { useToast } from "./Toast";
import Spinner from "./Spinner";
import { SkeletonRows } from "./Skeleton";
import { ModalShell } from "./Modal";

interface Props {
  projectId: string;
  projectName: string;
  onClose: () => void;
  onDone: () => void;
}

export default function AddSheetsModal({ projectId, projectName, onClose, onDone }: Props) {
  const [available, setAvailable] = useState<AvailableSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const toast = useToast();

  const load = () =>
    api
      .get<AvailableSheet[]>("/api/sheets/available")
      .then(setAvailable)
      .catch(() => setAvailable([]))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const add = async (s: AvailableSheet) => {
    setBusy((b) => ({ ...b, [s.spreadsheetId]: true }));
    try {
      if (s.tracked && s.sheetId) {
        await api.patch(`/api/sheets/${s.sheetId}`, { projectId });
      } else {
        await api.post("/api/sheets", { spreadsheetId: s.spreadsheetId, projectId });
      }
      toast.success(`Added “${s.name}” to ${projectName}`);
      onDone();
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t add sheet");
    } finally {
      setBusy((b) => ({ ...b, [s.spreadsheetId]: false }));
    }
  };

  const filtered = available.filter((s) =>
    s.name.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-lg">
      <div className="flex max-h-[80vh] flex-col">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-display text-lg font-bold text-ink-900">
            Add sheets to {projectName}
          </h2>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your sheets…"
            className="mt-3 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-hidden transition-shadow focus:border-teal focus:ring-4 focus:ring-teal/10"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {loading ? (
            <div className="px-2 py-2">
              <SkeletonRows count={4} />
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-6 text-sm text-ink-400">No matching sheets.</p>
          ) : (
            <ul className="divide-y divide-line">
              {filtered.map((s) => (
                <li key={s.spreadsheetId} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-900">{s.name}</p>
                    <span className="font-mono text-[10px] uppercase tracking-wide text-ink-400">
                      {s.ownedByMe ? "owner" : "shared"}
                    </span>
                  </div>
                  <button
                    onClick={() => add(s)}
                    disabled={busy[s.spreadsheetId]}
                    className="inline-flex w-24 shrink-0 items-center justify-center rounded-lg bg-teal px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-xs transition-all hover:bg-teal-600 active:scale-[0.97] disabled:opacity-50"
                  >
                    {busy[s.spreadsheetId] ? <Spinner /> : s.tracked ? "Move here" : "+ Add"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-line px-5 py-3 text-right">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-ink-500 hover:bg-paper"
          >
            Done
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
