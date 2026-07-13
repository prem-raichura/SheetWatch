import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { User } from "../types";
import { useToast } from "./Toast";

const HOURS = Array.from({ length: 24 }, (_, h) => h);

// Email digest preference card: off / daily / weekly + send hour.
export default function DigestSettings() {
  const toast = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<User>("/auth/me").then(setUser).catch(() => {});
  }, []);

  if (!user) return null;

  const update = async (patch: { digest?: string; digestHour?: number }) => {
    setSaving(true);
    try {
      const updated = await api.patch<User>("/auth/me", patch);
      setUser(updated);
      toast.success("Digest preference saved");
    } catch {
      toast.error("Couldn’t save digest preference");
    } finally {
      setSaving(false);
    }
  };

  const digest = user.digest ?? "off";

  const seg = (value: string, label: string) => (
    <button
      key={value}
      type="button"
      disabled={saving}
      onClick={() => update({ digest: value })}
      className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
        digest === value ? "bg-foreground text-background shadow-xs" : "text-ink-500 hover:text-ink-900"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="rounded-2xl border border-line bg-surface px-5 py-4 shadow-card">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-sm font-bold text-ink-900">Email digest</h2>
          <p className="mt-0.5 text-xs text-ink-400">
            Bundle change emails into one summary. Push alerts stay instant.
          </p>
        </div>
        <div className="flex gap-1 rounded-xl border border-line bg-paper p-1">
          {seg("off", "Instant")}
          {seg("daily", "Daily")}
          {seg("weekly", "Weekly")}
        </div>
        <button
          type="button"
          onClick={async () => {
            try {
              await api.post("/api/notify/test-email");
              toast.success("Test email sent — check your inbox");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Test email failed");
            }
          }}
          className="rounded-lg border border-line bg-paper px-3 py-1.5 text-xs font-semibold text-ink-700 transition-all hover:border-teal/40 hover:text-teal-600 active:scale-[0.97]"
        >
          ✉ Test email
        </button>
        {digest !== "off" && (
          <select
            value={user.digestHour ?? 8}
            disabled={saving}
            onChange={(e) => update({ digestHour: Number(e.target.value) })}
            aria-label="Digest hour"
            className="rounded-lg border border-line bg-paper px-2 py-1.5 text-xs outline-hidden focus:border-teal"
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
