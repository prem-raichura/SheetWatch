import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { ModalShell } from "./Modal";
import Spinner from "./Spinner";
import { deleteAccount } from "@/lib/auth";

interface Props {
  email: string;
  onClose: () => void;
}

// What the cascade actually removes, spelled out so nobody deletes on a guess.
const ERASED = [
  "every tracked sheet and its watch settings",
  "all change history and stored snapshots",
  "KPI tiles, charts and integrity checks",
  "webhooks, push subscriptions and scheduled reports",
  "share links — any board you published stops resolving",
  "your notification delivery log",
];

export default function DeleteAccountModal({ email, onClose }: Props) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = confirm.trim().toLowerCase() === email.toLowerCase();

  const run = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(confirm.trim());
      // Full reload rather than a router push: the session cookie is gone and
      // every cached query in memory now refers to a user that no longer exists.
      window.location.href = "/login";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deletion failed");
      setBusy(false);
    }
  };

  return (
    <ModalShell onClose={busy ? () => {} : onClose} maxWidth="max-w-md" label="Delete account">
      <div className="p-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 rounded-lg bg-coral-soft p-2 text-coral-600">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div>
            <h3 className="font-display text-lg font-bold text-ink-900">Delete your account</h3>
            <p className="mt-1 text-sm text-ink-500">
              This is permanent and takes effect immediately. It cannot be undone.
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-line bg-paper px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">
            Erased right away
          </p>
          <ul className="mt-2 space-y-1 text-sm text-ink-500">
            {ERASED.map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden className="text-ink-300">
                  ·
                </span>
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-line pt-3 text-xs text-ink-400">
            SheetWatch's access to your Google account is revoked as part of this. Your
            spreadsheets themselves are never touched — they stay in your Google Drive.
          </p>
        </div>

        <label className="mt-4 block">
          <span className="text-sm text-ink-600">
            Type <strong className="font-semibold text-ink-900">{email}</strong> to confirm
          </span>
          <input
            type="email"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            autoComplete="off"
            autoFocus
            spellCheck={false}
            placeholder={email}
            disabled={busy}
            className="mt-1.5 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink-900 outline-none transition-colors placeholder:text-ink-300 focus:border-coral/60 disabled:opacity-60"
          />
        </label>

        {error && (
          <p className="mt-3 rounded-lg border border-coral/30 bg-coral-soft px-3 py-2 text-sm text-coral-600">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-lg px-4 py-2 text-sm font-medium text-ink-500 hover:bg-paper disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={run}
            disabled={!matches || busy}
            className="inline-flex items-center gap-2 rounded-lg bg-coral px-4 py-2 text-sm font-semibold text-destructive-foreground shadow-xs transition-all hover:bg-coral-600 active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100"
          >
            {busy && <Spinner />}
            {busy ? "Deleting…" : "Delete forever"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
