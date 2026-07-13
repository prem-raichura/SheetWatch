import { useState } from "react";
import { Webhook, WebhookKind } from "../types";
import { useWebhooks } from "../hooks/useWebhooks";
import { useToast } from "./Toast";
import { ModalShell } from "./Modal";
import Spinner from "./Spinner";

const KIND_LABEL: Record<WebhookKind, string> = {
  slack: "Slack",
  discord: "Discord",
  generic: "Webhook",
  telegram: "Telegram",
};

interface Props {
  onClose: () => void;
  onChanged?: () => void;
}

export default function WebhooksModal({ onClose, onChanged }: Props) {
  const { webhooks, loading, refetch, createWebhook, deleteWebhook, testWebhook } = useWebhooks();
  const toast = useToast();

  const [kind, setKind] = useState<WebhookKind>("slack");
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
      onChanged?.();
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
      onChanged?.();
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

  const field =
    "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-hidden transition-shadow focus:border-teal focus:ring-4 focus:ring-teal/10";

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-lg" label="Webhooks">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="font-display text-lg font-bold text-ink-900">Webhooks</h2>
        <button
          onClick={onClose}
          aria-label="Close webhooks"
          className="rounded-md px-2 py-1 text-ink-400 transition-colors hover:bg-paper hover:text-ink-900"
        >
          ✕
        </button>
      </div>

      <div className="max-h-[70vh] space-y-5 overflow-y-auto px-5 py-5">
        <p className="text-sm text-ink-500">
          Send change alerts to Slack, Discord or any endpoint that accepts a JSON POST. Attach
          them per sheet in Watch settings.
        </p>

        <div className="space-y-2 rounded-xl border border-line bg-paper p-3">
          <div className="grid grid-cols-2 gap-2">
            <select value={kind} onChange={(e) => setKind(e.target.value as WebhookKind)} className={field}>
              <option value="slack">Slack</option>
              <option value="discord">Discord</option>
              <option value="generic">Generic JSON</option>
            </select>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Name (e.g. #alerts)"
              className={field}
            />
          </div>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/…"
            className={`${field} font-mono text-xs`}
          />
          {error && <p className="text-xs text-coral-600">{error}</p>}
          <button
            onClick={add}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-teal px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-xs transition-all hover:bg-teal-600 active:scale-[0.97] disabled:opacity-50"
          >
            {saving && <Spinner />}
            {saving ? "Adding…" : "+ Add webhook"}
          </button>
        </div>

        {loading ? (
          <p className="font-mono text-xs text-ink-300">loading…</p>
        ) : webhooks.length === 0 ? (
          <p className="font-mono text-xs text-ink-300">no webhooks yet</p>
        ) : (
          <div className="space-y-2">
            {webhooks.map((w) => (
              <div key={w.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
                <span className="rounded-md bg-paper px-2 py-0.5 font-mono text-[11px] font-semibold text-ink-500">
                  {KIND_LABEL[w.kind]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-900">{w.label}</p>
                  <p className="truncate font-mono text-[11px] text-ink-400">{w.url}</p>
                </div>
                {w.sheetCount !== undefined && (
                  <span className="font-mono text-[11px] text-ink-300">
                    {w.sheetCount} sheet{w.sheetCount !== 1 ? "s" : ""}
                  </span>
                )}
                <button
                  onClick={() => test(w)}
                  disabled={testing === w.id}
                  className="rounded-md px-2 py-1 font-mono text-[11px] text-ink-400 transition-colors hover:bg-paper hover:text-teal-600 disabled:opacity-40"
                >
                  {testing === w.id ? "sending…" : "test"}
                </button>
                <button
                  onClick={() => remove(w)}
                  className="rounded-md px-2 py-1 font-mono text-[11px] text-ink-400 transition-colors hover:bg-coral-soft hover:text-coral-600"
                >
                  delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </ModalShell>
  );
}
