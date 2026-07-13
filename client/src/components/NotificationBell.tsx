import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { useUnread } from "../hooks/useUnread";
import { usePrefs } from "../providers/PrefsProvider";
import { formatTimeAgo } from "../lib/format";
import { playSound } from "../lib/sound";

// Header bell with unread badge + dropdown of recent unread changes.
export default function NotificationBell() {
  const { count, items, markRead } = useUnread();
  const { prefs } = usePrefs();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const prevCount = useRef(count);

  const [shaking, setShaking] = useState(false);

  // Chime + shake when new changes arrive while the app is open.
  useEffect(() => {
    if (count > prevCount.current) {
      playSound(prefs.notifications.sound);
      setShaking(true);
      const t = setTimeout(() => setShaking(false), 700);
      return () => clearTimeout(t);
    }
    prevCount.current = count;
  }, [count, prefs.notifications.sound]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const openItem = async (id: string, sheetId: string) => {
    setOpen(false);
    await markRead([id]);
    navigate(`/history/${sheetId}`);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${count > 0 ? ` (${count} unread)` : ""}`}
        className="relative rounded-lg border border-line bg-surface p-1.5 text-ink-400 shadow-xs transition-all hover:border-teal/40 hover:text-teal-600 active:scale-[0.97]"
      >
        <Bell
          className={`h-4 w-4 ${shaking ? "animate-[bell-shake_0.7s_ease-in-out]" : ""}`}
        />
        {count > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-coral px-1 font-mono text-[10px] font-bold leading-none text-destructive-foreground">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-80 overflow-hidden rounded-xl border border-line bg-card shadow-[0_18px_50px_-15px_rgba(11,16,32,0.35)]">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="font-display text-xs font-bold text-ink-900">Notifications</span>
            {count > 0 && (
              <button
                onClick={() => markRead()}
                className="font-mono text-[11px] text-ink-400 transition-colors hover:text-teal-600"
              >
                mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center font-mono text-xs text-ink-300">all caught up 🎉</p>
          ) : (
            <div className="max-h-80 divide-y divide-line overflow-y-auto">
              {items.map((c) => (
                <button
                  key={c.id}
                  onClick={() => openItem(c.id, c.sheetId)}
                  className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-paper"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-display text-xs font-semibold text-ink-900">
                      {c.sheet.label}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-ink-400">
                      {formatTimeAgo(c.createdAt, prefs.time)}
                    </span>
                  </span>
                  <span className="truncate font-mono text-[11px] text-ink-500">{c.summary}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
