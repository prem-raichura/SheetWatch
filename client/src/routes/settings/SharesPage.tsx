import { useCallback, useEffect, useState } from "react";
import { Copy, Eye, Link2, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { KpiWidget } from "@/types";
import { useToast } from "@/components/Toast";
import Spinner from "@/components/Spinner";
import ConfirmModal from "@/components/ConfirmModal";

interface ShareLink {
  id: string;
  token: string;
  title: string | null;
  widgetIds: string[];
  revokedAt: string | null;
  viewCount: number;
  createdAt: string;
}

const field =
  "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-hidden transition-shadow focus:border-teal focus:ring-4 focus:ring-teal/10";

// Public, read-only KPI boards behind unguessable revocable links.
export default function SharesPage() {
  const toast = useToast();
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [widgets, setWidgets] = useState<KpiWidget[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ShareLink | null>(null);

  const refetch = useCallback(() => {
    api
      .get<ShareLink[]>("/api/shares")
      .then(setLinks)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refetch();
    api.get<KpiWidget[]>("/api/kpis").then(setWidgets).catch(() => {});
  }, [refetch]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const create = async () => {
    setCreating(true);
    try {
      await api.post("/api/shares", {
        title: title.trim() || undefined,
        widgetIds: [...selected],
      });
      setTitle("");
      setSelected(new Set());
      refetch();
      toast.success("Share link created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t create link");
    } finally {
      setCreating(false);
    }
  };

  const copy = (token: string) => {
    navigator.clipboard
      .writeText(`${window.location.origin}/share/${token}`)
      .then(() => toast.success("Link copied"))
      .catch(() => toast.error("Couldn’t copy"));
  };

  const revoke = async (link: ShareLink) => {
    await api.delete(`/api/shares/${link.id}`);
    refetch();
    toast.success("Link revoked");
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <h2 className="font-display text-sm font-bold text-ink-900">Share a KPI board</h2>
        <p className="mt-0.5 text-xs text-ink-400">
          Anyone with the link sees a live, read-only board of the selected KPIs — no sign-in.
          Revoke any time.
        </p>
        <div className="mt-4 space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Board title (optional)"
            className={field}
          />
          <div className="flex flex-wrap gap-2">
            {widgets.length === 0 ? (
              <p className="font-mono text-xs text-ink-300">pin some KPI cells first</p>
            ) : (
              widgets.map((w) => (
                <button
                  key={w.id}
                  onClick={() => toggle(w.id)}
                  aria-pressed={selected.has(w.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    selected.has(w.id)
                      ? "border-teal/40 bg-teal-soft text-teal-600"
                      : "border-line text-ink-500 hover:text-ink-900"
                  }`}
                >
                  {w.label}
                </button>
              ))
            )}
          </div>
          <p className="font-mono text-[11px] text-ink-400">
            {selected.size === 0 ? "no selection = all KPIs" : `${selected.size} selected`}
          </p>
          <button
            onClick={create}
            disabled={creating || widgets.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-teal px-4 py-2 text-sm font-semibold text-primary-foreground shadow-xs transition-all hover:bg-teal-600 active:scale-[0.97] disabled:opacity-50"
          >
            {creating ? <Spinner /> : <Plus className="h-4 w-4" />} Create link
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <h2 className="font-display text-sm font-bold text-ink-900">Active links</h2>
        <div className="mt-3 divide-y divide-line">
          {loading ? (
            <p className="py-3 font-mono text-xs text-ink-300">loading…</p>
          ) : links.filter((l) => !l.revokedAt).length === 0 ? (
            <p className="py-3 font-mono text-xs text-ink-300">no active links</p>
          ) : (
            links
              .filter((l) => !l.revokedAt)
              .map((l) => (
                <div key={l.id} className="flex items-center gap-3 py-3">
                  <Link2 className="h-4 w-4 shrink-0 text-ink-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink-900">
                      {l.title || "KPI board"}
                    </div>
                    <div className="truncate font-mono text-[11px] text-ink-400">
                      /share/{l.token.slice(0, 10)}… ·{" "}
                      {l.widgetIds.length === 0 ? "all KPIs" : `${l.widgetIds.length} KPIs`}
                    </div>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-ink-400">
                    <Eye className="h-3 w-3" /> {l.viewCount}
                  </span>
                  <button
                    onClick={() => copy(l.token)}
                    aria-label="Copy link"
                    className="shrink-0 rounded-lg border border-line bg-surface p-2 text-ink-400 shadow-xs transition-all hover:border-teal/40 hover:text-teal-600"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setRevoking(l)}
                    aria-label="Revoke link"
                    className="shrink-0 rounded-lg border border-line bg-surface p-2 text-ink-400 shadow-xs transition-all hover:border-coral/50 hover:bg-coral-soft hover:text-coral-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))
          )}
        </div>
      </section>

      {revoking && (
        <ConfirmModal
          title="Revoke this link?"
          message={`“${revoking.title || "KPI board"}” stops working immediately for anyone who has it.`}
          confirmLabel="Revoke"
          danger
          onConfirm={() => revoke(revoking)}
          onClose={() => setRevoking(null)}
        />
      )}
    </div>
  );
}
