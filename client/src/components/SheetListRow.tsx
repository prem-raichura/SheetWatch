import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, Pause, Play, Settings2, Trash2 } from "lucide-react";
import { Sheet, Project } from "../types";
import PulseDot from "./PulseDot";
import SheetSettings from "./SheetSettings";
import ConfirmModal from "./ConfirmModal";
import Spinner from "./Spinner";
import { usePrefs } from "../providers/PrefsProvider";
import { formatTimeAgo } from "../lib/format";
import { useSheetActions } from "../hooks/useSheetActions";
import { scopeLabel } from "./SheetRow";

// Compact one-line row for the Tracking list view. Same actions as the card,
// via the shared useSheetActions hook.
export default function SheetListRow({
  sheet,
  projects,
  onUpdated,
}: {
  sheet: Sheet;
  projects: Project[];
  onUpdated: () => void;
}) {
  const { prefs } = usePrefs();
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { checking, pausing, paused, errored, snoozed, checkNow, togglePause, remove } =
    useSheetActions(sheet, onUpdated);
  const project = projects.find((p) => p.id === sheet.projectId);

  return (
    <>
      <div
        className={`flex items-center gap-3 border-b border-line px-3 py-2 last:border-0 ${
          paused ? "opacity-60" : ""
        }`}
      >
        <PulseDot tone={paused ? "muted" : errored ? "alert" : "live"} />

        <button
          onClick={() => setSettingsOpen(true)}
          className="max-w-[13rem] shrink-0 truncate text-left font-display text-sm font-semibold text-ink-900 hover:text-teal-600"
        >
          {sheet.label}
        </button>
        <span className="hidden shrink-0 truncate font-mono text-[10px] text-ink-400 sm:inline">
          {scopeLabel(sheet)}
        </span>

        {project ? (
          <span className="hidden shrink-0 items-center gap-1 font-mono text-[11px] text-ink-500 md:inline-flex">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: project.color }} />
            {project.name}
          </span>
        ) : null}

        {sheet.alertColumns.length > 0 && (
          <span className="hidden shrink-0 rounded bg-teal-soft px-1 font-mono text-[10px] text-teal-600 lg:inline">
            {sheet.alertColumns.join(",")}
          </span>
        )}
        {snoozed && <Clock className="hidden h-3 w-3 shrink-0 text-ink-300 lg:inline" />}

        <span className="ml-auto shrink-0 font-mono text-[11px] text-ink-400">
          {errored ? (
            <span className="text-coral-600">error</span>
          ) : sheet.lastCheckedAt ? (
            formatTimeAgo(sheet.lastCheckedAt, prefs.time)
          ) : (
            "never"
          )}
        </span>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            onClick={checkNow}
            disabled={checking || paused}
            aria-label="Check now"
            className="rounded p-1 text-ink-400 transition-colors hover:text-teal-600 disabled:opacity-30"
          >
            {checking ? <Spinner /> : <span className="text-xs">↻</span>}
          </button>
          <button
            onClick={togglePause}
            disabled={pausing}
            aria-label={paused ? "Resume" : "Pause"}
            className="rounded p-1 text-ink-400 transition-colors hover:text-ink-900 disabled:opacity-30"
          >
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
            className="rounded p-1 text-ink-400 transition-colors hover:text-ink-900"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => navigate(`/history/${sheet.id}`)}
            aria-label="History"
            className="rounded p-1 font-mono text-[11px] text-ink-400 transition-colors hover:text-ink-700"
          >
            →
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            aria-label="Stop watching"
            className="rounded p-1 text-ink-400 transition-colors hover:text-coral-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {settingsOpen && (
        <SheetSettings
          sheet={sheet}
          projects={projects}
          onClose={() => setSettingsOpen(false)}
          onSaved={onUpdated}
        />
      )}
      {confirmDelete && (
        <ConfirmModal
          title="Stop watching?"
          message={`“${sheet.label}” and its change history will be removed. You can track it again anytime.`}
          confirmLabel="Stop watching"
          danger
          onConfirm={remove}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
