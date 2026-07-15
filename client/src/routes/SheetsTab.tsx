import { useState } from "react";
import { LayoutGrid, List } from "lucide-react";
import { useAvailableSheets } from "../hooks/useAvailableSheets";
import AvailableSheets from "../components/AvailableSheets";
import AddSheetBox from "../components/AddSheetBox";
import DriveBin from "../components/DriveBin";
import ViewToggle from "../components/ViewToggle";
import { usePrefs } from "../providers/PrefsProvider";

type Filter = "all" | "tracked" | "untracked";
type OwnerFilter = "all" | "mine" | "shared";
type Sort = "edited_desc" | "edited_asc" | "name_asc" | "name_desc";

const SORTS: { value: Sort; label: string }[] = [
  { value: "edited_desc", label: "Last edited" },
  { value: "edited_asc", label: "Oldest edited" },
  { value: "name_asc", label: "Name A → Z" },
  { value: "name_desc", label: "Name Z → A" },
];

export default function SheetsTab() {
  const { available, loading, error, refetch } = useAvailableSheets();
  const { prefs, update } = usePrefs();
  const [showAddByUrl, setShowAddByUrl] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [owner, setOwner] = useState<OwnerFilter>("all");
  const [sort, setSort] = useState<Sort>("edited_desc");
  const [binOpen, setBinOpen] = useState(false);

  const trackedCount = available.filter((s) => s.tracked).length;
  const mineCount = available.filter((s) => s.ownedByMe).length;
  const q = query.trim().toLowerCase();

  const filtered = available
    .filter((s) => {
      if (q && !s.name.toLowerCase().includes(q)) return false;
      if (filter === "tracked" && !s.tracked) return false;
      if (filter === "untracked" && s.tracked) return false;
      if (owner === "mine" && !s.ownedByMe) return false;
      if (owner === "shared" && s.ownedByMe) return false;
      return true;
    })
    .sort((a, b) => {
      switch (sort) {
        case "name_asc":
          return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        case "name_desc":
          return b.name.localeCompare(a.name, undefined, { sensitivity: "base" });
        case "edited_asc":
          return (a.modifiedTime ?? "").localeCompare(b.modifiedTime ?? "");
        default:
          return (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? "");
      }
    });

  const chip = (active: boolean, onClick: () => void, label: string, count: number) => (
    <button
      key={label}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? "border-foreground bg-foreground text-background"
          : "border-line bg-surface text-ink-500 hover:text-ink-900"
      }`}
    >
      {label}
      <span className={active ? "text-background/60" : "text-ink-300"}>{count}</span>
    </button>
  );

  return (
    <div className="animate-fade-up space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900">
            Your sheets
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Everything in your Google Drive. Flip{" "}
            <span className="font-medium text-ink-700">Track</span> to watch a sheet
            for changes.
          </p>
        </div>
        {!loading && !error && (
          <span className="font-mono text-xs text-ink-400">
            {trackedCount} / {available.length} tracked
          </span>
        )}
      </div>

      {!loading && !error && (
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your sheets…"
              aria-label="Search your sheets"
              className="flex-1 rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm shadow-card outline-hidden transition-shadow focus:border-teal focus:ring-4 focus:ring-teal/10"
            />
            <button
              onClick={() => setShowAddByUrl((v) => !v)}
              aria-expanded={showAddByUrl}
              className={`shrink-0 rounded-lg border px-4 py-2.5 text-sm font-semibold shadow-xs transition-all active:scale-[0.97] ${
                showAddByUrl
                  ? "border-foreground bg-foreground text-background"
                  : "border-line bg-surface text-ink-700 hover:border-teal/40 hover:text-teal-600"
              }`}
            >
              🔗 Add by URL
            </button>
            <button
              onClick={() => setBinOpen((v) => !v)}
              aria-expanded={binOpen}
              className={`shrink-0 rounded-lg border px-4 py-2.5 text-sm font-semibold shadow-xs transition-all active:scale-[0.97] ${
                binOpen
                  ? "border-foreground bg-foreground text-background"
                  : "border-line bg-surface text-ink-700 hover:border-coral/50 hover:text-coral-600"
              }`}
            >
              🗑 Bin
            </button>
          </div>

          {showAddByUrl && (
            <AddSheetBox
              onAdded={() => {
                setShowAddByUrl(false);
                refetch();
              }}
            />
          )}

          {!binOpen && (
          <div className="flex flex-wrap items-center gap-2">
            {chip(filter === "all", () => setFilter("all"), "All", available.length)}
            {chip(filter === "tracked", () => setFilter("tracked"), "Tracked", trackedCount)}
            {chip(
              filter === "untracked",
              () => setFilter("untracked"),
              "Not tracked",
              available.length - trackedCount
            )}

            <span className="mx-1 h-4 w-px bg-line" aria-hidden />

            {chip(owner === "all", () => setOwner("all"), "Anyone", available.length)}
            {chip(owner === "mine", () => setOwner("mine"), "Owned by me", mineCount)}
            {chip(
              owner === "shared",
              () => setOwner("shared"),
              "Shared with me",
              available.length - mineCount
            )}

            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              aria-label="Sort sheets"
              className="ml-auto rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-500 outline-hidden transition-colors hover:text-ink-900 focus:border-teal"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  ↕ {s.label}
                </option>
              ))}
            </select>
            <ViewToggle
              value={prefs.views.sheets}
              onChange={(v) => update({ views: { sheets: v } })}
              options={[
                { value: "list", icon: List, label: "List" },
                { value: "cards", icon: LayoutGrid, label: "Cards" },
              ]}
            />
          </div>
          )}
        </div>
      )}

      {binOpen ? (
        <DriveBin onChanged={refetch} />
      ) : (
      <AvailableSheets
        available={filtered}
        loading={loading}
        error={error}
        view={prefs.views.sheets}
        onRefresh={refetch}
        onChanged={refetch}
        emptyHint={
          available.length > 0
            ? q
              ? `Nothing matches “${query.trim()}” with these filters.`
              : filter === "tracked"
                ? "No tracked sheets match these filters."
                : filter === "untracked"
                  ? "Everything here is already tracked 🎉"
                  : owner === "mine"
                    ? "No sheets owned by you."
                    : "No sheets shared with you."
            : undefined
        }
      />
      )}
    </div>
  );
}
