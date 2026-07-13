import { useState } from "react";
import { BellRing, Mail, Volume2 } from "lucide-react";
import { usePrefs } from "@/providers/PrefsProvider";
import { api } from "@/lib/api";
import { playSound, type SoundKind } from "@/lib/sound";
import { useToast } from "@/components/Toast";
import { usePushPermission } from "@/hooks/usePushPermission";
import DigestSettings from "@/components/DigestSettings";
import DeliveryLog from "@/components/DeliveryLog";
import Spinner from "@/components/Spinner";

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <h2 className="font-display text-sm font-bold text-ink-900">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-ink-400">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

const SOUNDS: { value: SoundKind; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "chime", label: "Chime" },
  { value: "pop", label: "Pop" },
];

export default function NotificationsPage() {
  const { prefs, update } = usePrefs();
  const toast = useToast();
  const { permission, requestPermission } = usePushPermission();
  const [busy, setBusy] = useState<"push" | "email" | null>(null);
  const qh = prefs.notifications.quietHours;

  const testPush = async () => {
    setBusy("push");
    try {
      await api.post("/api/push/test");
      toast.success("Test notification sent");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t send test");
    } finally {
      setBusy(null);
    }
  };

  const testEmail = async () => {
    setBusy("email");
    try {
      await api.post("/api/notify/test-email");
      toast.success("Test email sent");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t send test email");
    } finally {
      setBusy(null);
    }
  };

  const setQuiet = (patch: Partial<typeof qh>) =>
    update({
      notifications: {
        quietHours: { ...qh, ...patch },
        timezone:
          prefs.notifications.timezone ||
          Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    });

  return (
    <div className="space-y-5">
      <Section title="Devices & tests">
        <div className="flex flex-wrap gap-2">
          {permission !== "granted" ? (
            <button
              onClick={requestPermission}
              className="inline-flex items-center gap-2 rounded-lg bg-teal px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-xs transition-all hover:bg-teal-600 active:scale-[0.97]"
            >
              <BellRing className="h-4 w-4" /> Enable push on this device
            </button>
          ) : (
            <button
              onClick={testPush}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-semibold text-ink-700 shadow-xs transition-all hover:border-teal/40 hover:text-teal-600 active:scale-[0.97] disabled:opacity-50"
            >
              {busy === "push" ? <Spinner /> : <BellRing className="h-4 w-4" />} Test push
            </button>
          )}
          <button
            onClick={testEmail}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-semibold text-ink-700 shadow-xs transition-all hover:border-teal/40 hover:text-teal-600 active:scale-[0.97] disabled:opacity-50"
          >
            {busy === "email" ? <Spinner /> : <Mail className="h-4 w-4" />} Test email
          </button>
        </div>
      </Section>

      <Section
        title="Quiet hours"
        hint="Pushes and emails inside the window are held and delivered when it ends. Webhooks stay instant."
      >
        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={qh.enabled}
              onChange={(e) => setQuiet({ enabled: e.target.checked })}
              className="h-4 w-4 accent-[var(--primary)]"
            />
            <span className="text-sm font-medium text-ink-700">Enabled</span>
          </label>
          <div className={`flex items-center gap-2 ${qh.enabled ? "" : "opacity-40"}`}>
            <input
              type="time"
              value={qh.start}
              disabled={!qh.enabled}
              onChange={(e) => setQuiet({ start: e.target.value })}
              className="rounded-lg border border-line bg-paper px-2.5 py-1.5 font-mono text-xs text-ink-900 outline-hidden focus:border-teal"
            />
            <span className="text-xs text-ink-400">to</span>
            <input
              type="time"
              value={qh.end}
              disabled={!qh.enabled}
              onChange={(e) => setQuiet({ end: e.target.value })}
              className="rounded-lg border border-line bg-paper px-2.5 py-1.5 font-mono text-xs text-ink-900 outline-hidden focus:border-teal"
            />
          </div>
        </div>
        {qh.enabled && (
          <p className="mt-2 font-mono text-[11px] text-ink-400">
            timezone: {prefs.notifications.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}
          </p>
        )}
      </Section>

      <Section title="In-app sound" hint="Played when new changes arrive while the app is open.">
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-line bg-paper p-0.5" role="group">
            {SOUNDS.map((s) => (
              <button
                key={s.value}
                aria-pressed={prefs.notifications.sound === s.value}
                onClick={() => {
                  update({ notifications: { sound: s.value } });
                  playSound(s.value);
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  prefs.notifications.sound === s.value
                    ? "bg-card text-ink-900 shadow-xs"
                    : "text-ink-500 hover:text-ink-900"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => playSound(prefs.notifications.sound)}
            disabled={prefs.notifications.sound === "off"}
            aria-label="Preview sound"
            className="rounded-lg border border-line bg-surface p-2 text-ink-400 shadow-xs transition-all hover:border-teal/40 hover:text-teal-600 disabled:opacity-40"
          >
            <Volume2 className="h-4 w-4" />
          </button>
        </div>
      </Section>

      <DigestSettings />

      <DeliveryLog />
    </div>
  );
}
