import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Sheet } from "../types";
import { useToast } from "./Toast";
import { useTheme } from "../providers/ThemeProvider";
import { usePrefs } from "../providers/PrefsProvider";
import { useScrollLock } from "../hooks/useScrollLock";

interface Props {
  onClose: () => void;
}

interface Item {
  id: string;
  label: string;
  hint: string;
  keywords: string;
  run: () => void | Promise<void>;
}

// Subsequence fuzzy match: every query char appears in order. Lower = better.
function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let ti = 0;
  let score = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    score += found - ti;
    ti = found + 1;
  }
  return score + (t.startsWith(q) ? -10 : 0);
}

export default function CommandPalette({ onClose }: Props) {
  const [query, setQuery] = useState("");
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const toast = useToast();
  const { isDark, toggleTheme } = useTheme();
  const { prefs, update } = usePrefs();

  useScrollLock();
  useEffect(() => {
    inputRef.current?.focus();
    api.get<Sheet[]>("/api/sheets").then(setSheets).catch(() => {});
  }, []);

  const items = useMemo<Item[]>(() => {
    const go = (to: string) => () => {
      navigate(to);
      onClose();
    };
    const nav: Item[] = [
      { id: "nav-overview", label: "Go to Overview", hint: "page", keywords: "overview dashboard stats", run: go("/overview") },
      { id: "nav-sheets", label: "Go to Sheets", hint: "page", keywords: "sheets drive add track", run: go("/sheets") },
      { id: "nav-tracking", label: "Go to Tracking", hint: "page", keywords: "tracking projects watched", run: go("/tracking") },
      { id: "nav-activity", label: "Go to Activity", hint: "page", keywords: "activity changes feed", run: go("/activity") },
      { id: "nav-settings", label: "Open Settings", hint: "page", keywords: "settings preferences customize appearance", run: go("/settings") },
      {
        id: "theme-toggle",
        label: `Switch to ${isDark ? "light" : "dark"} theme`,
        hint: "setting",
        keywords: "theme dark light mode toggle appearance",
        run: () => {
          toggleTheme();
          onClose();
        },
      },
      {
        id: "density-toggle",
        label: `Density: switch to ${prefs.appearance.density === "compact" ? "comfortable" : "compact"}`,
        hint: "setting",
        keywords: "density compact comfortable spacing",
        run: () => {
          update({
            appearance: {
              density: prefs.appearance.density === "compact" ? "comfortable" : "compact",
            },
          });
          onClose();
        },
      },
      {
        id: "anim-toggle",
        label: `Animations: ${prefs.appearance.animation === "full" ? "reduce" : "restore full"}`,
        hint: "setting",
        keywords: "animation motion reduce disable",
        run: () => {
          update({
            appearance: {
              animation: prefs.appearance.animation === "full" ? "reduced" : "full",
            },
          });
          onClose();
        },
      },
    ];

    const perSheet = sheets.flatMap<Item>((s) => [
      {
        id: `hist-${s.id}`,
        label: `${s.label} — history`,
        hint: "open",
        keywords: `${s.label} history changes`,
        run: go(`/history/${s.id}`),
      },
      {
        id: `open-${s.id}`,
        label: `${s.label} — open in Google Sheets`,
        hint: "open",
        keywords: `${s.label} google sheets open external`,
        run: () => {
          window.open(`https://docs.google.com/spreadsheets/d/${s.spreadsheetId}`, "_blank");
          onClose();
        },
      },
      {
        id: `check-${s.id}`,
        label: `${s.label} — check now`,
        hint: "action",
        keywords: `${s.label} check poll refresh now`,
        run: async () => {
          try {
            await api.post(`/api/sheets/${s.id}/check`);
            toast.success(`Checking ${s.label}…`);
          } catch {
            toast.error("Couldn’t start check");
          }
          onClose();
        },
      },
      {
        id: `pause-${s.id}`,
        label: `${s.label} — ${s.paused ? "resume" : "pause"}`,
        hint: "action",
        keywords: `${s.label} pause resume stop`,
        run: async () => {
          try {
            await api.patch(`/api/sheets/${s.id}`, { paused: !s.paused });
            toast.success(`${s.label} ${s.paused ? "resumed" : "paused"}`);
          } catch {
            toast.error("Couldn’t update sheet");
          }
          onClose();
        },
      },
    ]);

    return [...nav, ...perSheet];
  }, [sheets, navigate, onClose, toast, isDark, toggleTheme, prefs.appearance, update]);

  const visible = useMemo(() => {
    if (!query.trim()) return items.slice(0, 8);
    return items
      .map((item) => ({ item, score: fuzzyScore(query.trim(), `${item.label} ${item.keywords}`) }))
      .filter((x): x is { item: Item; score: number } => x.score !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, 12)
      .map((x) => x.item);
  }, [items, query]);

  useEffect(() => setSelected(0), [query]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, visible.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && visible[selected]) {
      visible[selected].run();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 p-4 pt-[15vh] backdrop-blur-[3px] animate-fade-in"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-lg overflow-hidden rounded-2xl bg-card shadow-[0_24px_70px_-20px_rgba(11,16,32,0.45)] animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search sheets, pages, actions…"
          aria-label="Search commands"
          className="w-full border-b border-line bg-transparent px-4 py-3.5 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-hidden"
        />
        <ul className="max-h-[45vh] overflow-y-auto py-1.5">
          {visible.length === 0 && (
            <li className="px-4 py-6 text-center font-mono text-xs text-ink-400">
              Nothing matches “{query}”
            </li>
          )}
          {visible.map((item, i) => (
            <li key={item.id}>
              <button
                onClick={() => item.run()}
                onMouseEnter={() => setSelected(i)}
                className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                  i === selected ? "bg-teal-soft text-ink-900" : "text-ink-700"
                }`}
              >
                <span className="truncate">{item.label}</span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-ink-400">
                  {item.hint}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-3 border-t border-line px-4 py-2 font-mono text-[10px] text-ink-400">
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>esc close</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
