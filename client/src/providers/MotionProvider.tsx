import { LazyMotion, MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { usePrefs } from "./PrefsProvider";

// Central motion policy: features load async; "reduced"/"off" collapse
// Motion animations to instant. "off" additionally kills CSS animation via
// the [data-anim="off"] rule in index.css.
export function MotionProvider({ children }: { children: ReactNode }) {
  const { prefs } = usePrefs();
  const intensity = prefs.appearance.animation;

  return (
    <LazyMotion strict features={() => import("@/lib/motion-features").then((m) => m.default)}>
      <MotionConfig reducedMotion={intensity === "full" ? "user" : "always"}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
