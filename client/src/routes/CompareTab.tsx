import { useCallback, useEffect, useMemo, useState } from "react";
import { GitCompareArrows, Plus, Play, AlertTriangle, Trash2, Pencil, ExternalLink, Check } from "lucide-react";
import { useCompare, fetchSuggestions } from "../hooks/useCompare";
import { API_BASE } from "../lib/api";
import ComparisonModal from "../components/compare/ComparisonModal";
import ComparisonList from "../components/compare/ComparisonList";
import SuggestionSheetGroup from "../components/compare/SuggestionSheetGroup";
import ConfirmModal from "../components/ConfirmModal";
import { SkeletonRows } from "../components/Skeleton";
import { useToast } from "../components/Toast";
import { getMe } from "../lib/auth";
import { REALTIME_EVENT } from "../providers/RealtimeProvider";
import type { CompareGroup, CompareSuggestion } from "../types";

type CountKey = keyof CompareGroup["statusCounts"];
const STATUS_TABS: { value: string; label: string; key?: CountKey }[] = [
  { value: "pending", label: "Pending", key: "pending" },
  { value: "applied", label: "Applied", key: "applied" },
  { value: "ignored", label: "Ignored", key: "ignored" },
  { value: "failed", label: "Failed", key: "failed" },
  { value: "all", label: "All" },
];

// Compact "time ago" for the auto-check caption.
function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
}

