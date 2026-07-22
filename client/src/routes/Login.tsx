import BrandMark from "../components/BrandMark";
import PulseDot from "../components/PulseDot";

import { API_BASE } from "../lib/api";

export default function Login() {
  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");

  return (
    <div className="relative min-h-screen overflow-hidden bg-paper">
      {/* faint spreadsheet grid backdrop — the world we watch */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage:
            "radial-gradient(ellipse 70% 60% at 50% 40%, #000 40%, transparent 100%)",
        }}
      />

      <div className="relative flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2.5">
            <BrandMark className="h-7 w-7" />
            <span className="font-display text-xl font-bold tracking-tight text-ink-900">
              SheetWatch
            </span>
          </div>

          <h1 className="mt-8 font-display text-[2.1rem] font-bold leading-[1.1] tracking-tight text-ink-900">
            Your sheets,
            <br />
            <span className="text-teal-600">under watch.</span>
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-500">
            Connect Google once. SheetWatch checks every sheet you own or share
            every few minutes and pings you the moment a cell changes.
          </p>

          {error && (
            <div className="mt-6 rounded-xl border border-coral/30 bg-coral-soft px-4 py-3 text-sm text-coral-600">
              {error === "auth_failed"
                ? "Sign-in didn’t go through. Try again."
                : "Something went wrong. Try again."}
            </div>
          )}

          <a
            href={`${API_BASE}/auth/google`}
            className="group relative mt-8 flex w-full items-center justify-center gap-3 overflow-hidden rounded-xl bg-foreground px-4 py-3.5 font-semibold text-background shadow-pop transition-all hover:bg-foreground/85 hover:shadow-lg active:scale-[0.98]"
          >
            <span
              aria-hidden
              className="absolute inset-0 -translate-x-full animate-[shimmer_2.6s_infinite] bg-gradient-to-r from-transparent via-white/15 to-transparent"
            />
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </a>

          <div className="mt-6 flex items-center gap-2">
            <PulseDot tone="live" />
            <span className="font-mono text-[11px] text-ink-400">
              read-only access · your data stays yours
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
