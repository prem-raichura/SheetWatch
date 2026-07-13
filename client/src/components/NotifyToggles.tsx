import { useState } from "react";
import { Sheet } from "../types";
import { api } from "../lib/api";

interface Props {
  sheet: Sheet;
  onUpdated: () => void;
}

export default function NotifyToggles({ sheet, onUpdated }: Props) {
  const [email, setEmail] = useState(sheet.notifyEmail);
  const [push, setPush] = useState(sheet.notifyPush);
  const [saving, setSaving] = useState(false);

  const toggle = async (field: "notifyEmail" | "notifyPush", value: boolean) => {
    setSaving(true);
    if (field === "notifyEmail") setEmail(value);
    else setPush(value);
    try {
      await api.patch<Sheet>(`/api/sheets/${sheet.id}`, { [field]: value });
      onUpdated();
    } catch {
      if (field === "notifyEmail") setEmail(!value);
      else setPush(!value);
    } finally {
      setSaving(false);
    }
  };

  const chip = (on: boolean) =>
    `rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all active:scale-95 disabled:opacity-50 ${
      on
        ? "bg-teal text-primary-foreground shadow-xs"
        : "text-ink-400 hover:bg-paper hover:text-ink-700"
    }`;

  return (
    <div
      role="group"
      aria-label="Notification channels"
      className="flex items-center gap-1 rounded-lg border border-line p-0.5"
    >
      <button
        type="button"
        disabled={saving}
        aria-pressed={email}
        onClick={() => toggle("notifyEmail", !email)}
        className={chip(email)}
      >
        Email
      </button>
      <button
        type="button"
        disabled={saving}
        aria-pressed={push}
        onClick={() => toggle("notifyPush", !push)}
        className={chip(push)}
      >
        Push
      </button>
    </div>
  );
}
