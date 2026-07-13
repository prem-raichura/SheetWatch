import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

interface Day {
  date: string;
  count: number;
}

const WEEKS = 26; // half a year fits comfortably in a card

function intensity(count: number, max: number): string {
  if (count === 0) return "var(--secondary)";
  const step = Math.min(4, Math.ceil((count / Math.max(max, 1)) * 4));
  const pct = [0, 25, 45, 70, 100][step];
  return `color-mix(in oklab, var(--primary) ${pct}%, var(--card))`;
}

// GitHub-style change-frequency calendar. CSS grid, no chart lib.
export default function HeatmapCalendar({ sheetId }: { sheetId?: string }) {
  const [days, setDays] = useState<Day[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams({
      days: String(WEEKS * 7),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    if (sheetId) params.set("sheetId", sheetId);
    api
      .get<Day[]>(`/api/changes/heatmap?${params.toString()}`)
      .then(setDays)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [sheetId]);

  const { cells, max, total } = useMemo(() => {
    const byDate = new Map(days.map((d) => [d.date, d.count]));
    const today = new Date();
    // Grid ends on today's column; start on the Sunday WEEKS-1 weeks back.
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay() - (WEEKS - 1) * 7);
    const list: { date: string; count: number }[] = [];
    let maxCount = 0;
    let sum = 0;
    for (let i = 0; i < WEEKS * 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      if (d > today) break;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`;
      const count = byDate.get(key) ?? 0;
      maxCount = Math.max(maxCount, count);
      sum += count;
      list.push({ date: key, count });
    }
    return { cells: list, max: maxCount, total: sum };
  }, [days]);

  if (!loaded) return null;

  return (
    <div className="rounded-2xl border border-line bg-surface px-5 py-4 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-bold text-ink-900">Change heatmap</h2>
        <span className="font-mono text-[11px] text-ink-400">
          {total} changes · {WEEKS} weeks
        </span>
      </div>
      <div
        className="mt-3 grid grid-flow-col gap-[3px] overflow-x-auto pb-1"
        style={{ gridTemplateRows: "repeat(7, 10px)" }}
        role="img"
        aria-label="Calendar of change frequency"
      >
        {cells.map((c) => (
          <span
            key={c.date}
            title={`${c.date}: ${c.count} change${c.count !== 1 ? "s" : ""}`}
            className="h-[10px] w-[10px] rounded-[2px]"
            style={{ backgroundColor: intensity(c.count, max) }}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1 font-mono text-[10px] text-ink-400">
        less
        {[0, 1, 2, 3, 4].map((s) => (
          <span
            key={s}
            className="h-[10px] w-[10px] rounded-[2px]"
            style={{
              backgroundColor:
                s === 0
                  ? "var(--secondary)"
                  : `color-mix(in oklab, var(--primary) ${[0, 25, 45, 70, 100][s]}%, var(--card))`,
            }}
          />
        ))}
        more
      </div>
    </div>
  );
}
