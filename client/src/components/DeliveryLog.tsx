import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  Clock,
  Mail,
  RefreshCw,
  Send,
  Webhook as WebhookIcon,
  XCircle,
} from "lucide-react";
import { api } from "@/lib/api";
import { NotificationLogEntry } from "@/types";
import { usePrefs } from "@/providers/PrefsProvider";
import { formatTimeAgo } from "@/lib/format";
import { useToast } from "./Toast";

const CHANNEL_ICON = {
  push: Bell,
  email: Mail,
  webhook: WebhookIcon,
  telegram: Send,
} as const;

const STATUS_STYLE: Record<NotificationLogEntry["status"], string> = {
  sent: "bg-teal-soft text-teal-600",
  failed: "bg-coral-soft text-coral-600",
  queued: "bg-secondary text-ink-500",
  suppressed: "bg-secondary text-ink-400",
};

const FILTERS = ["all", "sent", "failed", "queued"] as const;

// Where every notification went and what happened to it.
export default function DeliveryLog() {
  const { prefs } = usePrefs();
  const toast = useToast();
  const [items, setItems] = useState<NotificationLogEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);

  const load = useCallback(
    (append = false, after: string | null = null) => {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("status", filter);
      if (after) params.set("cursor", after);
      api
        .get<{ items: NotificationLogEntry[]; nextCursor: string | null }>(
          `/api/notifications?${params.toString()}`
        )
        .then((r) => {
          setItems((prev) => (append ? [...prev, ...r.items] : r.items));
          setCursor(r.nextCursor);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    },
    [filter]
  );

  useEffect(() => {
    setLoading(true);
    load();
    const t = setInterval(() => load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const retry = async (id: string) => {
    setRetrying(id);
    try {
      await api.post(`/api/notifications/${id}/retry`);
      toast.success("Queued for retry");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetrying(null);
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-sm font-bold text-ink-900">Delivery log</h2>
          <p className="mt-0.5 text-xs text-ink-400">
            Every push, email, webhook and Telegram message — sent, queued or failed.
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-line bg-paper p-0.5" role="group">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold capitalize transition-colors ${
                filter === f ? "bg-card text-ink-900 shadow-xs" : "text-ink-500 hover:text-ink-900"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 divide-y divide-line">
        {loading ? (
          <p className="py-4 font-mono text-xs text-ink-300">loading…</p>
        ) : items.length === 0 ? (
          <p className="py-4 font-mono text-xs text-ink-300">
            nothing here yet — deliveries appear as changes fire
          </p>
        ) : (
          items.map((n) => {
            const Icon = CHANNEL_ICON[n.channel] ?? Bell;
            return (
              <div key={n.id} className="flex items-center gap-3 py-2.5">
                <Icon className="h-4 w-4 shrink-0 text-ink-400" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-ink-900">{n.title}</span>
                    <span className="shrink-0 truncate font-mono text-[10px] text-ink-400">
                      → {n.target}
                    </span>
                  </div>
                  {n.error ? (
                    <div className="mt-0.5 flex items-center gap-1 truncate font-mono text-[11px] text-coral-600">
                      <XCircle className="h-3 w-3 shrink-0" /> {n.error}
                    </div>
                  ) : (
                    <div className="truncate font-mono text-[11px] text-ink-400">{n.body}</div>
                  )}
                </div>
                {n.status === "queued" && n.deliverAfter && (
                  <span className="hidden items-center gap-1 font-mono text-[10px] text-ink-400 sm:flex">
                    <Clock className="h-3 w-3" />
                    {new Date(n.deliverAfter).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: prefs.time.hour12,
                    })}
                  </span>
                )}
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLE[n.status]}`}
                >
                  {n.status}
                </span>
                <span className="hidden shrink-0 font-mono text-[10px] text-ink-300 sm:block">
                  {formatTimeAgo(n.createdAt, prefs.time)}
                </span>
                {n.status === "failed" && (n.channel === "push" || n.channel === "email") && (
                  <button
                    onClick={() => retry(n.id)}
                    disabled={retrying === n.id}
                    aria-label="Retry delivery"
                    className="shrink-0 rounded-lg border border-line bg-surface p-1.5 text-ink-400 shadow-xs transition-all hover:border-teal/40 hover:text-teal-600 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${retrying === n.id ? "animate-spin" : ""}`} />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {cursor && (
        <button
          onClick={() => load(true, cursor)}
          className="mt-3 w-full rounded-lg border border-line bg-paper py-2 font-mono text-[11px] text-ink-500 transition-colors hover:text-ink-900"
        >
          load more
        </button>
      )}
    </section>
  );
}
