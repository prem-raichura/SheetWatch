import { useState } from "react";
import Spinner from "./Spinner";
import { ModalShell } from "./Modal";

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

export default function ConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  danger = false,
  onConfirm,
  onClose,
}: Props) {
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-sm">
      <div className="p-6">
        <h3 className="font-display text-lg font-bold text-ink-900">{title}</h3>
        <p className="mt-2 text-sm text-ink-500">{message}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-ink-500 hover:bg-paper"
          >
            Cancel
          </button>
          <button
            onClick={run}
            disabled={busy}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold shadow-xs transition-all active:scale-[0.97] disabled:opacity-50 ${
              danger
                ? "bg-coral text-destructive-foreground hover:bg-coral-600"
                : "bg-foreground text-background hover:bg-foreground/85"
            }`}
          >
            {busy && <Spinner />}
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
