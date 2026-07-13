import { useEffect, useState } from "react";
import { Plug, SendHorizonal, Trash2 } from "lucide-react";
import { Webhook, WebhookKind } from "@/types";
import { useWebhooks } from "@/hooks/useWebhooks";
import { api } from "@/lib/api";
import { useToast } from "@/components/Toast";
import Spinner from "@/components/Spinner";

const KIND_LABEL: Record<WebhookKind, string> = {
  slack: "Slack",
  discord: "Discord",
  generic: "Webhook",
  telegram: "Telegram",
};

const field =
  "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-hidden transition-shadow focus:border-teal focus:ring-4 focus:ring-teal/10";

export default function IntegrationsPage() {
  const { webhooks, loading, refetch, createWebhook, deleteWebhook, testWebhook } = useWebhooks();
  const toast = useToast();
  const [config, setConfig] = useState<{ telegramConfigured: boolean } | null>(null);
  const [kind, setKind] = useState<WebhookKind>("slack");

  useEffect(() => {
    api
      .get<{ telegramConfigured: boolean }>("/api/config")
      .then(setConfig)
      .catch(() => setConfig({ telegramConfigured: false }));
  }, []);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!url.trim()) {
      setError("Paste the webhook URL.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createWebhook(kind, url.trim(), label.trim() || KIND_LABEL[kind]);
      setUrl("");
      setLabel("");
      await refetch();
      toast.success("Webhook added");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t add webhook.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (w: Webhook) => {
    try {
      await deleteWebhook(w.id);
      await refetch();
      toast.success(`Deleted “${w.label}”`);
    } catch {
      toast.error("Delete failed");
    }
  };

  const test = async (w: Webhook) => {
    setTesting(w.id);
    try {
      await testWebhook(w.id);
      toast.success(`Test sent to “${w.label}”`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <h2 className="font-display text-sm font-bold text-ink-900">Add a webhook</h2>
        <p className="mt-0.5 text-xs text-ink-400">
          Send every matching change to Slack, Discord or any HTTPS endpoint. Attach webhooks to
          sheets from each sheet’s settings.
        </p>
        <div className="mt-4 space-y-3">
          <div className="flex gap-1 rounded-lg border border-line bg-paper p-0.5">
            {(Object.keys(KIND_LABEL) as WebhookKind[]).map((k) => {
              const disabled = k === "telegram" && config !== null && !config.telegramConfigured;
              return (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  disabled={disabled}
                  title={disabled ? "Set TELEGRAM_BOT_TOKEN in server/.env to enable" : undefined}
                  aria-pressed={kind === k}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${
                    kind === k ? "bg-card text-ink-900 shadow-xs" : "text-ink-500 hover:text-ink-900"
                  }`}
                >
                  {KIND_LABEL[k]}
                </button>
              );
            })}
          </div>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={
              kind === "slack"
                ? "https://hooks.slack.com/services/…"
                : kind === "discord"
                  ? "https://discord.com/api/webhooks/…"
                  : kind === "telegram"
                    ? "chat id, e.g. 123456789"
                    : "https://example.com/hook"
            }
            className={`${field} font-mono text-xs`}
          />
          {kind === "telegram" && (
            <p className="font-mono text-[11px] leading-relaxed text-ink-400">
              message your bot first, then get your chat id from{" "}
              <span className="text-ink-500">api.telegram.org/bot&lt;token&gt;/getUpdates</span>
            </p>
          )}
          <div className="flex gap-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (optional)"
              className={field}
            />
            <button
              onClick={add}
              disabled={saving}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-teal px-4 py-2 text-sm font-semibold text-primary-foreground shadow-xs transition-all hover:bg-teal-600 active:scale-[0.97] disabled:opacity-50"
            >
              {saving ? <Spinner /> : <Plug className="h-4 w-4" />} Add
            </button>
          </div>
          {error && <p className="font-mono text-xs text-coral-600">{error}</p>}
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <h2 className="font-display text-sm font-bold text-ink-900">Your webhooks</h2>
        <div className="mt-3 divide-y divide-line">
          {loading ? (
            <p className="py-3 text-sm text-ink-400">Loading…</p>
          ) : webhooks.length === 0 ? (
            <p className="py-3 text-sm text-ink-400">No webhooks yet.</p>
          ) : (
            webhooks.map((w) => (
              <div key={w.id} className="flex items-center gap-3 py-3">
                <span className="rounded-full border border-line bg-paper px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ink-500">
                  {KIND_LABEL[w.kind]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink-900">{w.label}</div>
                  <div className="truncate font-mono text-[11px] text-ink-400">{w.url}</div>
                </div>
                <button
                  onClick={() => test(w)}
                  disabled={testing === w.id}
                  aria-label={`Test ${w.label}`}
                  className="rounded-lg border border-line bg-surface p-2 text-ink-400 shadow-xs transition-all hover:border-teal/40 hover:text-teal-600 disabled:opacity-50"
                >
                  {testing === w.id ? <Spinner /> : <SendHorizonal className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => remove(w)}
                  aria-label={`Delete ${w.label}`}
                  className="rounded-lg border border-line bg-surface p-2 text-ink-400 shadow-xs transition-all hover:border-coral/50 hover:bg-coral-soft hover:text-coral-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
