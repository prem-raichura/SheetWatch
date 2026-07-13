import { useState } from "react";
import { Project } from "../types";
import Spinner from "./Spinner";
import { ModalShell } from "./Modal";

const SWATCHES = [
  "#0FA3A3",
  "#F0563B",
  "#6366F1",
  "#EAB308",
  "#10B981",
  "#EC4899",
  "#0EA5E9",
  "#141A2A",
];

interface Props {
  project?: Project | null;
  onClose: () => void;
  onSave: (data: {
    name: string;
    color: string;
    notifyEmail: boolean;
    notifyPush: boolean;
    applyNotifyToSheets?: boolean;
  }) => Promise<void>;
  onDelete?: () => Promise<void>;
}

export default function ProjectModal({ project, onClose, onSave, onDelete }: Props) {
  const [name, setName] = useState(project?.name ?? "");
  const [color, setColor] = useState(project?.color ?? SWATCHES[0]);
  const [notifyEmail, setNotifyEmail] = useState(project?.notifyEmail ?? true);
  const [notifyPush, setNotifyPush] = useState(project?.notifyPush ?? true);
  const [applyAll, setApplyAll] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        color,
        notifyEmail,
        notifyPush,
        applyNotifyToSheets: applyAll,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-md" label={project ? "Edit project" : "New project"}>
      <div className="p-6">
        <h2 className="font-display text-lg font-bold text-ink-900">
          {project ? "Edit project" : "New project"}
        </h2>

        <label className="mt-5 block text-xs font-semibold text-ink-500">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Q3 Billing"
          className="mt-1.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-hidden transition-shadow focus:border-teal focus:ring-4 focus:ring-teal/10"
        />

        <label className="mt-4 block text-xs font-semibold text-ink-500">Color</label>
        <div className="mt-2 flex flex-wrap gap-2.5">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`Use color ${c}`}
              aria-pressed={color === c}
              style={{ backgroundColor: c }}
              className={`flex h-7 w-7 items-center justify-center rounded-full text-white transition-transform ${
                color === c ? "scale-110 shadow-md" : "opacity-80 hover:scale-105 hover:opacity-100"
              }`}
            >
              {color === c && (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </button>
          ))}
        </div>

        <div className="mt-5 rounded-xl border border-line bg-paper p-3">
          <p className="text-xs font-semibold text-ink-500">Notification defaults</p>
          <div className="mt-2 flex gap-4">
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                checked={notifyEmail}
                onChange={(e) => setNotifyEmail(e.target.checked)}
                className="accent-teal"
              />
              Email
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                checked={notifyPush}
                onChange={(e) => setNotifyPush(e.target.checked)}
                className="accent-teal"
              />
              Push
            </label>
          </div>
          {project && (
            <label className="mt-3 flex items-center gap-2 text-xs text-ink-400">
              <input
                type="checkbox"
                checked={applyAll}
                onChange={(e) => setApplyAll(e.target.checked)}
                className="accent-teal"
              />
              Apply these to every sheet in this project
            </label>
          )}
        </div>

        <div className="mt-6 flex items-center gap-2">
          <button
            onClick={submit}
            disabled={saving || !name.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background shadow-xs transition-all hover:bg-foreground/85 active:scale-[0.97] disabled:opacity-50"
          >
            {saving && <Spinner />}
            {saving ? "Saving…" : project ? "Save" : "Create"}
          </button>
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-ink-500 transition-colors hover:bg-paper"
          >
            Cancel
          </button>
          {project && onDelete && (
            <button
              onClick={async () => {
                if (confirm(`Delete project “${project.name}”? Sheets stay, just ungrouped.`)) {
                  await onDelete();
                  onClose();
                }
              }}
              className="ml-auto rounded-lg px-3 py-2 text-xs font-medium text-ink-400 transition-colors hover:bg-coral-soft hover:text-coral-600"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
