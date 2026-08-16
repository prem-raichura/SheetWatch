import { useState } from "react";
import { LayoutGrid, List, Search } from "lucide-react";
import { useAvailableSheets } from "../hooks/useAvailableSheets";
import AvailableSheets from "../components/AvailableSheets";
import ViewToggle from "../components/ViewToggle";
import Spinner from "../components/Spinner";
import { api } from "../lib/api";
import type { AvailableSheet, Sheet } from "../types";
import { usePrefs } from "../providers/PrefsProvider";

// One box does both jobs: plain words filter the list, a Google Sheets link (or
// a bare spreadsheet id) is a sheet to look up. Returns the spreadsheet id.
function sheetIdFromLink(value: string): string | null {
  const s = value.trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  return /^[a-zA-Z0-9-_]{30,}$/.test(s) ? s : null;
}

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
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [owner, setOwner] = useState<OwnerFilter>("all");
  const [sort, setSort] = useState<Sort>("edited_desc");
  const [resolving, setResolving] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  // The pasted-link result. Only the id is kept: the card is read back out of
  // the live list when it's there, so tracking it updates the card too.
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const [linkedStub, setLinkedStub] = useState<AvailableSheet | null>(null);

  const trackedCount = available.filter((s) => s.tracked).length;
  const mineCount = available.filter((s) => s.ownedByMe).length;
  const linkId = sheetIdFromLink(query);
  // A pasted link isn't a name, so it must not filter the list to nothing.
  const q = linkId ? "" : query.trim().toLowerCase();

  const linkedSheet = linkedId
    ? (available.find((s) => s.spreadsheetId === linkedId) ?? linkedStub)
    : null;

  const clearLinked = () => {
    setLinkedId(null);
    setLinkedStub(null);
  };

  // A sheet reached only by link may never appear in the Drive list, so its
  // card can't read its own tracked state from there — ask the tracked list.
  const syncLinkedStub = async (id: string) => {
    try {
      const tracked = await api.get<Sheet[]>("/api/sheets");
      const hit = tracked.find((s) => s.spreadsheetId === id);
      setLinkedStub((prev) =>
        prev && prev.spreadsheetId === id
          ? { ...prev, tracked: Boolean(hit), sheetId: hit?.id ?? null }
          : prev
      );
    } catch {
      /* leave the card as it is */
    }
  };

  // Searching a link looks the sheet up and shows it as a card — tracking is a
  // separate, deliberate click on that card.
  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkId || resolving) return; // plain text already filters as you type
    setResolving(true);
    setLinkError(null);
    try {
      const known = available.find((s) => s.spreadsheetId === linkId);
      if (known) {
        setLinkedStub(null);
      } else {
        // Shared by link and not in Drive: ask the server for its title.
        const found = await api.get<{ spreadsheetId: string; name: string }>(
          `/api/compare/resolve?url=${encodeURIComponent(query.trim())}`
        );
        setLinkedStub({
          spreadsheetId: found.spreadsheetId,
          name: found.name,
          ownedByMe: false,
          modifiedTime: "",
          tracked: false,
          sheetId: null,
        });
      }
      setLinkedId(linkId);
      setQuery("");
    } catch (err) {
      clearLinked();
      setLinkError(err instanceof Error ? err.message : "Couldn’t open that sheet");
    } finally {
      setResolving(false);
    }
  };

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
          <form onSubmit={search} className="flex flex-col gap-2 sm:flex-row">
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLinkError(null);
              }}
              placeholder="Search your sheets, or paste a Google Sheets link…"
              aria-label="Search your sheets or paste a Google Sheets link"
              className={`flex-1 rounded-lg border bg-surface px-3.5 py-2.5 text-sm shadow-card outline-hidden transition-shadow focus:ring-4 focus:ring-teal/10 ${
                linkId ? "border-teal font-mono" : "border-line focus:border-teal"
              }`}
            />
            <button
              type="submit"
              disabled={resolving || !query.trim()}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink-700 shadow-xs transition-all hover:border-teal/40 hover:text-teal-600 active:scale-[0.97] disabled:opacity-50"
            >
              {resolving ? <Spinner /> : <Search className="h-4 w-4" />}
              Search
            </button>
          </form>

          {linkId && !linkError && (
            <p className="font-mono text-xs text-teal-600">
              Google Sheets link — press Search to look it up.
            </p>
          )}
          {linkError && <p className="font-mono text-xs text-coral-600">{linkError}</p>}

          {linkedSheet && (
            <div className="space-y-2 rounded-2xl border border-teal/30 bg-teal-soft/40 p-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-wider text-teal-600">
                  found from your link
                </span>
                <button
                  onClick={clearLinked}
                  className="rounded-md px-2 py-1 font-mono text-[11px] text-ink-400 transition-colors hover:bg-paper hover:text-ink-700"
                >
                  ✕ dismiss
                </button>
              </div>
              <AvailableSheets
                available={[linkedSheet]}
                loading={false}
                error={null}
                view={prefs.views.sheets}
                onRefresh={refetch}
                onChanged={() => {
                  refetch();
                  if (linkedId) syncLinkedStub(linkedId);
                }}
                label={linkedSheet.tracked ? "already tracked" : "not tracked yet"}
              />
            </div>
          )}

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
        </div>
      )}

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
    </div>
  );
}
