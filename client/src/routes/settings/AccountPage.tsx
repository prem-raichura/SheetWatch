import { useState } from "react";
import { LogOut, Trash2 } from "lucide-react";
import { User } from "@/types";
import { logout } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { usePrefs } from "@/providers/PrefsProvider";
import DeleteAccountModal from "@/components/DeleteAccountModal";

export default function AccountPage({ user }: { user: User }) {
  const { prefs } = usePrefs();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const handleLogout = async () => {
    await logout();
    window.location.href = "/login";
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <h2 className="font-display text-sm font-bold text-ink-900">Signed in as</h2>
        <div className="mt-3 space-y-1">
          <div className="text-sm font-medium text-ink-900">{user.email}</div>
          {user.createdAt && (
            <div className="font-mono text-[11px] text-ink-400">
              member since {formatDateTime(user.createdAt, prefs.time)}
            </div>
          )}
        </div>
        <button
          onClick={handleLogout}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-semibold text-ink-700 shadow-xs transition-all hover:border-coral/50 hover:bg-coral-soft hover:text-coral-600 active:scale-[0.97]"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <h2 className="font-display text-sm font-bold text-ink-900">Google access</h2>
        <p className="mt-2 text-sm text-ink-500">
          SheetWatch reads only the cell ranges you choose to watch. It writes to a sheet in two
          cases you trigger yourself: when you apply a value from an integrity check, and when you remove a
          spreadsheet (which moves it to your Drive trash). If a sheet shows a “re-authorize” error,
          sign out and back in to refresh access.
        </p>
        <a
          href="https://myaccount.google.com/permissions"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block text-sm font-medium text-teal-600 underline underline-offset-2"
        >
          Revoke SheetWatch's access in your Google account
        </a>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <h2 className="font-display text-sm font-bold text-ink-900">Privacy &amp; data</h2>
        <p className="mt-2 text-sm text-ink-500">
          Read what we store and for how long, or request deletion of your account and all its data.
        </p>
        <div className="mt-3 flex flex-wrap gap-4 text-sm font-medium">
          <a href="/privacy" className="text-teal-600 underline underline-offset-2">
            Privacy Policy
          </a>
          <a href="/terms" className="text-teal-600 underline underline-offset-2">
            Terms of Service
          </a>
        </div>
      </section>

      <section className="rounded-2xl border border-coral/30 bg-surface p-5 shadow-card">
        <h2 className="font-display text-sm font-bold text-coral-600">Danger zone</h2>
        <p className="mt-2 text-sm text-ink-500">
          Delete your SheetWatch account and everything in it — tracked sheets, change history,
          snapshots, widgets, webhooks and share links. SheetWatch's access to your Google account
          is revoked at the same time. Your spreadsheets stay untouched in Google Drive.
        </p>
        <button
          onClick={() => setConfirmingDelete(true)}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-coral/40 bg-coral-soft px-3.5 py-2 text-sm font-semibold text-coral-600 shadow-xs transition-all hover:bg-coral hover:text-destructive-foreground active:scale-[0.97]"
        >
          <Trash2 className="h-4 w-4" /> Delete account
        </button>
      </section>

      {confirmingDelete && (
        <DeleteAccountModal email={user.email} onClose={() => setConfirmingDelete(false)} />
      )}
    </div>
  );
}
