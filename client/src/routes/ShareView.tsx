import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import BrandMark from "../components/BrandMark";
import NumberTicker from "../components/magic/NumberTicker";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

interface SharedWidget {
  id: string;
  sheetLabel?: string;
  cell: string;
  label: string;
  format: "number" | "currency" | "percent";
  value?: string | null;
  delta24h?: number | null;
  series?: (number | null)[];
}

interface Board {
  title: string | null;
  createdAt: string;
  widgets: SharedWidget[];
}

function formatNumber(n: number, format: string): string {
  switch (format) {
    case "currency":
      return n.toLocaleString(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      });
    case "percent":
      return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
    default:
      return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
}

function Sparkline({ series }: { series: (number | null)[] }) {
  const points = series.filter((v): v is number => v !== null);
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const W = 96;
  const H = 28;
  const step = W / (points.length - 1);
  const d = points
    .map(
      (v, i) =>
        `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(H - ((v - min) / span) * H).toFixed(1)}`
    )
    .join(" ");
  const up = points[points.length - 1] >= points[0];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible" aria-hidden>
      <path d={d} fill="none" strokeWidth="1.5" className={up ? "stroke-teal" : "stroke-coral"} />
    </svg>
  );
}

// Public read-only KPI board. No auth, no prefs — follows the system theme.
export default function ShareView() {
  const { token } = useParams<{ token: string }>();
  const [board, setBoard] = useState<Board | null | undefined>(undefined);

  useEffect(() => {
    fetch(`${API_BASE}/public/kpis/${token}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setBoard)
      .catch(() => setBoard(null));
  }, [token]);

  useEffect(() => {
    // Public page: follow the OS theme regardless of any stored app prefs.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-surface/85 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-2.5 px-6 py-4">
          <BrandMark className="h-6 w-6" />
          <span className="font-display text-lg font-bold tracking-tight text-ink-900">
            {board?.title || "KPI board"}
          </span>
          <span className="ml-auto font-mono text-[11px] text-ink-400">live · read-only</span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        {board === undefined ? (
          <p className="font-mono text-sm text-ink-400">loading…</p>
        ) : board === null ? (
          <div className="rounded-2xl border border-dashed border-line bg-surface px-6 py-16 text-center">
            <p className="text-sm font-medium text-ink-700">This link is no longer active</p>
            <p className="mt-1 text-sm text-ink-400">Ask the owner for a fresh one.</p>
          </div>
        ) : board.widgets.length === 0 ? (
          <p className="font-mono text-sm text-ink-400">no KPIs on this board yet</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {board.widgets.map((w) => {
              const n =
                w.value === null || w.value === undefined || w.value === ""
                  ? null
                  : Number(String(w.value).replace(/[^0-9eE.+-]/g, ""));
              return (
                <div
                  key={w.id}
                  className="rounded-2xl border border-line bg-surface px-5 py-4 shadow-card"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-[11px] uppercase tracking-wider text-ink-400">
                        {w.label}
                      </div>
                      <div className="mt-1 font-display text-2xl font-bold tracking-tight text-ink-900">
                        {n === null || Number.isNaN(n) ? (
                          (w.value ?? "—")
                        ) : (
                          <NumberTicker value={n} format={(v) => formatNumber(v, w.format)} />
                        )}
                      </div>
                      {w.delta24h != null && w.delta24h !== 0 && (
                        <div
                          className={`mt-0.5 font-mono text-[11px] font-semibold ${
                            w.delta24h > 0 ? "text-teal-600" : "text-coral-600"
                          }`}
                        >
                          {w.delta24h > 0 ? "▲" : "▼"}{" "}
                          {Math.abs(w.delta24h).toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })}{" "}
                          · 24h
                        </div>
                      )}
                    </div>
                    {w.series && <Sparkline series={w.series} />}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-10 text-center font-mono text-[11px] text-ink-300">
          powered by SheetWatch
        </p>
      </main>
    </div>
  );
}
