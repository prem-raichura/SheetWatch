import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useChanges } from "../hooks/useChanges";
import { markSeen } from "../lib/lastSeen";
import { usePrefs } from "../providers/PrefsProvider";
import { formatTimeAgo } from "../lib/format";
import { Rows3, Table2 } from "lucide-react";
import PulseDot from "../components/PulseDot";
import { SkeletonRows } from "../components/Skeleton";
import ChangeContext from "../components/ChangeContext";
import BlurFade from "../components/magic/BlurFade";
import ViewToggle from "../components/ViewToggle";

import { API_BASE } from "../lib/api";

type TrackFilter = "tracked" | "untracked";

export default function ActivityTab() {
  const { prefs, update } = usePrefs();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const { changes, loading } = useChanges(query);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [gridOpen, setGridOpen] = useState<Record<string, boolean>>({});
  const [trackFilter, setTrackFilter] = useState<TrackFilter>("tracked");

  const untrackedCount = changes.filter((c) => c.sheet.archivedAt).length;
  const visible = changes.filter((c) =>
    trackFilter === "tracked" ? !c.sheet.archivedAt : !!c.sheet.archivedAt
  );

  const chip = (key: TrackFilter, label: string, count: number) => (
    <button
      key={key}
      onClick={() => setTrackFilter(key)}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
        trackFilter === key
          ? "border-foreground bg-foreground text-background"
          : "border-line bg-surface text-ink-500 hover:text-ink-900"
      }`}
    >
      {label}
      <span className={trackFilter === key ? "text-background/60" : "text-ink-300"}>{count}</span>
    </button>
  );

  // Debounce typed search before hitting the API.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Viewing this tab clears the unread badge — once data has loaded, not on
  // every subsequent poll/realtime refresh of `changes`.
  useEffect(() => {
    if (!loading) markSeen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  return (
    <div className="animate-fade-up space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900">Activity</h1>
          <p className="mt-1 text-sm text-ink-500">
            Every change we caught. Click one to see the exact cells.
          </p>
        </div>
        <a
          href={`${API_BASE}/api/changes/export.csv`}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 font-mono text-[11px] font-medium text-ink-700 shadow-xs transition-all hover:border-teal/40 hover:text-teal-600 active:scale-[0.97]"
        >
          ↓ Export CSV
        </a>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search changes — sheet, cell, value…"
        aria-label="Search changes"
        className="w-full max-w-md rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink-900 shadow-xs placeholder:text-ink-300 focus:border-teal focus:outline-hidden focus:ring-4 focus:ring-teal/10"
      />

      <div className="flex flex-wrap items-center gap-2">
        {chip("tracked", "Tracked", changes.length - untrackedCount)}
        {chip("untracked", "Untracked", untrackedCount)}
        <div className="ml-auto">
          <ViewToggle
            value={prefs.views.activity}
            onChange={(v) => update({ views: { activity: v } })}
            options={[
              { value: "timeline", icon: Rows3, label: "Timeline" },
              { value: "table", icon: Table2, label: "Table" },
            ]}
          />
        </div>
      </div>

      {loading ? (
        <SkeletonRows count={5} />
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface px-6 py-14 text-center">
          <p className="text-sm font-medium text-ink-700">
            {query
              ? `No changes match “${query}”`
              : trackFilter === "untracked"
                ? "No history from untracked sheets"
                : "No changes yet"}
          </p>
          <p className="mt-1 text-sm text-ink-400">
            {query
              ? "Try a different sheet name, cell, or value."
              : "When a tracked sheet changes, it shows up here."}
          </p>
        </div>
      ) : prefs.views.activity === "table" ? (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-card">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line">
                <th className="w-4 px-3 py-2" />
                <th className="px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                  Sheet
                </th>
                <th className="px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                  Summary
                </th>
                <th className="px-3 py-2 text-right font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                  When
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => {
                const isOpen = open[c.id];
                return (
                  <>
                    <tr
                      key={c.id}
                      onClick={() => toggle(c.id)}
                      className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-paper/60"
                    >
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-block text-ink-300 transition-transform ${isOpen ? "rotate-90" : ""}`}
                        >
                          ›
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-1.5">
                          <span className="max-w-[14rem] truncate font-display text-sm font-semibold text-ink-900">
                            {c.sheet.label}
                          </span>
                          {c.sheet.archivedAt && (
                            <span className="shrink-0 rounded bg-paper px-1 font-mono text-[9px] uppercase text-ink-400">
                              untracked
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="max-w-0 px-3 py-2.5">
                        <span className="block truncate font-mono text-xs text-ink-500">
                          {c.summary}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-[11px] text-ink-400">
                        {formatTimeAgo(c.createdAt, prefs.time)}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-line bg-paper/40">
                        <td colSpan={4} className="px-3 py-2">
                          <div className="divide-y divide-line">
                            {c.details.slice(0, 15).map((d, di) => (
                              <div
                                key={di}
                                className="flex items-center gap-3 px-1 py-1.5 font-mono text-xs"
                              >
                                <span className="shrink-0 rounded bg-card px-1.5 py-0.5 text-[10px] text-ink-400">
                                  {d.cell}
                                </span>
                                <span className="truncate text-coral-600 line-through">
                                  {d.before || "∅"}
                                </span>
                                <span className="text-ink-300">→</span>
                                <span className="truncate text-teal-600">{d.after || "∅"}</span>
                              </div>
                            ))}
                            {c.details.length > 15 && (
                              <Link
                                to={`/history/${c.sheetId}`}
                                className="block px-1 py-1.5 font-mono text-[11px] text-teal-600 hover:underline"
                              >
                                +{c.details.length - 15} more · open history →
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <ol className="relative space-y-2 before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-px before:bg-line">
          {visible.map((c, i) => {
            const isOpen = open[c.id];
            return (
              <li key={c.id} className="relative">
              <BlurFade delay={Math.min(i, 10) * 0.03} className="relative flex gap-4 pl-6">
                <span className="absolute left-0 top-3.5">
                  <PulseDot tone="alert" />
                </span>
                <div className="flex-1 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                  <button
                    onClick={() => toggle(c.id)}
                    aria-expanded={!!isOpen}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-paper/60"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-display text-sm font-semibold text-ink-900">
                          {c.sheet.label}
                        </span>
                        {c.sheet.archivedAt && (
                          <span className="shrink-0 rounded bg-paper px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ink-400">
                            untracked
                          </span>
                        )}
                      </span>
                      <span className="font-mono text-xs text-ink-500">{c.summary}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-[11px] text-ink-400">
                        {formatTimeAgo(c.createdAt, prefs.time)}
                      </span>
                      <span
                        className={`text-ink-300 transition-transform ${
                          isOpen ? "rotate-90" : ""
                        }`}
                      >
                        ›
                      </span>
                    </span>
                  </button>

                  {isOpen && (
                    <div className="divide-y divide-line border-t border-line">
                      {c.details.slice(0, 15).map((d, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-3 px-4 py-2 font-mono text-xs"
                        >
                          <span className="shrink-0 rounded bg-paper px-1.5 py-0.5 text-[10px] text-ink-400">
                            {d.cell}
                          </span>
                          <span className="truncate text-coral-600 line-through">
                            {d.before || "∅"}
                          </span>
                          <span className="text-ink-300">→</span>
                          <span className="truncate text-teal-600">{d.after || "∅"}</span>
                        </div>
                      ))}
                      {c.details.length > 15 && (
                        <div className="px-4 py-2">
                          <Link
                            to={`/history/${c.sheetId}`}
                            className="font-mono text-[11px] text-teal-600 hover:underline"
                          >
                            +{c.details.length - 15} more · open history →
                          </Link>
                        </div>
                      )}
                      <div className="px-4 py-2">
                        <button
                          onClick={() => setGridOpen((o) => ({ ...o, [c.id]: !o[c.id] }))}
                          className="font-mono text-[11px] text-ink-400 transition-colors hover:text-teal-600"
                        >
                          {gridOpen[c.id] ? "▦ hide grid" : "▦ view in grid"}
                        </button>
                      </div>
                      {gridOpen[c.id] && <ChangeContext sheetId={c.sheetId} changeId={c.id} />}
                    </div>
                  )}
                </div>
              </BlurFade>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
