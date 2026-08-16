import { GitCompareArrows, AlertTriangle, Check } from "lucide-react";
import type { CompareGroup } from "../../types";

interface Props {
  groups: CompareGroup[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

// Left rail: one card per integrity check with an at-a-glance health signal.
export default function ComparisonList({ groups, selectedId, onSelect }: Props) {
  return (
    <div className="space-y-2">
      <h2 className="px-1 font-display text-xs font-bold uppercase tracking-wide text-ink-400">
        Integrity checks
      </h2>
      <div className="space-y-1.5">
        {groups.map((g) => {
          const active = g.id === selectedId;
          const intact = g.pendingCount === 0 && g.conflictCount === 0;
          return (
            <button
              key={g.id}
              onClick={() => onSelect(g.id)}
              className={`w-full rounded-xl border px-3.5 py-3 text-left transition-colors ${
                active ? "border-teal bg-teal-soft" : "border-line bg-surface hover:border-ink-300"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-display text-sm font-semibold text-ink-900">{g.name}</span>
                {intact ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-teal-600">
                    <Check className="h-3.5 w-3.5" /> intact
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-teal px-2 py-0.5 font-mono text-[11px] font-bold text-primary-foreground">
                    {g.pendingCount}
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-400">
                <GitCompareArrows className="h-3 w-3 shrink-0" />
                <span className="truncate">
                  {g.master.label} → {g.targets.length} sheet{g.targets.length !== 1 ? "s" : ""}
                </span>
              </div>
              {g.conflictCount > 0 && (
                <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-amber-600">
                  <AlertTriangle className="h-3 w-3" /> {g.conflictCount} conflict
                  {g.conflictCount !== 1 ? "s" : ""}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
