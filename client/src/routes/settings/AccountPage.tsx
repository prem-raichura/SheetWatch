import { LogOut } from "lucide-react";
import { User } from "@/types";
import { logout } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { usePrefs } from "@/providers/PrefsProvider";

export default function AccountPage({ user }: { user: User }) {
  const { prefs } = usePrefs();

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
          SheetWatch reads your sheets with read-only Google permissions. If a sheet shows a
          “re-authorize” error, sign out and back in to refresh access.
        </p>
      </section>
    </div>
  );
}
