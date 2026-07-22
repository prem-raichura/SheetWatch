import { useEffect } from "react";

// Ref-counted body scroll lock shared by every modal/overlay. Stacking two
// modals (or re-rendering one) must not leak `overflow: hidden` onto <body> —
// the count guarantees the original value is restored only when the LAST
// overlay closes. Runs once per mount (empty deps) so it can't mis-capture a
// value that another overlay already changed.
let count = 0;
let saved = "";

export function useScrollLock() {
  useEffect(() => {
    if (count === 0) {
      saved = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    count += 1;
    return () => {
      count -= 1;
      if (count === 0) document.body.style.overflow = saved;
    };
  }, []);
}
