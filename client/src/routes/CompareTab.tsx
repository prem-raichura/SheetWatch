import { useCallback, useEffect, useMemo, useState } from "react";
import { GitCompareArrows, Plus, Play, Check, X, AlertTriangle, Trash2, Pencil } from "lucide-react";
import { useSheets } from "../hooks/useSheets";
import { useCompare, fetchSuggestions } from "../hooks/useCompare";
import { API_BASE } from "../lib/api";
import ComparisonModal from "../components/compare/ComparisonModal";
import ConfirmModal from "../components/ConfirmModal";
import { useToast } from "../components/Toast";
import { getMe } from "../lib/auth";
import { REALTIME_EVENT } from "../providers/RealtimeProvider";
import type { CompareGroup, CompareSuggestion, SuggestionStatus } from "../types";

const STATUS_TABS: { value: string; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "applied", label: "Applied" },
  { value: "ignored", label: "Ignored" },
  { value: "failed", label: "Failed" },
  { value: "all", label: "All" },
];

export default function CompareTab() {
  const { sheets } = useSheets();
  const compare = useCompare();
  const { groups, loading } = compare;
  const toast = useToast();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState("pending");
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<CompareSuggestion[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<{ open: boolean; group?: CompareGroup | null }>({ open: false });
  const [confirmDelete, setConfirmDelete] = useState<CompareGroup | null>(null);
  const [canWrite, setCanWrite] = useState(true);

  useEffect(() => {
    getMe().then((u) => setCanWrite(u?.sheetsWrite ?? false));
  }, []);

  // Default-select the first group once loaded.
  useEffect(() => {
    if (!selectedId && groups.length) setSelectedId(groups[0].id);
  }, [groups, selectedId]);

  const selected = useMemo(() => groups.find((g) => g.id === selectedId) ?? null, [groups, selectedId]);

  // Load the selected group's suggestions. `recompute` re-diffs on the server
  // first (used when opening a comparison) so results appear without "Run now";
  // filter/search changes just refetch.
  const loadSuggestions = useCallback(
    async (recompute = false) => {
      if (!selectedId) {
        setSuggestions([]);
        return;
      }
      try {
        if (recompute) await compare.runGroup(selectedId).catch(() => {});
        setSuggestions(await fetchSuggestions(selectedId, status, q));
        setChecked(new Set());
      } catch {
        setSuggestions([]);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedId, status, q]
  );

  // Recompute + show whenever a different comparison is opened.
  useEffect(() => {
    if (selectedId) loadSuggestions(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Cheap refetch when only the status filter or search text changes.
  useEffect(() => {
    loadSuggestions(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, q]);

  // Live: a realtime change (e.g. the master sheet polled) refreshes the list;
  // a slow interval is the fallback when the realtime worker isn't configured.
  useEffect(() => {
    const h = () => loadSuggestions(false);
    window.addEventListener(REALTIME_EVENT, h);
    const t = setInterval(() => loadSuggestions(false), 30_000);
    return () => {
      window.removeEventListener(REALTIME_EVENT, h);
      clearInterval(t);
    };
  }, [loadSuggestions]);

  const refreshAll = async () => {
    await compare.refetch();
    await loadSuggestions(false);
  };

  const pendingIds = suggestions.filter((s) => s.status === "pending").map((s) => s.id);
  const allChecked = pendingIds.length > 0 && pendingIds.every((id) => checked.has(id));

  const toggleCheck = (id: string) =>
    setChecked((c) => {
      const next = new Set(c);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleAll = () =>
    setChecked(allChecked ? new Set() : new Set(pendingIds));

  const doAccept = async (ids: string[]) => {
    if (!canWrite) return toast.error("Reconnect Google to apply changes");
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const r = await compare.accept(ids);
      toast.success(`Applied ${r.applied}${r.failed ? `, ${r.failed} failed` : ""}`);
      await refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t apply");
    } finally {
      setBusy(false);
    }
  };

  const doAcceptAll = async () => {
    if (!selected) return;
    if (!canWrite) return toast.error("Reconnect Google to apply changes");
    setBusy(true);
    try {
      const r = await compare.acceptAll(selected.id, selected.conflictCount > 0);
      toast.success(`Applied ${r.applied}${r.failed ? `, ${r.failed} failed` : ""}`);
      await refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t apply");
    } finally {
      setBusy(false);
    }
  };

  const doIgnore = async (ids: string[]) => {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      await compare.ignore(ids);
      toast.success(`Ignored ${ids.length}`);
      await refreshAll();
    } catch {
      toast.error("Couldn’t ignore");
    } finally {
      setBusy(false);
    }
  };

  const doRun = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      setSuggestions(await compare.runGroup(selected.id));
      await compare.refetch();
      toast.success("Re-checked");
    } catch {
      toast.error("Couldn’t re-check");
    } finally {
      setBusy(false);
    }
  };


  return (
    <div className="animate-fade-up space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900">Compare</h1>
          <p className="mt-1 text-sm text-ink-500">
            Keep sheets in sync — the master’s values are <span className="font-medium text-ink-700">suggested</span>,
            you decide what to apply.
          </p>
        </div>
        <button
          onClick={() => setModal({ open: true })}
          disabled={sheets.length < 2}
          className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3.5 py-2 text-sm font-semibold text-background shadow-xs transition-all hover:bg-foreground/85 active:scale-[0.97] disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> New comparison
        </button>
      </div>

      {!canWrite && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Applying changes needs write access to your sheets.
          </span>
          <a href={`${API_BASE}/auth/google`} className="font-semibold underline underline-offset-2 hover:text-amber-950">
            Reconnect Google
          </a>
        </div>
      )}

      {!loading && groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface px-6 py-16 text-center">
          <GitCompareArrows className="mx-auto h-8 w-8 text-ink-300" />
          <p className="mt-3 font-semibold text-ink-700">No comparisons yet</p>
          <p className="mt-1 text-sm text-ink-400">
            {sheets.length < 2 ? "Track at least two sheets to compare them." : "Create one to start syncing values across sheets."}
          </p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          {/* Groups */}
          <div className="space-y-2">
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => setSelectedId(g.id)}
                className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                  g.id === selectedId ? "border-teal bg-teal-soft" : "border-line bg-surface hover:border-ink-300"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold text-ink-900">{g.name}</span>
                  {g.pendingCount > 0 && (
                    <span className="shrink-0 rounded-full bg-teal px-2 py-0.5 font-mono text-[11px] font-bold text-primary-foreground">
                      {g.pendingCount}
                    </span>
                  )}
                </div>
                <div className="mt-1 truncate text-xs text-ink-400">
                  {g.master.label} → {g.targets.length} sheet{g.targets.length !== 1 ? "s" : ""}
                </div>
                {g.conflictCount > 0 && (
                  <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-amber-600">
                    <AlertTriangle className="h-3 w-3" /> {g.conflictCount} conflict{g.conflictCount !== 1 ? "s" : ""}
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Suggestions */}
          {selected && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-1">
                  {STATUS_TABS.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => setStatus(t.value)}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                        status === t.value ? "border-foreground bg-foreground text-background" : "border-line bg-surface text-ink-500 hover:text-ink-900"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Filter…"
                  className="ml-auto w-36 rounded-full border border-line bg-surface px-3 py-1.5 text-xs outline-hidden focus:border-teal focus:ring-4 focus:ring-teal/10"
                />
                <button onClick={doRun} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-700 transition-colors hover:text-ink-900 disabled:opacity-50">
                  <Play className="h-3 w-3" /> Run now
                </button>
                <button
                  onClick={() => setModal({ open: true, group: selected })}
                  className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-700 transition-colors hover:text-ink-900"
                >
                  <Pencil className="h-3 w-3" /> Edit
                </button>
                <button
                  onClick={() => setConfirmDelete(selected)}
                  className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink-500 transition-colors hover:border-coral/50 hover:text-coral-600"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>

              {/* Bulk bar */}
              {status === "pending" && pendingIds.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2">
                  <label className="flex items-center gap-2 text-xs font-medium text-ink-600">
                    <input type="checkbox" checked={allChecked} onChange={toggleAll} /> Select all
                  </label>
                  <div className="ml-auto flex gap-2">
                    <button onClick={() => doIgnore([...checked])} disabled={busy || checked.size === 0} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-600 transition-colors hover:text-ink-900 disabled:opacity-40">
                      Ignore ({checked.size})
                    </button>
                    <button onClick={() => doAccept([...checked])} disabled={busy || checked.size === 0} className="rounded-lg bg-teal px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-teal-600 disabled:opacity-40">
                      Accept ({checked.size})
                    </button>
                    <button onClick={doAcceptAll} disabled={busy} className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background transition-colors hover:bg-foreground/85 disabled:opacity-40">
                      Accept all
                    </button>
                  </div>
                </div>
              )}

              {suggestions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-line bg-surface px-6 py-12 text-center text-sm text-ink-400">
                  {status === "pending" ? "Nothing to sync — every compared value matches." : "No suggestions here."}
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line bg-secondary/40 text-left font-mono text-[11px] uppercase tracking-wide text-ink-400">
                        {status === "pending" && <th className="w-8 px-3 py-2"></th>}
                        <th className="px-3 py-2">Target</th>
                        <th className="px-3 py-2">Key</th>
                        <th className="px-3 py-2">Column</th>
                        <th className="px-3 py-2">Change</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {suggestions.map((s) => (
                        <tr key={s.id} className={s.conflict ? "bg-amber-50/60" : ""}>
                          {status === "pending" && (
                            <td className="px-3 py-2">
                              <input type="checkbox" checked={checked.has(s.id)} onChange={() => toggleCheck(s.id)} />
                            </td>
                          )}
                          <td className="px-3 py-2 text-ink-700">{s.target.label}</td>
                          <td className="px-3 py-2 font-mono text-xs text-ink-500">{s.keyValue}</td>
                          <td className="px-3 py-2 font-mono text-xs text-ink-500">{s.column}</td>
                          <td className="px-3 py-2">
                            <span className="font-mono text-xs text-coral-600 line-through">{s.targetValue || "∅"}</span>
                            <span className="mx-1.5 text-ink-300">→</span>
                            <span className="font-mono text-xs font-semibold text-teal-600">{s.masterValue || "∅"}</span>
                            {s.conflict && (
                              <span className="ml-2 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                                <AlertTriangle className="h-3 w-3" /> conflict
                              </span>
                            )}
                            {s.status === "failed" && s.error && (
                              <span className="ml-2 text-[10px] text-coral-600">{s.error}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {s.status === "pending" ? (
                              <div className="flex justify-end gap-1">
                                <button onClick={() => doAccept([s.id])} disabled={busy} title="Accept" className="rounded p-1 text-ink-400 transition-colors hover:text-teal-600 disabled:opacity-40">
                                  <Check className="h-4 w-4" />
                                </button>
                                <button onClick={() => doIgnore([s.id])} disabled={busy} title="Ignore" className="rounded p-1 text-ink-400 transition-colors hover:text-coral-600 disabled:opacity-40">
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            ) : (
                              <StatusPill status={s.status} />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {modal.open && (
        <ComparisonModal
          sheets={sheets}
          group={modal.group}
          onClose={() => setModal({ open: false })}
          onSave={async (g) => {
            if (modal.group) await compare.updateGroup(modal.group.id, g);
            else {
              const created = await compare.createGroup(g);
              setSelectedId(created.id);
            }
            await refreshAll();
            toast.success(modal.group ? "Comparison saved" : "Comparison created");
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete comparison?"
          message={`“${confirmDelete.name}” and its suggestions will be removed. Sheets are not affected.`}
          confirmLabel="Delete"
          danger
          onClose={() => setConfirmDelete(null)}
          onConfirm={async () => {
            await compare.deleteGroup(confirmDelete.id);
            setConfirmDelete(null);
            if (selectedId === confirmDelete.id) setSelectedId(null);
            await compare.refetch();
            toast.success("Deleted");
          }}
        />
      )}
    </div>
  );
}

function StatusPill({ status }: { status: SuggestionStatus }) {
  const map: Record<SuggestionStatus, string> = {
    pending: "bg-secondary text-ink-500",
    applied: "bg-teal-soft text-teal-600",
    ignored: "bg-secondary text-ink-400",
    failed: "bg-coral-soft text-coral-600",
  };
  return <span className={`rounded px-2 py-0.5 font-mono text-[11px] font-semibold ${map[status]}`}>{status}</span>;
}
