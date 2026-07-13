import { Suspense } from "react";
import { useLocation, useOutlet } from "react-router-dom";
import { AnimatePresence, m } from "motion/react";

function PageFallback() {
  return (
    <div className="flex items-center gap-2 py-16 opacity-50">
      <span className="h-2 w-2 animate-pulse rounded-full bg-teal" />
      <span className="font-mono text-xs text-ink-400">loading…</span>
    </div>
  );
}

// Route-level fade+slide. Snapshotting the outlet lets exit animations play
// with react-router v6.
export default function PageTransition() {
  const location = useLocation();
  const outlet = useOutlet();
  // Settings sub-pages share one transition group so the sidenav doesn't remount.
  const key = location.pathname.startsWith("/settings") ? "/settings" : location.pathname;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <m.div
        key={key}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        <Suspense fallback={<PageFallback />}>{outlet}</Suspense>
      </m.div>
    </AnimatePresence>
  );
}
