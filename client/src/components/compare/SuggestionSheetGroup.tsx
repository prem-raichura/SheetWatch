import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Check,
  X,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import type { CompareSuggestion, SuggestionStatus } from "../../types";

interface Props {
  label: string;
  spreadsheetId?: string;
  suggestions: CompareSuggestion[];
  status: string;
  busy: boolean;
  onAccept: (ids: string[]) => void;
  onIgnore: (ids: string[]) => void;
}

// One target sheet's suggestions as a collapsible section. The value change is
// the hero of each row; everything else stays quiet.
export default function SuggestionSheetGroup({
  label,
  spreadsheetId,
  suggestions,
  status,
  busy,
  onAccept,
  onIgnore,
}: Props) {
  const [open, setOpen] = useState(true);
  const isPending = status === "pending";
  const pendingIds = suggestions.filter((s) => s.status === "pending").map((s) => s.id);

  return (
    <section>
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-secondary/95 px-3 py-2 backdrop-blur">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-400" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-400" />
          )}
          <span className="truncate font-display text-sm font-semibold text-ink-900">{label}</span>
          <span className="shrink-0 rounded-full bg-surface px-1.5 font-mono text-[11px] text-ink-400">
            {suggestions.length}
          </span>
        </button>
        {isPending && pendingIds.length > 0 && (
          <button
            onClick={() => onAccept(pendingIds)}
            disabled={busy}
            className="shrink-0 rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold text-teal-600 transition-colors hover:bg-teal-soft disabled:opacity-40"
          >
            accept all
          </button>
        )}
        {spreadsheetId && (
          <a
            href={`https://docs.google.com/spreadsheets/d/${spreadsheetId}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in Google Sheets"
            className="shrink-0 rounded p-1 text-ink-400 transition-colors hover:text-teal-600"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {open && (
        <div className="divide-y divide-line">
          {suggestions.map((s) => (
            <div
              key={s.id}
              className={`flex items-center gap-3 px-3 py-2.5 ${s.conflict ? "bg-amber-50/50" : ""}`}
            >
              <span className="w-24 shrink-0 font-mono text-[11px] text-ink-400">
                row {s.keyValue} · {s.column}
              </span>

              {/* Hero: the value change. */}
              <div className="flex min-w-0 flex-1 items-center gap-2 font-mono text-sm">
                <span className="truncate text-coral-600 line-through">{s.targetValue || "∅"}</span>
                <span className="shrink-0 text-ink-300">→</span>
                <span className="truncate font-semibold text-teal-600">{s.masterValue || "∅"}</span>
              </div>

              {s.conflict && (
                <span className="hidden shrink-0 items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 sm:inline-flex">
                  <AlertTriangle className="h-3 w-3" /> conflict
                </span>
              )}
              {s.status === "failed" && s.error && (
                <span
                  className="hidden max-w-[10rem] shrink-0 truncate text-[10px] text-coral-600 md:inline"
                  title={s.error}
                >
                  {s.error}
                </span>
              )}

              <div className="shrink-0">
                {s.status === "pending" ? (
                  <div className="flex gap-1">
                    <button
                      onClick={() => onAccept([s.id])}
                      disabled={busy}
                      title="Accept"
                      className="rounded p-1 text-ink-400 transition-colors hover:bg-teal-soft hover:text-teal-600 disabled:opacity-40"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => onIgnore([s.id])}
                      disabled={busy}
                      title="Ignore"
                      className="rounded p-1 text-ink-400 transition-colors hover:bg-coral-soft hover:text-coral-600 disabled:opacity-40"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <StatusPill status={s.status} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function StatusPill({ status }: { status: SuggestionStatus }) {
  const map: Record<SuggestionStatus, string> = {
    pending: "bg-secondary text-ink-500",
    applied: "bg-teal-soft text-teal-600",
    ignored: "bg-secondary text-ink-400",
    failed: "bg-coral-soft text-coral-600",
  };
  return (
    <span className={`rounded px-2 py-0.5 font-mono text-[11px] font-semibold ${map[status]}`}>
      {status}
    </span>
  );
}
