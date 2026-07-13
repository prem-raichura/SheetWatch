import { useState, useEffect, useRef } from "react";
import { NavLink } from "react-router-dom";
import { m } from "motion/react";
import { Moon, Settings as SettingsIcon, Sun } from "lucide-react";
import { useTheme } from "../providers/ThemeProvider";
import { usePrefs } from "../providers/PrefsProvider";
import PageTransition from "./PageTransition";
import { User } from "../types";
import { logout } from "../lib/auth";
import { usePushPermission } from "../hooks/usePushPermission";
import { useChanges } from "../hooks/useChanges";
import { getLastSeen, SEEN_EVENT } from "../lib/lastSeen";
import BrandMark from "./BrandMark";
import PulseDot from "./PulseDot";
import CommandPalette from "./CommandPalette";
import NotificationBell from "./NotificationBell";

interface Props {
  user: User;
}

const tabs = [
  { to: "/overview", label: "Overview" },
  { to: "/sheets", label: "Sheets" },
  { to: "/tracking", label: "Tracking" },
  { to: "/activity", label: "Activity" },
];

export default function AppLayout({ user }: Props) {
  const { permission, requestPermission } = usePushPermission();
  const { isDark, toggleTheme } = useTheme();
  const { prefs } = usePrefs();
  const { changes } = useChanges();
  const [lastSeen, setLastSeen] = useState(getLastSeen);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const themeButtonRef = useRef<HTMLButtonElement>(null);

  // Circular-reveal theme switch via the View Transitions API when available;
  // plain toggle otherwise or when the user limits animation.
  const onToggleTheme = () => {
    const el = themeButtonRef.current;
    const canAnimate =
      prefs.appearance.animation === "full" &&
      "startViewTransition" in document &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
      el;
    if (!canAnimate) {
      toggleTheme();
      return;
    }
    const { left, top, width, height } = el.getBoundingClientRect();
    const x = left + width / 2;
    const y = top + height / 2;
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );
    const transition = (
      document as Document & {
        startViewTransition: (cb: () => void) => { ready: Promise<void> };
      }
    ).startViewTransition(() => toggleTheme());
    transition.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 420, easing: "ease-in-out", pseudoElement: "::view-transition-new(root)" }
      );
    });
  };

  // Activity tab marks changes seen; pick the new timestamp up via event.
  useEffect(() => {
    const onSeen = () => setLastSeen(getLastSeen());
    window.addEventListener(SEEN_EVENT, onSeen);
    return () => window.removeEventListener(SEEN_EVENT, onSeen);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const unread = changes.filter((c) => c.createdAt > lastSeen).length;

  const handleLogout = async () => {
    await logout();
    window.location.href = "/login";
  };

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur">
        <div className="flex w-full items-center justify-between px-4 py-3 sm:px-6 lg:px-10">
          <div className="flex items-center gap-2.5">
            <BrandMark className="h-6 w-6" />
            <span className="font-display text-lg font-bold tracking-tight text-ink-900">
              SheetWatch
            </span>
            <span className="ml-2 hidden items-center gap-1.5 rounded-full border border-line bg-teal-soft px-2.5 py-1 sm:flex">
              <PulseDot tone="live" />
              <span className="font-mono text-[11px] font-medium text-teal-600">
                watching · 3 min
              </span>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              ref={themeButtonRef}
              onClick={onToggleTheme}
              aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
              className="rounded-lg border border-line bg-surface p-1.5 text-ink-400 shadow-xs transition-all hover:border-teal/40 hover:text-teal-600 active:scale-[0.97]"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <NotificationBell />
            <button
              onClick={() => setPaletteOpen(true)}
              aria-label="Open command palette"
              className="hidden items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 font-mono text-[11px] text-ink-400 shadow-xs transition-all hover:border-teal/40 hover:text-teal-600 active:scale-[0.97] sm:inline-flex"
            >
              ⌘K
            </button>
            {permission !== "granted" && (
              <button
                onClick={requestPermission}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-700 shadow-xs transition-all hover:border-teal/40 hover:text-teal-600 active:scale-[0.97]"
              >
                <PulseDot tone="muted" />
                Enable push
              </button>
            )}
            <NavLink
              to="/settings"
              aria-label="Settings"
              className={({ isActive }) =>
                `rounded-lg border border-line bg-surface p-1.5 shadow-xs transition-all hover:border-teal/40 hover:text-teal-600 active:scale-[0.97] ${
                  isActive ? "text-teal-600" : "text-ink-400"
                }`
              }
            >
              <SettingsIcon className="h-4 w-4" />
            </NavLink>
            <div className="hidden text-right sm:block">
              <div className="text-xs font-medium text-ink-700">{user.email}</div>
            </div>
            <button
              onClick={handleLogout}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-400 transition-colors hover:bg-coral-soft hover:text-coral-600"
            >
              Sign out
            </button>
          </div>
        </div>

        <nav className="w-full px-4 sm:px-6 lg:px-10">
          <div className="flex gap-1">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                className={({ isActive }) =>
                  `relative -mb-px px-3 py-2.5 text-sm font-semibold transition-colors ${
                    isActive ? "text-ink-900" : "text-ink-400 hover:text-ink-700"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {t.label}
                    {isActive && (
                      <m.div
                        layoutId="tab-underline"
                        className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-teal"
                        transition={{ type: "spring", stiffness: 500, damping: 40 }}
                      />
                    )}
                    {t.to === "/activity" && unread > 0 && (
                      <span className="absolute -right-1 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-coral px-1 font-mono text-[10px] font-bold leading-none text-destructive-foreground">
                        {unread > 9 ? "9+" : unread}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
      </header>

      <main className="w-full px-4 py-8 sm:px-6 lg:px-10">
        <PageTransition />
      </main>

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
