import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import {
  applyAppearance,
  PREFS_STORAGE_KEY,
} from "@/lib/appearance";
import { DEFAULT_PREFS, mergePrefs, type PrefsPatch, type UserPrefs } from "@/lib/prefs";
import { useToast } from "@/components/Toast";

interface PrefsContextValue {
  prefs: UserPrefs;
  loaded: boolean;
  update: (patch: PrefsPatch) => void;
}

const PrefsContext = createContext<PrefsContextValue | null>(null);

function readLocal(): UserPrefs {
  try {
    return mergePrefs(DEFAULT_PREFS, JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY) || "{}"));
  } catch {
    return DEFAULT_PREFS;
  }
}

function writeLocal(prefs: UserPrefs) {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // private mode — session-only prefs
  }
}

function apply(prefs: UserPrefs) {
  applyAppearance(prefs.appearance);
  writeLocal(prefs);
}

// Server-backed user preferences with an optimistic local mirror. The server
// copy is authoritative so prefs roam across devices; localStorage keeps the
// boot script and pre-auth screens on the right theme.
export function PrefsProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [prefs, setPrefs] = useState<UserPrefs>(readLocal);
  const [loaded, setLoaded] = useState(false);
  const inflight = useRef(0);

  useEffect(() => {
    api
      .get<UserPrefs>("/api/prefs")
      .then((server) => {
        const merged = mergePrefs(DEFAULT_PREFS, server);
        setPrefs(merged);
        apply(merged);
      })
      .catch(() => {
        // offline / not signed in — local copy stands
      })
      .finally(() => setLoaded(true));
  }, []);

  // Sync prefs changed in another tab.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== PREFS_STORAGE_KEY || inflight.current > 0) return;
      const next = readLocal();
      setPrefs(next);
      applyAppearance(next.appearance);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const update = useCallback(
    (patch: PrefsPatch) => {
      setPrefs((prev) => {
        const next = mergePrefs(prev, patch as unknown);
        apply(next);
        inflight.current += 1;
        api
          .patch<UserPrefs>("/api/prefs", patch)
          .then((server) => {
            const merged = mergePrefs(DEFAULT_PREFS, server);
            setPrefs(merged);
            apply(merged);
          })
          .catch((err) => {
            setPrefs(prev);
            apply(prev);
            toast.error(err instanceof Error ? err.message : "Couldn’t save preferences");
          })
          .finally(() => {
            inflight.current -= 1;
          });
        return next;
      });
    },
    [toast]
  );

  return (
    <PrefsContext.Provider value={{ prefs, loaded, update }}>{children}</PrefsContext.Provider>
  );
}

export function usePrefs(): PrefsContextValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs must be used within PrefsProvider");
  return ctx;
}