export default function CompareTab() {
  const compare = useCompare();
  const { groups, loading } = compare;
  const toast = useToast();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState("pending");
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<CompareSuggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<{ open: boolean; group?: CompareGroup | null }>({ open: false });
  const [confirmDelete, setConfirmDelete] = useState<CompareGroup | null>(null);
  const [canWrite, setCanWrite] = useState(true);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  useEffect(() => {
    getMe().then((u) => setCanWrite(u?.sheetsWrite ?? false));
  }, []);

  // Ticks every second so the "checked Xs ago" caption stays live.
  const [nowTs, setNowTs] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Default-select the first comparison once loaded.
  useEffect(() => {
    if (!selectedId && groups.length) setSelectedId(groups[0].id);
  }, [groups, selectedId]);

  const selected = useMemo(() => groups.find((g) => g.id === selectedId) ?? null, [groups, selectedId]);

  // Load the selected comparison's suggestions. `recompute` re-diffs on the
  // server first (used when opening) so results appear without "Run now".
  const loadSuggestions = useCallback(
    async (recompute = false, withSkeleton = false) => {
      if (!selectedId) {
        setSuggestions([]);
        return;
      }
      if (withSkeleton) setSuggestionsLoading(true);
      try {
        if (recompute) await compare.runGroup(selectedId).catch(() => {});
        setSuggestions(await fetchSuggestions(selectedId, status, q));
      } catch {
        setSuggestions([]);
      } finally {
        if (withSkeleton) setSuggestionsLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedId, status, q]
  );

  // Recompute + skeleton whenever a different comparison is opened.
  useEffect(() => {
    if (selectedId) loadSuggestions(true, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Cheap refetch when the status filter or search text changes.
  useEffect(() => {
    loadSuggestions(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, q]);

  // Live: a realtime change refreshes the list; a slow interval is the fallback.
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

  // Group the current suggestions by target sheet, preserving arrival order.
  const sheetGroups = useMemo(() => {
    const order: string[] = [];
    const byId = new Map<string, CompareSuggestion[]>();
    for (const s of suggestions) {
      if (!byId.has(s.target.id)) {
        byId.set(s.target.id, []);
        order.push(s.target.id);
      }
      byId.get(s.target.id)!.push(s);
    }
    return order.map((id) => ({
      id,
      label: byId.get(id)![0].target.label,
      spreadsheetId: selected?.targets.find((t) => t.id === id)?.spreadsheetId,
      items: byId.get(id)!,
    }));
  }, [suggestions, selected]);

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
    if (!selectedId) return;
    await loadSuggestions(true, true);
    await compare.refetch();
    toast.success("Re-checked");
  };

  const masterUrl = selected
    ? `https://docs.google.com/spreadsheets/d/${selected.master.spreadsheetId}`
    : "";

  const metaChip = "rounded-full bg-secondary px-2 py-0.5 font-mono text-[11px] text-ink-500";

  return (
    <div className="animate-fade-up space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900">Compare</h1>
          <p className="mt-1 text-sm text-ink-500">
            Keep sheets in sync — the master’s values are{" "}
            <span className="font-medium text-ink-700">suggested</span>, you decide what to apply.
          </p>
        </div>
        <button
          onClick={() => setModal({ open: true })}
          className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3.5 py-2 text-sm font-semibold text-background shadow-xs transition-all hover:bg-foreground/85 active:scale-[0.97]"
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
          <a
            href={`${API_BASE}/auth/google`}
            className="font-semibold underline underline-offset-2 hover:text-amber-950"
          >
            Reconnect Google
          </a>
        </div>
      )}

      {!loading && groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface px-6 py-16 text-center">
          <GitCompareArrows className="mx-auto h-8 w-8 text-ink-300" />
          <p className="mt-3 font-semibold text-ink-700">No comparisons yet</p>
          <p className="mt-1 text-sm text-ink-400">Create one to start syncing values across sheets.</p>
          <button
            onClick={() => setModal({ open: true })}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3.5 py-2 text-sm font-semibold text-background shadow-xs transition-all hover:bg-foreground/85 active:scale-[0.97]"
          >
            <Plus className="h-4 w-4" /> New comparison
          </button>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <ComparisonList groups={groups} selectedId={selectedId} onSelect={setSelectedId} />

          {selected && (
            <div className="min-w-0 space-y-4">
              {/* Summary header */}
              <div className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-display text-lg font-bold text-ink-900">{selected.name}</h2>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <a
                        href={masterUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open master in Google Sheets"
                        className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2 py-0.5 text-xs font-medium text-ink-700 transition-colors hover:border-teal/40 hover:text-teal-600"
                      >
                        <ExternalLink className="h-3 w-3" /> {selected.master.label}
                      </a>
                      <span className="text-ink-300">→</span>
                      <span className={metaChip}>
                        {selected.targets.length} target{selected.targets.length !== 1 ? "s" : ""}
                      </span>
                      <span className={metaChip}>key: {selected.keyColumn || "row position"}</span>
                      <span className={metaChip}>cols: {selected.compareColumns.join(", ")}</span>
                    </div>
                    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-400">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-teal" />
                      Auto-syncs every 2 min
                      {selected.lastCheckedAt
                        ? ` · checked ${ago(selected.lastCheckedAt, nowTs)}`
                        : " · not checked yet"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {selected.pendingCount > 0 && (
                      <button
                        onClick={doAcceptAll}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded-lg bg-teal px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-teal-600 disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" /> Accept all
                      </button>
                    )}
                    <button
                      onClick={doRun}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-700 transition-colors hover:text-ink-900 disabled:opacity-50"
                    >
                      <Play className="h-3.5 w-3.5" /> Run now
                    </button>
                    <button
                      onClick={() => setModal({ open: true, group: selected })}
                      className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-700 transition-colors hover:text-ink-900"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                    <button
                      onClick={() => setConfirmDelete(selected)}
                      aria-label="Delete comparison"
                      className="inline-flex items-center rounded-lg border border-line bg-surface px-2.5 py-1.5 text-ink-500 transition-colors hover:border-coral/50 hover:text-coral-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Status filter + search */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex flex-wrap gap-1 rounded-xl border border-line bg-paper p-1">
                  {STATUS_TABS.map((t) => {
                    const count = t.key
                      ? selected.statusCounts[t.key]
                      : Object.values(selected.statusCounts).reduce((a, b) => a + b, 0);
                    const activeTab = status === t.value;
                    return (
                      <button
                        key={t.value}
                        onClick={() => setStatus(t.value)}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                          activeTab ? "bg-foreground text-background shadow-xs" : "text-ink-500 hover:text-ink-900"
                        }`}
                      >
                        {t.label}
                        <span className={`font-mono text-[11px] ${activeTab ? "text-background/70" : "text-ink-400"}`}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Filter…"
                  className="ml-auto w-40 rounded-full border border-line bg-surface px-3 py-1.5 text-xs outline-hidden focus:border-teal focus:ring-4 focus:ring-teal/10"
                />
              </div>

              {/* Suggestions, grouped by target sheet */}
              {suggestionsLoading ? (
                <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
                  <SkeletonRows count={6} />
                </div>
              ) : sheetGroups.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-line bg-surface px-6 py-12 text-center text-sm text-ink-400">
                  {status === "pending"
                    ? "Nothing to sync — every compared value matches."
                    : "No suggestions here."}
                </div>
              ) : (
                <div className="scroll-slim max-h-[65vh] divide-y divide-line overflow-y-auto overflow-x-hidden rounded-2xl border border-line bg-surface shadow-card">
                  {sheetGroups.map((grp) => (
                    <SuggestionSheetGroup
                      key={grp.id}
                      label={grp.label}
                      spreadsheetId={grp.spreadsheetId}
                      suggestions={grp.items}
                      status={status}
                      busy={busy}
                      onAccept={doAccept}
                      onIgnore={doIgnore}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {modal.open && (
        <ComparisonModal
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
